"""Mounted at /api/staff/carrier-tracking/ (config/urls.py)."""

from rest_framework.routers import SimpleRouter

from .staff_views import StaffCarrierShipmentViewSet

router = SimpleRouter()
router.register("", StaffCarrierShipmentViewSet, basename="staff-carrier-shipment")

urlpatterns = router.urls
