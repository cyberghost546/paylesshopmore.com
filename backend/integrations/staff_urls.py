"""The Integrations page's routes, mounted at /api/staff/integrations/ by staff/urls.py.

What each one does: staff_api.py. Admins only.
"""

from django.urls import path

from . import staff_api

urlpatterns = [
    path("options/", staff_api.OptionsView.as_view(), name="staff-integration-options"),
    path("keys/", staff_api.KeyListView.as_view(), name="staff-integration-keys"),
    path("keys/<int:pk>/revoke/", staff_api.KeyRevokeView.as_view(), name="staff-integration-key-revoke"),
    path("webhooks/", staff_api.EndpointListView.as_view(), name="staff-integration-webhooks"),
    path("webhooks/<int:pk>/", staff_api.EndpointDetailView.as_view(), name="staff-integration-webhook"),
    path("webhooks/<int:pk>/test/", staff_api.EndpointTestView.as_view(), name="staff-integration-webhook-test"),
    path("deliveries/", staff_api.DeliveryListView.as_view(), name="staff-integration-deliveries"),
    path(
        "deliveries/<uuid:pk>/retry/",
        staff_api.DeliveryRetryView.as_view(),
        name="staff-integration-delivery-retry",
    ),
    path("inbound-events/", staff_api.InboundEventListView.as_view(), name="staff-integration-inbound"),
]
