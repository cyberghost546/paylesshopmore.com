"""What the warehouse floor does to a package, and the rules around it.

Every function here is a complete warehouse action: it checks that the caller
may do it, makes the change, and writes the PackageActivity row, all in one
transaction. Views call these and nothing else writes to the operation tables,
so there is exactly one place where "who may do what" is decided and one
place where the audit trail is written.

The checks are made here on the server. The React app hides buttons a worker
cannot use, but that is only tidiness; this is what holds.
"""

import logging
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework import status as http_status
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError

from accounts.events import record_event
from accounts.models import Package, PackageEvent
from accounts.warehouse import move_warehouse_stage

from .models import (
    MAX_SIDE_CM,
    MAX_WEIGHT_KG,
    MIN_SIDE_CM,
    MIN_WEIGHT_KG,
    IntakeSheetPhoto,
    PackageActivity,
    PackageDamagePhoto,
    PackageDamageReport,
    PackageMeasurement,
    PackagePackaging,
    PackagePhoto,
)

logger = logging.getLogger(__name__)

Stage = Package.WarehouseStage
Action = PackageActivity.Action

# Where saving a measurement moves a package that has not been measured yet.
BEFORE_MEASUREMENT = (Stage.AWAITING_PICKUP, Stage.RECEIVED, Stage.AWAITING_MEASUREMENT)

# The activity a stage change is recorded as. Anything not listed is a plain
# "status changed".
STAGE_ACTIONS = {
    Stage.RECEIVED: Action.PACKAGE_RECEIVED,
    Stage.PACKED: Action.PACKAGE_PACKED,
    Stage.READY: Action.PACKAGE_MARKED_READY,
}


# ---- automatic stages --------------------------------------------------
#
# READ THIS FIRST. A worker does the WORK (scans the box, measures it, marks
# it packed); the stage follows by itself. After every move, auto_advance()
# keeps going while the next stage is obvious:
#
#   Package expected        -- scanned at the warehouse -->  Package received
#   Package received        -- straight on -------------->  Waiting for measurement
#                              (or Measured, if it was measured already)
#   Measured                -- straight on -------------->  Waiting for packaging
#   Packaged                -- when it may ship* -------->  Ready for shipping
#   (any)                   -- office sets "in transit" ->  Shipped (accounts/warehouse.py)
#
#   * measured, no open damage report, no open problem. Otherwise it stays
#     "Packaged" until that is sorted, and Ready is set by hand as before.
#
# Every automatic step is a normal stage change: it is written to the history
# with the reason "automatic: ...", so nobody wonders how it got there.
#
# The "Move to" buttons stay, for corrections. Moving a package BACK (e.g. from
# Packaged to Waiting for packaging) sticks: auto_advance only runs after a
# move forward, so a correction is never undone by the automation.

# The stages in the order a package goes through them.
STAGE_ORDER = list(Stage.values)


def _is_forward(from_stage, to_stage):
    return STAGE_ORDER.index(to_stage) > STAGE_ORDER.index(from_stage)


def intake_lines(package):
    """The measured lines of the package's intake sheet, or [] if not measured.

    The newest sheet linked to the package counts, and only when EVERY line on
    it has all four numbers: a half-filled sheet is still being worked on.
    """
    sheet = package.intake_sheets.order_by("-created_at").first()
    if sheet is None:
        return []
    lines = list(sheet.measurements.all())
    if not lines or not all(line.complete for line in lines):
        return []
    return lines


def is_measured(package):
    """Has this package been measured - on the floor, or on the intake form?

    The warehouse only fills in the intake form; the measurements on it count,
    so nobody has to measure the same box a second time on the package page.
    """
    return package.warehouse_measurements.exists() or bool(intake_lines(package))


def _may_ship(package):
    """What "Ready for shipping" needs (the same rules as _check_ready, plus
    no open problem on the package)."""
    return (
        is_measured(package)
        and not package.damage_reports.filter(resolution_status=PackageDamageReport.Resolution.OPEN).exists()
        and not package.problem_note
    )


def _next_automatic_stage(package):
    """The stage a package moves on to by itself from where it is, or None."""
    stage = package.warehouse_stage
    if stage == Stage.RECEIVED:
        return Stage.MEASURED if is_measured(package) else Stage.AWAITING_MEASUREMENT
    if stage == Stage.MEASURED:
        return Stage.AWAITING_PACKAGING
    if stage == Stage.PACKED and _may_ship(package):
        return Stage.READY
    return None


