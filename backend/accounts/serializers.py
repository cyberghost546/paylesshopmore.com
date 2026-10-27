"""Serializers: the boundary between JSON and the models.

Every field the API accepts is listed explicitly. A serializer built from
`__all__` will happily accept `is_superuser` the day someone adds it.
"""

import os

from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import default_token_generator
from django.core.exceptions import ValidationError as DjangoValidationError
from django.urls import reverse
from django.utils.http import urlsafe_base64_decode
from rest_framework import serializers

from .models import Address, Package, PackageDocument
from .public import public_stage_index, public_stages

User = get_user_model()


class AddressSerializer(serializers.ModelSerializer):
    class Meta:
        model = Address
        fields = [
            "id",
            "label",
            "street",
            "house_number",
            "postal_code",
            "city",
            "country",
            "is_default",
        ]
        # The owner comes from the session, never from the request body —
        # otherwise anyone could file an address under someone else's account.
        read_only_fields = ["id"]


class UserSerializer(serializers.ModelSerializer):
    """The signed-in customer's own profile."""

    addresses = AddressSerializer(many=True, read_only=True)
    # PLSM-C00001: put in front of the name in a webshop's checkout (the
    # profile's "Your shipping address"). Read-only: the server gives it.
    customer_code = serializers.CharField(read_only=True)

    class Meta:
        model = User
        fields = [
            "id",
            "customer_code",
            "username",
            "first_name",
            "last_name",
            "email",
            "phone_number",
            "addresses",
            "notify_shipping",
            "notify_offers",
            "notify_newsletter",
            # Only ever read by a staff account - nobody else is sent a
            # released intake sheet - but writable by anyone, because a
            # customer setting a flag that changes nothing for them is
            # harmless and a read_only_fields exception for one role is not.
            "notify_warehouse",
            # The site language, so e-mails arrive in it. Writable: the React
            # app sends it when a signed-in customer reads the site in another.
            "language",
            "date_joined",
            # Read-only, and only ever a hint to the frontend about which
            # navigation to draw. The staff API checks the flags themselves on
            # every request.
            "is_staff",
            "is_warehouse",
            "role",
            "current_password",
        ]
        # Username, join date and the role are not editable here.
        read_only_fields = [
            "id",
            "username",
            "date_joined",
            "is_staff",
            "is_warehouse",
            "role",
        ]

    # Asked for only when the e-mail address changes. That address is where a
    # password-reset link goes, so changing it on a session alone would turn
    # a borrowed or stolen session into the account itself - the same reason
    # changing the password or deleting the account asks for it.
    current_password = serializers.CharField(
        write_only=True, required=False, allow_blank=True, style={"input_type": "password"}
    )

    def to_internal_value(self, data):
        return super().to_internal_value(lowercase_email(data))

    def validate_email(self, value):
        others = User.objects.filter(email__iexact=value)
        if self.instance is not None:
            others = others.exclude(pk=self.instance.pk)
        if others.exists():
            raise serializers.ValidationError(
                "An account with this e-mail address already exists.", code="unique"
            )
        return value

    def validate(self, attrs):
        password = attrs.pop("current_password", "")
        user = self.instance
        email = attrs.get("email")
        if user is not None and email is not None and email != user.email.lower():
            if not password or not user.check_password(password):
                raise serializers.ValidationError(
                    {"current_password": "Enter your current password to change your e-mail address."}
                )
        return attrs


def lowercase_email(data):
    """The request body with its e-mail lowercased, before any validator runs.

    Field validators - the model's unique check among them - run before a
    `validate_email`, so lowercasing there would let "Agent@example.com" clear
    a check against "agent@example.com" and then collide on save, or sit
    beside it as a second account matching the same address.
    """
    if hasattr(data, "get") and isinstance(data.get("email"), str):
        data = data.copy()
        data["email"] = data["email"].strip().lower()
    return data


class SignupSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, style={"input_type": "password"})

    class Meta:
        model = User
        fields = [
            "username",
            "first_name",
            "last_name",
            "email",
            "phone_number",
            "password",
        ]
        extra_kwargs = {
            "first_name": {"required": True, "allow_blank": False},
            "last_name": {"required": True, "allow_blank": False},
            "email": {"required": True},
            "phone_number": {"required": True, "allow_blank": False},
        }

    def to_internal_value(self, data):
        # Addresses differ only by case in practice; store and compare lower.
        return super().to_internal_value(lowercase_email(data))

    def validate_email(self, value):
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError(
                "An account with this e-mail address already exists.", code="unique"
            )
        return value

    def validate_password(self, value):
        """Run Django's password validators, including the 12-character rule."""
        try:
            validate_password(value)
        except DjangoValidationError as error:
            raise serializers.ValidationError(list(error.messages)) from error
        return value

    def create(self, validated_data):
        # create_user hashes the password. Never User(**data) + save().
        return User.objects.create_user(**validated_data)


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField(write_only=True, style={"input_type": "password"})

    def validate(self, attrs):
        identifier = attrs["username"]

        # The login form asks for an e-mail address and sends it in this
        # field. Accounts created through signup have username == email, so
        # that used to line up by accident; one created with createsuperuser
        # does not, and those are exactly the staff accounts that need the
        # dashboard. Translating an address to its username first is what
        # makes the e-mail the way in for every account, however it was made.
        #
        # The address column is unique, so this can only ever find one row.
        match = User.objects.filter(email__iexact=identifier).first()
        username = match.get_username() if match else identifier

        user = authenticate(
            request=self.context.get("request"),
            username=username,
            password=attrs["password"],
        )

        # One message for both "no such user" and "wrong password". Telling
        # them apart lets an attacker enumerate who has an account.
        if user is None:
            raise serializers.ValidationError(
                "Unable to log in with the credentials provided.",
                code="invalid_credentials",
            )

        attrs["user"] = user
        return attrs


class CodeLoginSerializer(serializers.Serializer):
    """A warehouse worker's e-mail address and the four-digit code they were sent.

    Only the shape is checked here. Whether the address belongs to a warehouse
    worker, and whether the code is theirs, live and unspent, is for
    signin_codes.redeem_code - which answers the same way for every reason, so
    nothing here may say which half was wrong either.
    """

    email = serializers.CharField()
    code = serializers.RegexField(r"^\d{4}$", write_only=True)


class PasswordChangeSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True)

    def validate_current_password(self, value):
        """Proving knowledge of the old password is what stops someone with a
        borrowed session from taking over the account."""
        if not self.context["request"].user.check_password(value):
            raise serializers.ValidationError("Your current password is not correct.")
        return value

    def validate_new_password(self, value):
        user = self.context["request"].user
        try:
            validate_password(value, user=user)
        except DjangoValidationError as error:
            raise serializers.ValidationError(list(error.messages)) from error
        return value


class PasswordResetRequestSerializer(serializers.Serializer):
    """"I have forgotten my password" — just the address."""

    email = serializers.EmailField()
    # Which language to write the mail in. Optional; the same field the
    # contact and quote forms send.
    language = serializers.CharField(max_length=5, required=False, allow_blank=True)

    def validate_email(self, value):
        return value.lower()

    def account(self):
        """The account to send to, or None.

        None is not an error and the view does not treat it as one — see the
        note there about not confirming which addresses are registered.

        Anonymised and deactivated accounts are excluded: an erased account
        has no password to reset, and its address column holds a placeholder
        that nobody reads anyway.
        """
        return User.objects.filter(
            email__iexact=self.validated_data["email"],
            is_active=True,
            anonymised_at__isnull=True,
        ).first()


class PasswordResetConfirmSerializer(serializers.Serializer):
    """The new password, plus the two halves of the link from the e-mail."""

    uid = serializers.CharField()
    token = serializers.CharField()
    new_password = serializers.CharField(write_only=True)

    def validate(self, attrs):
        user = self.resolve_user(attrs["uid"])

        # One message for a malformed uid, an unknown account, and a token
        # that is expired or already used. Telling them apart would say
        # whether an account exists, and none of the three is separately
        # actionable: the answer to all of them is to ask for a fresh link.
        if user is None or not default_token_generator.check_token(user, attrs["token"]):
            raise serializers.ValidationError(
                {"token": "This link is no longer valid. Please request a new one."},
                code="invalid_token",
            )

        # Validated against the user, so a password containing their own name
        # or e-mail address is rejected by the similarity validator.
        try:
            validate_password(attrs["new_password"], user=user)
        except DjangoValidationError as error:
            raise serializers.ValidationError(
                {"new_password": list(error.messages)}
            ) from error

        attrs["user"] = user
        return attrs

    @staticmethod
    def resolve_user(uid):
        try:
            pk = urlsafe_base64_decode(uid).decode()
        except (TypeError, ValueError, UnicodeDecodeError):
            # The uid is whatever was in the URL, so it can be any text at all.
            return None

        # Checked before it reaches the query: filtering a primary key on
        # "abc" raises rather than returning nothing.
        if not pk.isdigit():
            return None

        return User.objects.filter(
            pk=pk, is_active=True, anonymised_at__isnull=True
        ).first()


