"""The integration routes, mounted at /api/integrations/v1/ by config/urls.py.

What each one does and which scope it needs: views.py. The guide for the
other side: docs/INTEGRATIONS.md.
"""

from django.urls import path

from docreview.views import InboundEmailView

from . import views

urlpatterns = [
    path("ping/", views.PingView.as_view(), name="integration-ping"),
    path("shipments/", views.ShipmentListView.as_view(), name="integration-shipments"),
    path("invoices/", views.InvoiceListView.as_view(), name="integration-invoices"),
    path("invoices/<int:pk>/pdf/", views.InvoicePdfView.as_view(), name="integration-invoice-pdf"),
    path("events/", views.EventCreateView.as_view(), name="integration-events"),
    # E-mails with documents to read: AI document reading (docreview/views.py).
    path("documents/", InboundEmailView.as_view(), name="integration-documents"),
]
