"""A ceiling on the size of a request to the public upload endpoints.

DATA_UPLOAD_MAX_MEMORY_SIZE does not cover this: Django documents it as
"excluding any file upload data", so a multipart request carrying ten 10 MB
files passes it untouched. Each file is checked on its own, but nothing
checked the request as a whole, and an anonymous booking could carry about
100 MB.

This middleware reads the declared Content-Length before Django parses the
body and refuses an oversized request with 413, so the bytes are never spooled
to disk. It only applies to the endpoints anyone can post to without signing
in; the staff and warehouse APIs legitimately send larger batches (ten photos
of up to 10 MB each) and are not touched.

A POST to one of these endpoints that does not say how long it is is refused
too (411): every browser sends Content-Length with a form or a file, and
without it the size could not be checked before reading.
"""

from django.conf import settings
from django.http import JsonResponse

# Exact paths, not prefixes: /api/bookings/mine/... is a signed-in customer's
# own area and is not a public upload endpoint.
PUBLIC_UPLOAD_PATHS = frozenset(
    {
        "/api/bookings/",
        "/api/quote/",
        "/api/contact/",
        "/api/auth/signup/",
    }
)


class PublicRequestSizeLimitMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.method == "POST" and request.path in PUBLIC_UPLOAD_PATHS:
            limit = settings.PUBLIC_REQUEST_MAX_BYTES
            declared = request.META.get("CONTENT_LENGTH")

            if not declared:
                return JsonResponse(
                    {"detail": "The request must say how large it is."}, status=411
                )

            try:
                length = int(declared)
            except ValueError:
                return JsonResponse({"detail": "Invalid Content-Length."}, status=400)

            if length > limit:
                megabytes = limit // (1024 * 1024)
                return JsonResponse(
                    {
                        "detail": (
                            f"That is too much to send at once (more than {megabytes} MB). "
                            "Send fewer or smaller files."
                        ),
                        "code": "request_too_large",
                    },
                    status=413,
                )

        return self.get_response(request)