AUTOMATIC_REASONS = {
    Stage.AWAITING_MEASUREMENT: "automatic: received, waiting to be measured",
    Stage.MEASURED: "automatic: already measured",
    Stage.AWAITING_PACKAGING: "automatic: measured, waiting for packaging",
    Stage.READY: "automatic: packed, measured and nothing open",
}


def auto_advance(package, user):
    """Keep moving the package on while the next stage is obvious (see above).

    Call inside the caller's transaction, right after a forward move. Stops
    after a few steps at most - the rules cannot loop, but a guard costs
    nothing.
    """
    for _ in range(len(STAGE_ORDER)):
        next_stage = _next_automatic_stage(package)
        if next_stage is None:
            return
        _move(package, next_stage, user, reason=AUTOMATIC_REASONS[next_stage], automatic=True)


class WarehouseConflict(APIException):
    """A well-formed request the package's state does not allow. 409."""

    status_code = http_status.HTTP_409_CONFLICT
    default_detail = "This package cannot be changed in its current state."


def _person(user):
    return (user.get_full_name() or user.get_username()) if user else ""


def record_activity(package, user, action, description, **context):
    """Append one immutable activity row. Call inside the action's transaction.

    Unlike accounts.events.record_event this does not swallow failures: the
    warehouse's audit trail is part of the action, and an action whose record
    cannot be written is rolled back with it.
    """
    return PackageActivity.objects.create(
        package=package,
        user=user,
        action=action,
        description=description[:500],
        context={key: value for key, value in context.items() if value is not None},
    )


# ---------------------------------------------------------------- guards


def check_can_operate(user):
    if user is None or not user.is_authenticated or not user.can_use_warehouse:
        raise PermissionDenied("Warehouse operations need a warehouse or office account.")


def check_package_open(package):
    """Refuse warehouse work on a package that has left or been cancelled."""
    if package.status in Package.LOCKED_STATUSES:
        raise WarehouseConflict(
            f"This package is {package.get_status_display().lower()} and can no "
            "longer be changed by the warehouse."
        )


def allowed_stages(user):
    """The warehouse stages this user may put a package in."""
    if user is None or not user.can_use_warehouse:
        return ()
    if user.is_warehouse_worker_only:
        return Package.WAREHOUSE_WORKER_STAGES
    return tuple(Stage.values)


def _decimal(data, field, minimum, maximum, unit):
    raw = data.get(field)
    if raw in (None, ""):
        raise ValidationError({field: ["This value is required."]})
    try:
        value = Decimal(str(raw).strip().replace(",", "."))
    except (InvalidOperation, ValueError):
        raise ValidationError({field: ["Enter a number."]}) from None
    if not value.is_finite():
        raise ValidationError({field: ["Enter a number."]})
    if value < minimum or value > maximum:
        raise ValidationError(
            {field: [f"Must be between {minimum} and {maximum} {unit}."]}
        )
    return value


def validate_measurement(data):
    """Parse and range-check the four numbers. Returns Decimals."""
    errors = {}
    values = {}
    for field, minimum, maximum, unit, places in (
        ("weight_kg", MIN_WEIGHT_KG, MAX_WEIGHT_KG, "kg", Decimal("0.01")),
        ("length_cm", MIN_SIDE_CM, MAX_SIDE_CM, "cm", Decimal("0.1")),
        ("width_cm", MIN_SIDE_CM, MAX_SIDE_CM, "cm", Decimal("0.1")),
        ("height_cm", MIN_SIDE_CM, MAX_SIDE_CM, "cm", Decimal("0.1")),
    ):
        try:
            value = _decimal(data, field, minimum, maximum, unit)
        except ValidationError as error:
            errors.update(error.detail)
            continue
        if value != value.quantize(places):
            errors[field] = [f"Use at most {abs(places.as_tuple().exponent)} decimal place(s)."]
            continue
        values[field] = value
    if errors:
        raise ValidationError(errors)
    return values


# ---------------------------------------------------------------- actions


def record_scan(package, user, code=""):
    """Record a scan. Scanning an EXPECTED package at the warehouse is the
    proof it has arrived, so it is received - and moves on to "Waiting for
    measurement" by itself (see "automatic stages" above)."""
    check_can_operate(user)
    with transaction.atomic():
        activity = record_activity(
            package,
            user,
            Action.PACKAGE_SCANNED,
            f"Scanned by {_person(user)}" + (f" (code {code[:60]})" if code else ""),
            code=code[:60] or None,
        )
        if (
            package.warehouse_stage == Stage.AWAITING_PICKUP
            and package.status != Package.Status.CANCELLED
            and Stage.RECEIVED in allowed_stages(user)
        ):
            _move(package, Stage.RECEIVED, user, reason="automatic: scanned at the warehouse")
        return activity