class AccountDeleteSerializer(serializers.Serializer):
    """Erasing an account is irreversible, so it is not something a stolen
    session or a stray click should be able to do on its own."""

    current_password = serializers.CharField(write_only=True)

    def validate_current_password(self, value):
        if not self.context["request"].user.check_password(value):
            raise serializers.ValidationError("Your current password is not correct.")
        return value


class PackageSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)

    # Whether this shipment can still be added to, and why not when it cannot.
    # Sent with every shipment rather than fetched per row, so the profile page
    # can render a sent shipment read-only without a second request - and so
    # that a client which ignores it still meets the same refusal from the API,
    # which is where the rule actually lives. See Package.locked.
    locked = serializers.BooleanField(read_only=True)
    locked_for_customer = serializers.BooleanField(read_only=True)
    lock_reason = serializers.CharField(read_only=True)

    # Where the shipment is on its journey, for the details a customer opens
    # under "My shipments": the same reading as the Track & Trace lookup
    # (see public.py), so the two pages can never disagree.
    destination = serializers.CharField(source="destination_label", read_only=True)
    progress = serializers.IntegerField(read_only=True)
    stage_index = serializers.SerializerMethodField()
    stages = serializers.SerializerMethodField()
    # Photos the warehouse took of the package (warehouse PackagePhoto), shown
    # in the shipment's pop-up. Each `url` is the owner-only route below
    # (accounts views PackageViewSet.photo), never a public media address.
    photos = serializers.SerializerMethodField()
    # What the warehouse measured (the newest warehouse PackageMeasurement),
    # so the customer sees the size and weight next to the photos. Null until
    # the warehouse has measured it. Who measured it is staff business and is
    # left out.
    measurement = serializers.SerializerMethodField()

    class Meta:
        model = Package
        fields = [
            "id",
            "tracking_number",
            "description",
            "status",
            "status_display",
            "locked",
            "locked_for_customer",
            "lock_reason",
            "weight_kg",
            "value_eur",
            "delivery_address",
            "delivery_address_text",
            "shipped_at",
            "delivered_at",
            "estimated_arrival",
            "created_at",
            "destination",
            "progress",
            "stage_index",
            "stages",
            # "delivery" or "pickup": how the customer gets it at the end.
            "handover",
            # When the customer chose; set = locked, a change goes by e-mail.
            "handover_chosen_at",
            "photos",
            "measurement",
        ]
        # Customers read their shipments; only staff change them.
        read_only_fields = fields

    def get_stages(self, obj):
        return public_stages(obj)

    def get_photos(self, obj):
        # .all(), so the viewset's prefetch is used.
        return [
            {
                "id": photo.pk,
                "url": f"/packages/{obj.pk}/photos/{photo.pk}/",
                "uploaded_at": photo.uploaded_at,
            }
            for photo in obj.photos.all()
        ]

    def get_measurement(self, obj):
        # .all() and the first row, so the viewset's prefetch is used; the
        # model orders newest first, so that row is the current measurement.
        rows = list(obj.warehouse_measurements.all())
        if not rows:
            return None
        current = rows[0]
        return {
            "weight_kg": str(current.weight_kg),
            "length_cm": str(current.length_cm),
            "width_cm": str(current.width_cm),
            "height_cm": str(current.height_cm),
            "volume_m3": str(current.volume_m3),
            "measured_at": current.measured_at,
        }

    def get_stage_index(self, obj):
        # -1 for quoted and cancelled: not points on the journey.
        return public_stage_index(obj)


