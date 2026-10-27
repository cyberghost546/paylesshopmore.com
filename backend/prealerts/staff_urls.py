"""Mounted at /api/staff/prealerts/ - config/urls.py."""

from rest_framework.routers import SimpleRouter

from .views import StaffPreAlertViewSet

router = SimpleRouter()
router.register("", StaffPreAlertViewSet, basename="staff-prealert")

urlpatterns = router.urls
