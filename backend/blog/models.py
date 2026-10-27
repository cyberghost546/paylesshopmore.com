"""The blog: short articles the office writes for customers.

Written and published from the staff dashboard (the Blog page) by any staff
account; the public site shows the published ones at /blog.

LANGUAGES. A post is written in one language. The same article in another
language is a second post with the SAME slug - that is what ties them
together. The site shows a visitor the version in their language and falls
back to the Dutch one (the site's default) when there is none.

THE TEXT is plain text with three simple rules, so staff never type HTML:
  - an empty line starts a new paragraph
  - a line starting with "## " is a heading
  - lines starting with "- " are a bullet list
The React app turns that into paragraphs, headings and lists. Nothing in it
is ever treated as HTML, so a post cannot inject markup or script.

The cover picture is a FileField rather than an ImageField for the same
reason as the shop logos (see shops/models.py): no Pillow dependency, and the
checks that matter are made in the serializer.
"""

from pathlib import Path

from django.conf import settings
from django.db import models
from django.utils import timezone

ALLOWED_COVER_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}

# What the cover route answers with, by extension - a fixed map, so the bytes
# are only ever labelled as one of the kinds this app accepts.
COVER_CONTENT_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}


def blog_cover_path(instance, filename):
    """Where an uploaded cover is stored. Django sanitises the name and adds
    a suffix on collision, so an upload cannot overwrite another."""
    return f"blog-covers/{filename}"


class BlogPost(models.Model):
    class Language(models.TextChoices):
        DUTCH = "nl", "Nederlands"
        ENGLISH = "en", "English"
        PAPIAMENTU = "pap", "Papiamentu"

    language = models.CharField(
        max_length=3, choices=Language.choices, default=Language.DUTCH
    )

    # The address: /blog/<slug>. Shared by the versions of one article in
    # different languages (see the note at the top).
    slug = models.SlugField(max_length=120)

    title = models.CharField(max_length=160)

    # One or two sentences for the card on the blog's index page.
    summary = models.CharField(max_length=300)

    # The article. Plain text - see "THE TEXT" at the top.
    body = models.TextField()

    cover = models.FileField(upload_to=blog_cover_path, blank=True)

    # Drafts are invisible to the public site until this is ticked.
    is_published = models.BooleanField(default=False)

    # Set the first time a post is published, and shown as its date. Kept
    # when it is unpublished and published again, so a quick fix does not
    # move an old article to the top.
    published_at = models.DateTimeField(null=True, blank=True)

    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="blog_posts",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-published_at", "-created_at"]
        constraints = [
            # One version of an article per language.
            models.UniqueConstraint(
                fields=["slug", "language"], name="blog_unique_slug_per_language"
            )
        ]
        indexes = [models.Index(fields=["is_published", "-published_at"])]

    def __str__(self):
        return f"{self.title} ({self.language})"

    def save(self, *args, **kwargs):
        if self.is_published and self.published_at is None:
            self.published_at = timezone.now()
        super().save(*args, **kwargs)

    @property
    def cover_content_type(self):
        return COVER_CONTENT_TYPES.get(Path(self.cover.name).suffix.lower(), "")
