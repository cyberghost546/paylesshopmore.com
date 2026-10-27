"""Dashboard lists must not cost one query per row ("N+1").

Each test measures a page with a few rows, adds more rows, and measures again.
If the count grows, something on each row is fetching a related object on its
own - add it to the view's select_related / prefetch_related.
"""

import shutil
import tempfile

from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.db import connection
from django.test import override_settings
from django.test.utils import CaptureQueriesContext

from accounts.models import Address, Package, PackageDocument
from config.testing import ThrottleFreeAPITestCase

User = get_user_model()


class QueryCountTests(ThrottleFreeAPITestCase):
    def setUp(self):
        super().setUp()
        media = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, media, ignore_errors=True)
        override = override_settings(MEDIA_ROOT=media)
        override.enable()
        self.addCleanup(override.disable)

        self.admin = User.objects.create_user(
            username="baas@example.com", email="baas@example.com", password="x" * 12, role=User.Role.ADMIN
        )
        self.client.force_authenticate(self.admin)
        self.made = 0

    def add_packages(self, count):
        """Packages with everything a row shows: owner, address, a document."""
        for _ in range(count):
            self.made += 1
            n = self.made
            customer = User.objects.create_user(
                username=f"klant{n}@example.com", email=f"klant{n}@example.com", password="x" * 12
            )
            address = Address.objects.create(
                user=customer, street="Kaya", house_number=str(n), city="Willemstad",
                country=Address.Country.CURACAO, is_default=True,
            )
            package = Package.objects.create(
                user=customer, delivery_address=address, tracking_number=f"PLSM-{n:04d}"
            )
            document = PackageDocument(
                customer=customer, package=package, uploaded_by=customer,
                original_name="bon.pdf", content_type="application/pdf", size_bytes=5,
            )
            document.file.save("bon.pdf", ContentFile(b"%PDF-"), save=True)

    def queries_for(self, url):
        with CaptureQueriesContext(connection) as context:
            response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        return len(context.captured_queries)

    def assert_constant(self, url):
        self.add_packages(3)
        few = self.queries_for(url)
        self.add_packages(6)
        many = self.queries_for(url)
        self.assertEqual(few, many, f"{url} went from {few} to {many} queries with more rows")

    def test_packages_list(self):
        self.assert_constant("/api/staff/packages/")

    def test_overview(self):
        self.assert_constant("/api/staff/overview/")

    def test_customers_list(self):
        self.assert_constant("/api/staff/customers/")

    def test_documents_list(self):
        self.assert_constant("/api/documents/")
