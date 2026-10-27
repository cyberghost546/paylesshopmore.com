"""Serializers for the blog.

The public ones are read-only. The staff one accepts an uploaded cover, so
its size, extension and content type are all checked here.
"""

from pathlib import Path

from rest_framework import serializers

from warehouse.models import PackageDamagePhoto

from .models import ALLOWED_COVER_EXTENSIONS, COVER_CONTENT_TYPES, BlogPost

# A photo for the top of an article. Generous, but not unlimited.
MAX_COVER_BYTES = 5 * 1024 * 1024

ALLOWED_COVER_CONTENT_TYPES = {"image/png", "image/jpeg", "image/webp"}


def cover_path(post):
    """The API path the cover is served from, or None when there is none.

    A route rather than MEDIA_URL, which Django only serves while DEBUG is on
    (see shops/serializers.py). The frontend makes it a full URL with apiUrl().
    """
    return f"/blog/{post.pk}/cover/" if post.cover else None


class PublicBlogListSerializer(serializers.ModelSerializer):
    """A card on the blog's index page."""

    cover = serializers.SerializerMethodField()

    class Meta:
        model = BlogPost
        fields = ["slug", "language", "title", "summary", "cover", "published_at"]

    def get_cover(self, post):
        return cover_path(post)


class PublicBlogPostSerializer(PublicBlogListSerializer):
    """One article, as the article page shows it."""

    # The languages this article exists in, so the page can say so.
    languages = serializers.SerializerMethodField()

    class Meta(PublicBlogListSerializer.Meta):
        fields = PublicBlogListSerializer.Meta.fields + ["body", "languages"]

    def get_languages(self, post):
        return sorted(
            BlogPost.objects.filter(slug=post.slug, is_published=True).values_list(
                "language", flat=True
            )
        )


class StaffBlogPostSerializer(serializers.ModelSerializer):
    """What the dashboard reads and writes."""

    # Written as an upload, read back as the path it is served from.
    cover = serializers.FileField(write_only=True, required=False, allow_null=True)
    cover_url = serializers.SerializerMethodField()
    author_name = serializers.SerializerMethodField()

    class Meta:
        model = BlogPost
        fields = [
            "id",
            "language",
            "slug",
            "title",
            "summary",
            "body",
            "cover",
            "cover_url",
            "is_published",
            "published_at",
            "author_name",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "published_at", "author_name", "created_at", "updated_at"]
        # The automatic "slug and language must be unique" check is replaced
        # by validate() below, which says it in words staff understand.
        validators = []

    def get_cover_url(self, post):
        return cover_path(post)

    def get_author_name(self, post):
        if not post.author:
            return None
        return post.author.get_full_name() or post.author.email

    def validate_title(self, value):
        title = value.strip()
        if not title:
            raise serializers.ValidationError("A post needs a title.")
        return title

    def validate_body(self, value):
        if not value.strip():
            raise serializers.ValidationError("A post needs some text.")
        return value

    def validate_cover(self, value):
        # None clears the cover.
        if value is None:
            return value
        if value.size > MAX_COVER_BYTES:
            raise serializers.ValidationError("A cover picture must be 5 MB or smaller.")
        if Path(value.name).suffix.lower() not in ALLOWED_COVER_EXTENSIONS:
            raise serializers.ValidationError("A cover must be a PNG, JPEG or WebP file.")
        content_type = getattr(value, "content_type", None)
        if content_type and content_type not in ALLOWED_COVER_CONTENT_TYPES:
            raise serializers.ValidationError("A cover must be a PNG, JPEG or WebP file.")
        # The bytes must really be the picture the extension names, since the
        # extension is what the cover route labels them as (see the shop logo).
        head = value.read(12)
        value.seek(0)
        if PackageDamagePhoto.sniff(head) != COVER_CONTENT_TYPES.get(Path(value.name).suffix.lower()):
            raise serializers.ValidationError(
                "That file is not a PNG, JPEG or WebP picture, whatever its name says."
            )
        return value

    def validate(self, attrs):
        # One version per language: a friendly message rather than a 500 from
        # the database constraint.
        slug = attrs.get("slug", getattr(self.instance, "slug", None))
        language = attrs.get("language", getattr(self.instance, "language", None))
        clash = BlogPost.objects.filter(slug=slug, language=language)
        if self.instance:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError(
                {"slug": "There is already a post with this address in this language."}
            )
        return attrs