def change_stage(package, to_stage, user, *, reason=None):
    """Move the package to another warehouse stage, if this user may."""
    check_can_operate(user)

    if to_stage not in Stage.values:
        raise ValidationError({"stage": ["Not a warehouse stage."]})
    if to_stage not in allowed_stages(user):
        raise PermissionDenied(
            f"Warehouse workers cannot set a package to {Stage(to_stage).label.lower()}. "
            "That step belongs to the office."
        )
    if package.status == Package.Status.CANCELLED:
        raise ValidationError({"stage": ["This shipment was cancelled."]})
    # The office may still record that a locked shipment has left; the floor
    # may not rearrange one.
    if user.is_warehouse_worker_only:
        check_package_open(package)

    if to_stage == Stage.READY:
        _check_ready(package)

    with transaction.atomic():
        return _move(package, to_stage, user, reason=reason)


def _move(package, to_stage, user, *, reason=None, automatic=False):
    """Move the package, write the activity row, and - after a move FORWARD -
    let the automatic stages follow (auto_advance). `automatic` is True for
    the moves auto_advance makes itself, so it does not start over."""
    from_stage = package.warehouse_stage
    if not move_warehouse_stage(package, to_stage, actor=user, reason=reason):
        return False
    label = Stage(to_stage).label
    record_activity(
        package,
        user,
        STAGE_ACTIONS.get(to_stage, Action.PACKAGE_STATUS_CHANGED),
        f"{Stage(from_stage).label} → {label}" + (f" ({reason})" if reason else ""),
        from_stage=from_stage,
        to_stage=to_stage,
    )
    if not automatic and _is_forward(from_stage, to_stage):
        auto_advance(package, user)
    return True


def _check_ready(package):
    if not is_measured(package):
        raise WarehouseConflict("Measure the package before marking it ready for shipping.")
    if package.damage_reports.filter(
        resolution_status=PackageDamageReport.Resolution.OPEN
    ).exists():
        raise WarehouseConflict(
            "This package has an open damage report. Resolve it before marking it ready."
        )


def current_measurement(package):
    return package.warehouse_measurements.select_related("worker").first()


def save_measurement(package, user, data):
    """Record a measurement, and move an unmeasured package to Measured."""
    check_can_operate(user)
    check_package_open(package)
    values = validate_measurement(data)

    with transaction.atomic():
        # Lock the package row so two workers measuring the same box at once
        # produce two ordered rows rather than two rows superseding one.
        package = Package.objects.select_for_update().get(pk=package.pk)
        previous = current_measurement(package)

        measurement = PackageMeasurement.objects.create(
            package=package, worker=user, supersedes=previous, **values
        )
        summary = (
            f"{measurement.weight_kg} kg · {measurement.length_cm} × "
            f"{measurement.width_cm} × {measurement.height_cm} cm · "
            f"{measurement.volume_m3} m³ · dim. weight {measurement.dimensional_weight_kg} kg"
        )
        record_activity(
            package,
            user,
            Action.MEASUREMENT_UPDATED if previous else Action.MEASUREMENT_COMPLETED,
            summary,
            measurement_id=measurement.pk,
            supersedes_id=previous.pk if previous else None,
        )

        _fill_intake_sheet(package, measurement)

        if package.warehouse_stage in BEFORE_MEASUREMENT:
            _move(package, Stage.MEASURED, user, reason="Measurement saved")

    return measurement, package


def _fill_intake_sheet(package, measurement):
    """Write a package-page measurement onto the package's intake form.

    The other half of measure_from_intake(): whichever of the two the worker
    measures on, the other one is filled in, so nobody measures twice.

    Only the newest sheet, only while it is a draft (a released sheet is
    locked), and only when it has no lines yet or one line for one item -
    a sheet listing several boxes is not one box's measurement to overwrite.
    """
    from .models import IntakeSheet, Measurement

    sheet = package.intake_sheets.order_by("-created_at").first()
    if sheet is None or sheet.status != IntakeSheet.Status.DRAFT:
        return
    lines = list(sheet.measurements.all())
    if len(lines) > 1 or (lines and lines[0].quantity != 1):
        return
    line = lines[0] if lines else Measurement(sheet=sheet, quantity=1)
    line.length_cm = measurement.length_cm
    line.width_cm = measurement.width_cm
    line.height_cm = measurement.height_cm
    line.weight_kg = measurement.weight_kg
    line.save()


