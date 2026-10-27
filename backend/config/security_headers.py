"""A Content-Security-Policy for the API's JSON answers.

READ THIS FIRST
---------------
The website's pages (the React app) get their policy from Vercel and from
frontend/index.html. This is about the backend's own answers: the JSON that
/api/... sends back.

JSON is data, never a page - so the safest policy is "this answer may load
nothing and may not be shown inside any frame":

    Content-Security-Policy: default-src 'none'; frame-ancestors 'none'

Why bother, if nobody opens JSON as a page? Because if a browser is ever
tricked into rendering one as HTML (an old bug, a wrong content type), there is
nothing it is allowed to run or load. It costs nothing.

Only JSON answers get it. A PDF or a photo is left alone: browsers show those
with their own viewers, which a "load nothing" policy can break - and the
routes that send them set their own headers (staff/views.py InvoiceViewSet.pdf).
An answer that already has a policy keeps it.
"""

API_POLICY = "default-src 'none'; frame-ancestors 'none'"


class ApiContentSecurityPolicyMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        content_type = response.get("Content-Type", "")
        if (
            request.path.startswith("/api/")
            and content_type.startswith("application/json")
            and "Content-Security-Policy" not in response
        ):
            response["Content-Security-Policy"] = API_POLICY
        return response
