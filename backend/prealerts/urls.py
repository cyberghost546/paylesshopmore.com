"""Mounted at /api/ (customer) - config/urls.py."""

from rest_framework.routers import SimpleRouter

from .views import PreAlertViewSet

router = SimpleRouter()
router.register("prealerts", PreAlertViewSet, basename="prealert")

urlpatterns = router.urls
