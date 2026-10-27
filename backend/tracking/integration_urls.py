"""Mounted at /api/staff/tracking-integrations/ (config/urls.py). Admins only."""

from django.urls import path

from .integration_views import IntegrationDetailView, IntegrationListView, IntegrationTestView

urlpatterns = [
    path("", IntegrationListView.as_view(), name="tracking-integrations"),
    path("<slug:code>/", IntegrationDetailView.as_view(), name="tracking-integration"),
    path("<slug:code>/test/", IntegrationTestView.as_view(), name="tracking-integration-test"),
]