def measure_from_intake(sheet, user):
    """Use the intake form's measurements for the package it is linked to.

    Called every time a sheet is saved. The warehouse measures once, on the
    intake form, and this carries it over:

    * one item on the sheet (one line, quantity 1): it is copied as the
      package's measurement, so the package page and the customer see the
      same weight and sizes. Only when it differs from what is there, so
      saving the sheet again does not add a row each time.
    * several items: they cannot be one box's sizes, so nothing is copied -
      the sheet itself is the measurement (is_measured() above counts it).

    Either way an unmeasured package moves on to Measured, and further by
    itself where the next step is obvious (auto_advance).

    Does nothing for a sheet without a package, a sheet that is not fully
    measured yet, or a package that has left or was cancelled.
    """
    package = sheet.package
    if package is None or user is None or package.status in Package.LOCKED_STATUSES:
        return
    lines = intake_lines(package)
    # intake_lines() reads the newest sheet; only act when that is this one.
    if not lines or lines[0].sheet_id != sheet.pk:
        return

    with transaction.atomic():
        package = Package.objects.select_for_update().get(pk=package.pk)
        if sum(line.quantity for line in lines) == 1:
            line = lines[0]
            try:
                values = validate_measurement(
                    {
                        "weight_kg": line.weight_kg,
                        "length_cm": line.length_cm,
                        "width_cm": line.width_cm,
                        "height_cm": line.height_cm,
                    }
                )
            except ValidationError:
                # Out of the range the package page accepts (a 0 typed by
                # mistake): leave the sheet as the record, copy nothing.
                values = None
            previous = current_measurement(package)
            same = previous is not None and values is not None and all(
                getattr(previous, field) == value for field, value in values.items()
            )
            if values is not None and not same:
                measurement = PackageMeasurement.objects.create(
                    package=package, worker=user, supersedes=previous, **values
                )
                record_activity(
                    package,
                    user,
                    Action.MEASUREMENT_UPDATED if previous else Action.MEASUREMENT_COMPLETED,
                    f"From intake sheet {sheet.label}: {measurement.weight_kg} kg · "
                    f"{measurement.length_cm} × {measurement.width_cm} × {measurement.height_cm} cm",
                    measurement_id=measurement.pk,
                    supersedes_id=previous.pk if previous else None,
                    intake_sheet_id=sheet.pk,
                )

        if package.warehouse_stage in BEFORE_MEASUREMENT:
            _move(package, Stage.MEASURED, user, reason=f"measured on intake sheet {sheet.label}")


def add_packaging(package, user, data):
    check_can_operate(user)
    check_package_open(package)

    packaging_type = data.get("packaging_type")
    if packaging_type not in PackagePackaging.Type.values:
        raise ValidationError({"packaging_type": ["Choose a packaging type."]})

    raw_quantity = data.get("quantity", 1)
    try:
        quantity = int(str(raw_quantity).strip())
    except (TypeError, ValueError):
        raise ValidationError({"quantity": ["Enter a whole number."]}) from None
    if not 1 <= quantity <= 999:
        raise ValidationError({"quantity": ["Must be between 1 and 999."]})

    notes = str(data.get("notes") or "").strip()
    if len(notes) > 500:
        raise ValidationError({"notes": ["Keep notes under 500 characters."]})
    if packaging_type == PackagePackaging.Type.OTHER and not notes:
        raise ValidationError({"notes": ["Say what packaging was used."]})

    with transaction.atomic():
        record = PackagePackaging.objects.create(
            package=package,
            worker=user,
            packaging_type=packaging_type,
            quantity=quantity,
            notes=notes,
        )
        label = record.get_packaging_type_display()
        record_activity(
            package,
            user,
            Action.BUBBLE_WRAP_ADDED
            if packaging_type == PackagePackaging.Type.BUBBLE_WRAP
            else Action.PACKAGING_ADDED,
            f"{quantity} × {label}" + (f" · {notes}" if notes else ""),
            packaging_id=record.pk,
            packaging_type=packaging_type,
            quantity=quantity,
        )
        # Packaging being added is the clearest sign the box is waiting to
        # be packed, so a measured package moves on by itself.
        if package.warehouse_stage == Stage.MEASURED:
            _move(package, Stage.AWAITING_PACKAGING, user, reason="Packaging added")

    return record


