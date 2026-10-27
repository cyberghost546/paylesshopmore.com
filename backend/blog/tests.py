"""Tests for the blog.

What carries the weight: drafts never reach the public site, a visitor gets
an article in their language (or Dutch), only staff can write, and a cover
upload is checked like every other upload in this project.
"""

import shutil
import tempfile
from datetime import UTC, datetime

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse

from .models import BlogPost

User = get_user_model()

# The smallest thing that is really a PNG (the same bytes the shop tests use).
PNG_BYTES = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000a49444154789c6300010000050001"
    "0d0a2db40000000049454e44ae426082"
)


def make_post(slug, language="nl", published=True, when=None, **extra):
    return BlogPost.objects.create(
        slug=slug,
        language=language,
        title=extra.pop("title", f"{slug} ({language})"),
        summary="A short summary.",
        body="Some text.",
        is_published=published,
        published_at=when,
        **extra,
    )


class PublicBlogTests(TestCase):
    def setUp(self):
        # The starter posts from the data migration are not part of these
        # tests: each test sets up exactly what it reads.
        BlogPost.objects.all().delete()

    def list(self, lang=None):
        url = reverse("blog-list")
        return self.client.get(url, {"lang": lang} if lang else {}).json()

    def test_drafts_never_reach_the_public_site(self):
        make_post("shown")
        make_post("draft", published=False)

        slugs = [post["slug"] for post in self.list()]

        self.assertEqual(slugs, ["shown"])
        self.assertEqual(
            self.client.get(reverse("blog-post", args=["draft"])).status_code, 404
        )

    def test_each_article_once_in_the_visitors_language_or_dutch(self):
        make_post("both", "nl", title="Dutch")
        make_post("both", "en", title="English")
        make_post("dutch-only", "nl", title="Only Dutch")

        cards = {post["slug"]: post["title"] for post in self.list("en")}

        self.assertEqual(cards, {"both": "English", "dutch-only": "Only Dutch"})

    def test_an_article_in_the_visitors_language_and_which_others_exist(self):
        make_post("both", "nl", title="Dutch")
        make_post("both", "pap", title="Papiamentu")

        post = self.client.get(reverse("blog-post", args=["both"]), {"lang": "pap"}).json()

        self.assertEqual(post["title"], "Papiamentu")
        self.assertEqual(post["languages"], ["nl", "pap"])
        self.assertIn("body", post)

    def test_newest_first(self):
        make_post("old", when=datetime(2026, 1, 1, tzinfo=UTC))
        make_post("new", when=datetime(2026, 6, 1, tzinfo=UTC))

        self.assertEqual([post["slug"] for post in self.list()], ["new", "old"])

    def test_publishing_sets_the_date_once(self):
        post = make_post("dated", published=False)
        self.assertIsNone(post.published_at)

        post.is_published = True
        post.save()
        first = post.published_at
        self.assertIsNotNone(first)

        # Unpublish and publish again: the date stays.
        post.is_published = False
        post.save()
        post.is_published = True
        post.save()
        self.assertEqual(post.published_at, first)


class StarterPostsTests(TestCase):
    def test_three_starter_articles_in_three_languages(self):
        """From the data migration: the blog is not empty on day one."""
        for lang in ("nl", "en", "pap"):
            cards = self.client.get(reverse("blog-list"), {"lang": lang}).json()
            self.assertEqual(len(cards), 3)
            self.assertTrue(all(card["language"] == lang for card in cards))


class StaffBlogTests(TestCase):
    def setUp(self):
        BlogPost.objects.all().delete()
        self.staff = User.objects.create_user(
            username="office@example.com",
            email="office@example.com",
            password="a-long-enough-password",
            is_staff=True,
            first_name="Olga",
            last_name="Office",
        )
        self.customer = User.objects.create_user(
            username="customer@example.com",
            email="customer@example.com",
            password="a-long-enough-password",
        )
        self.media = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.media, ignore_errors=True)

    def test_only_staff_can_read_drafts_or_write(self):
        self.client.force_login(self.customer)
        self.assertEqual(self.client.get("/api/staff/blog/").status_code, 403)
        response = self.client.post(
            "/api/staff/blog/",
            {"slug": "x", "title": "X", "summary": "S", "body": "B"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)
        self.assertFalse(BlogPost.objects.exists())

    def test_staff_write_a_draft_then_publish_it(self):
        self.client.force_login(self.staff)

        created = self.client.post(
            "/api/staff/blog/",
            {
                "slug": "new-post",
                "language": "nl",
                "title": "  Nieuw bericht  ",
                "summary": "Kort.",
                "body": "Tekst.",
            },
            content_type="application/json",
        )
        self.assertEqual(created.status_code, 201)
        data = created.json()
        self.assertEqual(data["title"], "Nieuw bericht")
        self.assertFalse(data["is_published"])
        self.assertEqual(data["author_name"], "Olga Office")
        # A draft: not public yet.
        self.assertEqual(self.client.get(reverse("blog-list")).json(), [])

        published = self.client.patch(
            f"/api/staff/blog/{data['id']}/",
            {"is_published": True},
            content_type="application/json",
        )
        self.assertEqual(published.status_code, 200)
        self.assertIsNotNone(published.json()["published_at"])
        self.assertEqual(len(self.client.get(reverse("blog-list")).json()), 1)

    def test_one_version_per_language(self):
        make_post("same", "nl")
        self.client.force_login(self.staff)

        response = self.client.post(
            "/api/staff/blog/",
            {"slug": "same", "language": "nl", "title": "T", "summary": "S", "body": "B"},
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("slug", response.json())

    def test_a_cover_is_checked_and_served(self):
        self.client.force_login(self.staff)
        with override_settings(MEDIA_ROOT=self.media):
            response = self.client.post(
                "/api/staff/blog/",
                {
                    "slug": "with-cover",
                    "title": "T",
                    "summary": "S",
                    "body": "B",
                    "is_published": "true",
                    "cover": SimpleUploadedFile("cover.png", PNG_BYTES, content_type="image/png"),
                },
            )
            self.assertEqual(response.status_code, 201)
            cover = response.json()["cover_url"]
            self.assertEqual(cover, f"/blog/{response.json()['id']}/cover/")

            served = self.client.get(f"/api{cover}")
            self.assertEqual(served.status_code, 200)
            self.assertEqual(served["Content-Type"], "image/png")

            refused = self.client.post(
                "/api/staff/blog/",
                {
                    "slug": "bad-cover",
                    "title": "T",
                    "summary": "S",
                    "body": "B",
                    "cover": SimpleUploadedFile("page.html", b"<script>", content_type="text/html"),
                },
            )
            self.assertEqual(refused.status_code, 400)
            self.assertIn("cover", refused.json())

            # A page renamed to .png, with the browser's label to match, is
            # still refused: the bytes are what is checked.
            disguised = self.client.post(
                "/api/staff/blog/",
                {
                    "slug": "disguised-cover",
                    "title": "T",
                    "summary": "S",
                    "body": "B",
                    "cover": SimpleUploadedFile("cover.png", b"<html><script>", content_type="image/png"),
                },
            )
            self.assertEqual(disguised.status_code, 400)
            self.assertIn("cover", disguised.json())
