"""Mounted at /api/tracking/ (config/urls.py)."""

from django.urls import path

from . import views

urlpatterns = [
    path("carriers/", views.CarrierListView.as_view(), name="tracking-carriers"),
    path(
        "webhooks/17track/",
        views.SeventeenTrackWebhookView.as_view(),
        name="tracking-webhook-17track",
    ),
]