def _read_photo(upload):
    if upload.size > PackageDamagePhoto.MAX_BYTES:
        raise ValidationError({"photos": ["Each photo must be 10 MB or smaller."]})
    head = upload.read(16)
    upload.seek(0)
    content_type = PackageDamagePhoto.sniff(head)
    if content_type is None:
        raise ValidationError({"photos": ["Photos must be JPEG, PNG or WebP images."]})
    return content_type


def report_damage(package, user, data, photos=()):
    check_can_operate(user)

    damage_type = data.get("damage_type")
    if damage_type not in PackageDamageReport.DamageType.values:
        raise ValidationError({"damage_type": ["Choose what kind of damage it is."]})

    description = str(data.get("description") or "").strip()
    if len(description) > 1000:
        raise ValidationError({"description": ["Keep the description under 1000 characters."]})
    if damage_type == PackageDamageReport.DamageType.OTHER and not description:
        raise ValidationError({"description": ["Describe the damage."]})

    photos = list(photos)
    if len(photos) > PackageDamagePhoto.MAX_PER_REPORT:
        raise ValidationError(
            {"photos": [f"Attach at most {PackageDamagePhoto.MAX_PER_REPORT} photos."]}
        )
    # Every file is checked before anything is written.
    types = [_read_photo(photo) for photo in photos]

    with transaction.atomic():
        report = PackageDamageReport.objects.create(
            package=package, worker=user, damage_type=damage_type, description=description
        )
        for index, (photo, content_type) in enumerate(zip(photos, types), start=1):
            stored = PackageDamagePhoto(
                report=report, content_type=content_type, size_bytes=photo.size
            )
            name = f"photo-{index}{PackageDamagePhoto.EXTENSIONS[content_type]}"
            stored.image.save(name, photo, save=False)
            stored.save()

        # The office hears about it once the report is really saved: queued on
        # commit, so a rolled-back report never mails anybody.
        transaction.on_commit(lambda: _queue_damage_email(report.pk))

        record_activity(
            package,
            user,
            Action.DAMAGE_REPORTED,
            report.get_damage_type_display()
            + (f": {description[:200]}" if description else "")
            + (f" ({len(photos)} photo{'s' if len(photos) != 1 else ''})" if photos else ""),
            damage_report_id=report.pk,
            damage_type=damage_type,
        )
    return report


def add_package_photos(package, user, photos):
    """Store photos of a package for its customer to see. Returns the new rows.

    The same checks as damage photos (_read_photo): real JPEG, PNG or WebP,
    10 MB at most. Every file is checked before anything is written, and the
    package never holds more than PackagePhoto.MAX_PER_PACKAGE.
    """
    check_can_operate(user)

    photos = list(photos)
    if not photos:
        raise ValidationError({"photos": ["Choose at least one photo."]})
    already = package.photos.count()
    if already + len(photos) > PackagePhoto.MAX_PER_PACKAGE:
        raise ValidationError(
            {
                "photos": [
                    f"A package can have at most {PackagePhoto.MAX_PER_PACKAGE} photos "
                    f"({already} already)."
                ]
            }
        )
    types = [_read_photo(photo) for photo in photos]

    stored = []
    with transaction.atomic():
        for index, (photo, content_type) in enumerate(zip(photos, types), start=already + 1):
            row = PackagePhoto(
                package=package, worker=user, content_type=content_type, size_bytes=photo.size
            )
            name = f"photo-{index}{PackageDamagePhoto.EXTENSIONS[content_type]}"
            row.image.save(name, photo, save=False)
            row.save()
            stored.append(row)

        record_activity(
            package,
            user,
            Action.PHOTO_ADDED,
            f"{len(photos)} photo{'s' if len(photos) != 1 else ''} added",
            photo_ids=[row.pk for row in stored],
        )
    return stored


def remove_package_photo(photo, user):
    """Delete a photo taken by mistake, file and all."""
    check_can_operate(user)
    package = photo.package
    with transaction.atomic():
        photo_id = photo.pk
        photo.delete()
        record_activity(package, user, Action.PHOTO_REMOVED, "Photo removed", photo_id=photo_id)
        # The file goes only once the row is really gone.
        transaction.on_commit(lambda: photo.image.delete(save=False))


