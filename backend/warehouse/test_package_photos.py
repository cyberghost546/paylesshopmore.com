"""Photos of a package, taken at the warehouse for the customer to see.

The worker uploads them on the package page; the customer sees them in the
shipment's pop-up on their profile. What matters: only real images get in,
only the owner (and staff) can open them, and a mistake can be deleted.
"""

import shutil
import tempfile

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.urls import reverse
from rest_framework import status

from accounts.models import Package
from config.testing import WarehouseAPITestCase

from .models import PackageActivity, PackagePhoto

User = get_user_model()

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64

TEST_MEDIA = tempfile.mkdtemp(prefix="plsm-test-photos-")


@override_settings(MEDIA_ROOT=TEST_MEDIA)
class PackagePhotoTests(WarehouseAPITestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(TEST_MEDIA, ignore_errors=True)

    def setUp(self):
        self.customer = User.objects.create_user(
            username="klant@example.com", email="klant@example.com", password="a-long-enough-password"
        )
        self.stranger = User.objects.create_user(
            username="ander@example.com", email="ander@example.com", password="a-long-enough-password"
        )
        self.floor = User.objects.create_user(
            username="vloer@example.com",
            email="vloer@example.com",
            password="a-long-enough-password",
            is_warehouse=True,
        )
        self.package = Package.objects.create(
            user=self.customer,
            tracking_number="PLS-2001",
            description="Television",
            status=Package.Status.PAID,
        )

    def upload(self, *files):
        self.client.force_authenticate(self.floor)
        url = reverse("staff-warehouse-shipment-photos", args=[self.package.pk])
        response = self.client.post(url, {"photos": list(files)}, format="multipart")
        self.client.force_authenticate(None)
        return response

    def test_a_worker_adds_photos_and_it_is_logged(self):
        response = self.upload(
            SimpleUploadedFile("IMG_001.jpg", JPEG), SimpleUploadedFile("IMG_002.png", PNG)
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(len(response.data), 2)
        types = list(self.package.photos.values_list("content_type", flat=True))
        self.assertEqual(types, ["image/jpeg", "image/png"])
        self.assertTrue(
            PackageActivity.objects.filter(
                package=self.package, action=PackageActivity.Action.PHOTO_ADDED
            ).exists()
        )

    def test_only_real_images_get_in(self):
        response = self.upload(SimpleUploadedFile("photo.jpg", b"<html>not an image</html>"))
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(self.package.photos.exists())

    def test_at_most_ten_per_package(self):
        files = [SimpleUploadedFile(f"{n}.jpg", JPEG) for n in range(PackagePhoto.MAX_PER_PACKAGE + 1)]
        response = self.upload(*files)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(self.package.photos.exists())

    def test_a_customer_cannot_upload(self):
        self.client.force_authenticate(self.customer)
        url = reverse("staff-warehouse-shipment-photos", args=[self.package.pk])
        response = self.client.post(
            url, {"photos": [SimpleUploadedFile("a.jpg", JPEG)]}, format="multipart"
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_the_customer_sees_and_opens_them(self):
        self.upload(SimpleUploadedFile("IMG_001.jpg", JPEG))

        self.client.force_authenticate(self.customer)
        listed = self.client.get(reverse("package-list")).data
        # Paginated: the rows are under "results".
        shipment = (listed["results"] if isinstance(listed, dict) else listed)[0]
        self.assertEqual(len(shipment["photos"]), 1)

        url = "/api" + shipment["photos"][0]["url"]
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["Content-Type"], "image/jpeg")
        self.assertEqual(b"".join(response.streaming_content), JPEG)

    def test_nobody_else_can_open_them(self):
        self.upload(SimpleUploadedFile("IMG_001.jpg", JPEG))
        photo = self.package.photos.get()
        url = reverse("package-photo", args=[self.package.pk, photo.pk])

        self.client.force_authenticate(self.stranger)
        self.assertEqual(self.client.get(url).status_code, status.HTTP_404_NOT_FOUND)

        self.client.force_authenticate(None)
        self.assertIn(
            self.client.get(url).status_code,
            (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN),
        )

    def test_a_worker_can_delete_a_wrong_photo(self):
        self.upload(SimpleUploadedFile("wrong-box.jpg", JPEG))
        photo = self.package.photos.get()

        self.client.force_authenticate(self.floor)
        url = reverse("staff-warehouse-shipment-photo", args=[self.package.pk, photo.pk])
        self.assertEqual(self.client.get(url).status_code, status.HTTP_200_OK)
        response = self.client.delete(url)

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(self.package.photos.exists())
        self.assertTrue(
            PackageActivity.objects.filter(
                package=self.package, action=PackageActivity.Action.PHOTO_REMOVED
            ).exists()
        )
