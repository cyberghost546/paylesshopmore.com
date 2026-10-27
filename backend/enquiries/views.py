"""Public endpoints for the contact and quote forms.

Both are open to anonymous visitors, which makes them the most exposed part of
the API: throttled, size-limited, and write-only.
"""

from rest_framework import generics, status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from config import abuse

from .models import ContactMessage, QuoteRequest
from .serializers import ContactMessageSerializer, QuoteRequestSerializer
from .sorting import sort_when_received


class ContactMessageView(generics.CreateAPIView):
    """POST only. Nothing reads messages back out over the API — staff read
    them in the admin, so a bug here cannot leak what other people wrote."""

    queryset = ContactMessage.objects.all()
    serializer_class = ContactMessageSerializer
    permission_classes = [AllowAny]
    throttle_scope = "forms"
    throttle_classes = [ScopedRateThrottle]

    def create(self, request, *args, **kwargs):
        # Site-wide ceiling as well as the per-IP throttle: see config/abuse.py.
        abuse.check("contact")
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        message = serializer.save()
        abuse.record("contact")
        # Topic and urgency for the office, on the worker - never making the
        # visitor wait (enquiries/sorting.py).
        sort_when_received(message)

        # Deliberately does not echo the submission back.
        return Response(status=status.HTTP_201_CREATED)


class QuoteRequestView(generics.CreateAPIView):
    queryset = QuoteRequest.objects.all()
    serializer_class = QuoteRequestSerializer
    permission_classes = [AllowAny]
    throttle_scope = "forms"
    throttle_classes = [ScopedRateThrottle]

    # MultiPartParser because the request may carry a file; JSON for the
    # requests that do not.
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def create(self, request, *args, **kwargs):
        abuse.check("quote")
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        abuse.record("quote")

        return Response(status=status.HTTP_201_CREATED)
