"""Public route for browser error reports, mounted under /api/ by config/urls.py.

The admin-only System page route lives in staff/urls.py, behind /api/staff/.
"""

from django.urls import path

from . import views

urlpatterns = [
    path("client-errors/", views.ClientErrorView.as_view(), name="client-errors"),
]
