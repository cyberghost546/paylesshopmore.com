"""What warehouse workers may see and use (WarehouseAccess), applied.

Three parts:

  section_allowed(user, key)   the one question everything else asks
  SectionAllowed               a DRF permission for the warehouse views: a
                               view (or one of its actions) names its section,
                               and a warehouse-only account is refused it when
                               an admin has switched that section off
  WarehouseAccessView          GET the switches (any warehouse or office
                               account - the warehouse app needs them to know
                               what to show); PUT them (admins and warehouse managers)

The office and admins are never limited: the switches are about the floor.
"""

from rest_framework import serializers
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts import floor
from staff.permissions import IsWarehouseManager, IsWarehouseOrStaff

from .models import WarehouseAccess


def section_allowed(user, section, request=None):
    """Whether this account may use this warehouse section - on this device.

    Two independent switches, and both must allow it:

      * WarehouseAccess: an admin can turn a section off for warehouse-only
        accounts everywhere. Office staff and admins are never limited here.
      * Floor locations: when the request comes from a registered floor
        device, the section must belong to a location that device has been
        granted (accounts/floor.py, device_allows). That limits whoever is
        using the device, office staff included: it is the device that is
        allowed into an area, not the person holding it.

    `request` is optional so that callers without one keep the old meaning;
    every call site in the app passes it.
    """
    if getattr(user, "is_warehouse_worker_only", False) and not WarehouseAccess.current().allows(
        section
    ):
        return False
    if request is not None:
        device = floor.device_for(request)
        if device is not None and not floor.device_allows(device, section):
            return False
    return True


def _section_for(view):
    """The section a request is about: per action, else for the whole view."""
    by_action = getattr(view, "access_sections", None) or {}
    action = getattr(view, "action", None)
    if action in by_action:
        return by_action[action]
    return getattr(view, "access_section", None)


class SectionAllowed(BasePermission):
    """Refuse a switched-off section to a warehouse-only account.

    A view sets `access_section = "damage"`, or `access_sections = {action:
    section}` when only some of its actions belong to a section. Views and
    actions that name no section are not limited by this.
    """

    # Covers both reasons: switched off for warehouse accounts, or this floor
    # device has not been granted a location where this work is done.
    message = (
        "This part of the warehouse app is not available here: it is switched off, "
        "or this device is not allowed in the location where this work is done."
    )

    def has_permission(self, request, view):
        section = _section_for(view)
        if section is None:
            return True
        return section_allowed(request.user, section, request)


class _AccessSerializer(serializers.Serializer):
    sections = serializers.DictField(child=serializers.BooleanField())

    def validate_sections(self, value):
        unknown = set(value) - set(WarehouseAccess.SECTIONS)
        if unknown:
            raise serializers.ValidationError(f"Unknown section: {', '.join(sorted(unknown))}.")
        return value


def _payload(access, user, request=None):
    return {
        "sections": access.as_dict(),
        # The switches as the settings page lists them, in order.
        "choices": [
            {"key": key, "title": title, "description": description}
            for key, (title, description) in WarehouseAccess.SECTIONS.items()
        ],
        # What the asking account itself may use: everything for the office.
        # What THIS session may use, on THIS device - the warehouse app hides
        # the rest, so a floor device only shows its own locations' work.
        "mine": {key: section_allowed(user, key, request) for key in WarehouseAccess.SECTIONS},
        "updated_at": access.updated_at,
    }


class WarehouseAccessView(APIView):
    """GET the warehouse access switches; PUT {sections: {key: bool}} to set them."""

    def get_permissions(self):
        if self.request.method == "GET":
            return [IsWarehouseOrStaff()]
        return [IsWarehouseManager()]

    def get(self, request):
        return Response(_payload(WarehouseAccess.current(), request.user, request))

    def put(self, request):
        body = _AccessSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        access = WarehouseAccess.current()
        # Merged, so a client that sends only some switches leaves the rest.
        access.sections = {**access.as_dict(), **body.validated_data["sections"]}
        access.updated_by = request.user
        access.save()
        return Response(_payload(access, request.user, request))
