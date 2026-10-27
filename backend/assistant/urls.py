"""The chat assistant's route, mounted under /api/ by config/urls.py."""

from django.urls import path

from . import views

urlpatterns = [
    path("assistant/", views.AssistantView.as_view(), name="assistant"),
]