def add_intake_photos(sheet, user, photos):
    """Store photos on an intake sheet - usually of the damage it reports.

    The same checks as the other photos (_read_photo): real JPEG, PNG or WebP,
    10 MB at most. Every file is checked before anything is written, and a
    sheet never holds more than IntakeSheetPhoto.MAX_PER_SHEET. The caller
    checks that the sheet is still a draft.
    """
    photos = list(photos)
    if not photos:
        raise ValidationError({"photos": ["Choose at least one photo."]})
    already = sheet.photos.count()
    if already + len(photos) > IntakeSheetPhoto.MAX_PER_SHEET:
        raise ValidationError(
            {
                "photos": [
                    f"A sheet can have at most {IntakeSheetPhoto.MAX_PER_SHEET} photos "
                    f"({already} already)."
                ]
            }
        )
    types = [_read_photo(photo) for photo in photos]

    stored = []
    with transaction.atomic():
        for index, (photo, content_type) in enumerate(zip(photos, types), start=already + 1):
            row = IntakeSheetPhoto(
                sheet=sheet, worker=user, content_type=content_type, size_bytes=photo.size
            )
            name = f"photo-{index}{PackageDamagePhoto.EXTENSIONS[content_type]}"
            row.image.save(name, photo, save=False)
            row.save()
            stored.append(row)
    return stored


def remove_intake_photo(photo):
    """Delete a photo taken by mistake, file and all."""
    with transaction.atomic():
        photo.delete()
        # The file goes only once the row is really gone.
        transaction.on_commit(lambda: photo.image.delete(save=False))


def _queue_damage_email(report_id):
    """Hand the damage e-mail to the worker. Never fails the report."""
    from .tasks import send_damage_report_email

    try:
        send_damage_report_email.delay(report_id)
    except Exception:
        logger.exception(
            "Damage report %s was saved but its e-mail could not be queued.", report_id
        )


def resolve_damage(report, user, note=""):
    check_can_operate(user)
    note = str(note or "").strip()
    if len(note) > 500:
        raise ValidationError({"note": ["Keep the note under 500 characters."]})

    with transaction.atomic():
        if not report.resolve(user, note):
            raise WarehouseConflict("This damage report has already been resolved.")
        record_activity(
            report.package,
            user,
            Action.DAMAGE_RESOLVED,
            f"{report.get_damage_type_display()} resolved" + (f": {note}" if note else ""),
            damage_report_id=report.pk,
        )
    return report


def set_location(package, user, location):
    check_can_operate(user)
    check_package_open(package)

    location = str(location or "").strip().upper()
    if len(location) > 40:
        raise ValidationError({"location": ["Keep the location under 40 characters."]})
    # The warehouse is fixed (settings WAREHOUSE_DEFAULT_LOCATION,
    # PAYLESSHOPMORE): nothing else is accepted, not even blank.
    fixed = getattr(settings, "WAREHOUSE_DEFAULT_LOCATION", "")
    if fixed and location != fixed:
        raise ValidationError({"location": [f"The warehouse is fixed: {fixed}."]})

    previous = package.warehouse_location
    if location == previous:
        return package

    with transaction.atomic():
        package.warehouse_location = location
        package.save(update_fields=["warehouse_location", "updated_at"])
        record_activity(
            package,
            user,
            Action.LOCATION_CHANGED,
            f"{previous or 'No location'} → {location or 'No location'}",
            from_location=previous,
            to_location=location,
        )
    return package


def report_problem(package, user, note):
    check_can_operate(user)
    note = str(note or "").strip()
    if not note:
        raise ValidationError({"note": ["Say what the problem is."]})
    if len(note) > 500:
        raise ValidationError({"note": ["Keep it under 500 characters."]})

    with transaction.atomic():
        package.problem_note = note
        package.problem_reported_at = timezone.now()
        package.problem_reported_by = user
        package.save(
            update_fields=["problem_note", "problem_reported_at", "problem_reported_by", "updated_at"]
        )
        record_event(package, PackageEvent.Kind.PROBLEM_REPORTED, actor=user, note=note)
        record_activity(package, user, Action.PROBLEM_REPORTED, note)
    return package


def resolve_problem(package, user):
    check_can_operate(user)
    if not package.problem_note:
        return package

    note = package.problem_note
    with transaction.atomic():
        package.problem_note = ""
        package.problem_reported_at = None
        package.problem_reported_by = None
        package.save(
            update_fields=["problem_note", "problem_reported_at", "problem_reported_by", "updated_at"]
        )
        record_event(package, PackageEvent.Kind.PROBLEM_RESOLVED, actor=user, note=note)
        record_activity(package, user, Action.PROBLEM_RESOLVED, f"Cleared: {note}")
    return package