class PackageDocumentSerializer(serializers.ModelSerializer):
    """A customer's own upload, as both they and the office read it.

    There is no `file` here on purpose. The stored path must not reach any
    browser: it would be a MEDIA_URL link to somebody's receipt, guarded by
    nothing but the filename. `download_url` points at the view that checks
    who is asking instead.
    """

    kind_display = serializers.CharField(source="get_kind_display", read_only=True)
    # None when the document is not tied to a shipment, which is allowed —
    # see PackageDocument.package. The pages read it to decide between naming
    # the parcel and saying there is not one yet.
    tracking_number = serializers.CharField(
        source="package.tracking_number", read_only=True, default=None
    )
    # The id as well as the name: the dashboard's filing picker offers a
    # customer their own shipments, and matching on a displayed name would
    # break on two customers who share one.
    customer_name = serializers.SerializerMethodField()
    filename = serializers.CharField(read_only=True)
    uploaded_by_name = serializers.SerializerMethodField()
    download_url = serializers.SerializerMethodField()

    class Meta:
        model = PackageDocument
        fields = [
            "id",
            "package",
            "tracking_number",
            "customer",
            "customer_name",
            "kind",
            "kind_display",
            "note",
            "filename",
            "content_type",
            "size_bytes",
            "uploaded_by_name",
            "download_url",
            "created_at",
        ]
        read_only_fields = fields

    def get_customer_name(self, obj):
        # str(User) already handles the erased case, where there is no name
        # left to show.
        return str(obj.customer) if obj.customer_id else None

    def get_uploaded_by_name(self, obj):
        # str(User) already handles the erased case, where there is no name
        # left to show.
        return str(obj.uploaded_by) if obj.uploaded_by_id else None

    def get_download_url(self, obj):
        """The path, not an absolute URL, and deliberately.

        `request.build_absolute_uri` answers with the host Django was reached
        on. Behind a static host that rewrites /api to the API — which is how
        this site is deployed, and what keeps the session cookie first-party —
        that host is the API's own, not the one the browser is on. The link
        would then point off-origin, the browser would not attach a SameSite
        cookie to it, and the download would come back 403.

        A path resolves against whatever origin the page is already on, which
        is right in every arrangement this project supports: the Vite proxy in
        development, the rewrite in production, and Django serving both if it
        ever does.
        """
        return reverse("package-document-file", kwargs={"pk": obj.pk})


class PackageDocumentUploadSerializer(serializers.Serializer):
    """The body of a customer upload: one file, checked before it is stored.

    An uploaded file is the one thing on this API a browser hands over
    verbatim, so nothing about it is taken on trust. The name is decoration —
    storage picks the stored name — and the content type is whatever the
    browser felt like claiming. What actually decides is the extension being
    one we accept *and* the first bytes being what that kind really starts
    with, so a .exe renamed .pdf and an HTML page saved as .jpg both fail.
    """

    file = serializers.FileField()
    kind = serializers.ChoiceField(
        choices=PackageDocument.Kind.choices,
        default=PackageDocument.Kind.RECEIPT,
    )
    note = serializers.CharField(
        max_length=255,
        required=False,
        allow_blank=True,
        trim_whitespace=True,
    )

    def validate_file(self, uploaded):
        if uploaded.size == 0:
            raise serializers.ValidationError("That file is empty.")

        if uploaded.size > PackageDocument.MAX_BYTES:
            megabytes = PackageDocument.MAX_BYTES // (1024 * 1024)
            raise serializers.ValidationError(
                f"That file is larger than {megabytes} MB."
            )

        extension = os.path.splitext(uploaded.name or "")[1].lower()
        signatures = PackageDocument.SIGNATURES.get(extension)

        if signatures is None:
            raise serializers.ValidationError(
                "Only a PDF, JPG or PNG can be uploaded."
            )

        # Long enough for the longest signature we check for.
        head = uploaded.read(8)
        # Rewound, or whatever stores this afterwards starts part-way in and
        # writes a file no reader will open.
        uploaded.seek(0)

        if not any(head.startswith(signature) for signature in signatures):
            raise serializers.ValidationError(
                f"That file is named {extension} but is not one. Upload the "
                "original PDF, JPG or PNG."
            )

        return uploaded
