"""Photos on an intake sheet - of the damage, when "Schade aanwezig?" is Ja.

What matters: only real images get in, only the warehouse and the office can
see them, a mistake can be deleted, and a released sheet is locked, photos
included.
"""

import shutil
import tempfile

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.urls import reverse
from rest_framework import status

from config.testing import WarehouseAPITestCase

from .models import IntakeSheet, IntakeSheetPhoto

User = get_user_model()

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64

TEST_MEDIA = tempfile.mkdtemp(prefix="plsm-test-intake-photos-")


@override_settings(MEDIA_ROOT=TEST_MEDIA)
class IntakePhotoTests(WarehouseAPITestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(TEST_MEDIA, ignore_errors=True)

    def setUp(self):
        self.floor = User.objects.create_user(
            username="vloer@example.com",
            email="vloer@example.com",
            password="a-long-enough-password",
            is_warehouse=True,
        )
        self.customer = User.objects.create_user(
            username="klant@example.com", email="klant@example.com", password="a-long-enough-password"
        )
        self.sheet = IntakeSheet.objects.create(
            created_by=self.floor, damage_present=IntakeSheet.Check.YES
        )
        self.url = reverse("staff-intake-photos", args=[self.sheet.pk])

    def upload(self, *files, user=None):
        self.client.force_authenticate(user or self.floor)
        response = self.client.post(self.url, {"photos": list(files)}, format="multipart")
        self.client.force_authenticate(None)
        return response

    def test_a_worker_adds_photos_to_a_sheet(self):
        response = self.upload(
            SimpleUploadedFile("IMG_001.jpg", JPEG), SimpleUploadedFile("IMG_002.png", PNG)
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertEqual(len(response.data), 2)
        types = list(self.sheet.photos.values_list("content_type", flat=True))
        self.assertEqual(types, ["image/jpeg", "image/png"])
        self.assertEqual(self.sheet.photos.first().worker, self.floor)

    def test_only_real_images_get_in(self):
        response = self.upload(SimpleUploadedFile("photo.jpg", b"<html>not an image</html>"))

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(self.sheet.photos.exists())

    def test_at_most_ten_per_sheet(self):
        files = [SimpleUploadedFile(f"{n}.jpg", JPEG) for n in range(11)]

        response = self.upload(*files)

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(self.sheet.photos.exists())

    def test_a_photo_can_be_opened_and_deleted(self):
        self.upload(SimpleUploadedFile("IMG_001.jpg", JPEG))
        photo = self.sheet.photos.get()
        url = reverse("staff-intake-photo", args=[self.sheet.pk, photo.pk])
        self.client.force_authenticate(self.floor)

        opened = self.client.get(url)
        self.assertEqual(opened.status_code, status.HTTP_200_OK)
        self.assertEqual(opened["Content-Type"], "image/jpeg")

        deleted = self.client.delete(url)
        self.assertEqual(deleted.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(IntakeSheetPhoto.objects.exists())

    def test_a_customer_cannot_see_them(self):
        self.upload(SimpleUploadedFile("IMG_001.jpg", JPEG))
        self.client.force_authenticate(self.customer)

        self.assertEqual(self.client.get(self.url).status_code, status.HTTP_403_FORBIDDEN)

    def test_a_released_sheet_is_locked_photos_too(self):
        self.upload(SimpleUploadedFile("IMG_001.jpg", JPEG))
        photo = self.sheet.photos.get()
        self.sheet.release(by=self.floor)

        added = self.upload(SimpleUploadedFile("IMG_002.jpg", JPEG))
        self.client.force_authenticate(self.floor)
        deleted = self.client.delete(reverse("staff-intake-photo", args=[self.sheet.pk, photo.pk]))

        self.assertEqual(added.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(deleted.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(self.sheet.photos.count(), 1)
