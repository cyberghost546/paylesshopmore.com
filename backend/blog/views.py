"""The blog API.

Public, read-only, published posts only:
  GET /api/blog/?lang=nl             the index: one card per article
  GET /api/blog/<slug>/?lang=nl      one article
  GET /api/blog/<id>/cover/          an article's cover picture

Staff, behind IsStaff (registered under /api/staff/ by staff/urls.py):
  /api/staff/blog/                   every post, drafts too; create, edit, delete
  /api/staff/blog/<id>/cover/        a cover as the dashboard sees it

The language rule: a visitor gets each article in their language, or in
Dutch (the site's default) when it has not been written in theirs, or in
whatever language it exists in when there is not even a Dutch one.
"""

from pathlib import Path

from django.http import FileResponse, Http404
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from staff.permissions import IsStaff

from .models import BlogPost
from .serializers import (
    PublicBlogListSerializer,
    PublicBlogPostSerializer,
    StaffBlogPostSerializer,
)

DEFAULT_LANGUAGE = BlogPost.Language.DUTCH


def wanted_language(request):
    lang = request.query_params.get("lang", DEFAULT_LANGUAGE)
    return lang if lang in BlogPost.Language.values else DEFAULT_LANGUAGE


def best_version(versions, lang):
    """Of one article's versions, the one to show: the visitor's language,
    then Dutch, then any."""
    by_language = {post.language: post for post in versions}
    return by_language.get(lang) or by_language.get(DEFAULT_LANGUAGE) or versions[0]


def cover_response(post):
    """Stream a cover picture, inline, labelled from a fixed map of types."""
    if not post.cover:
        raise Http404("This post has no cover.")
    try:
        handle = post.cover.open("rb")
    except FileNotFoundError as error:
        raise Http404("This cover is missing.") from error
    return FileResponse(
        handle, filename=Path(post.cover.name).name, content_type=post.cover_content_type
    )


class PublicBlogListView(APIView):
    """One card per published article, in the visitor's language where it
    exists, newest first."""

    permission_classes = [AllowAny]

    def get(self, request):
        lang = wanted_language(request)
        articles = {}
        for post in BlogPost.objects.filter(is_published=True):
            articles.setdefault(post.slug, []).append(post)

        shown = [best_version(versions, lang) for versions in articles.values()]
        shown.sort(key=lambda post: post.published_at, reverse=True)
        return Response(PublicBlogListSerializer(shown, many=True).data)


class PublicBlogPostView(APIView):
    """One published article, in the visitor's language where it exists."""

    permission_classes = [AllowAny]

    def get(self, request, slug):
        versions = list(BlogPost.objects.filter(slug=slug, is_published=True))
        if not versions:
            raise Http404("No such article.")
        post = best_version(versions, wanted_language(request))
        return Response(PublicBlogPostSerializer(post).data)


class PublicBlogCoverView(APIView):
    """A published article's cover, for the <img> on the public pages."""

    permission_classes = [AllowAny]

    def get(self, request, pk):
        try:
            post = BlogPost.objects.get(pk=pk, is_published=True)
        except BlogPost.DoesNotExist as error:
            raise Http404("No such article.") from error
        return cover_response(post)


class StaffBlogPostViewSet(viewsets.ModelViewSet):
    """The dashboard's view: every post, drafts included, with write access."""

    serializer_class = StaffBlogPostSerializer
    permission_classes = [IsStaff]
    queryset = BlogPost.objects.select_related("author")
    # A cover may come with the post; JSON for edits that do not touch it.
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    # A blog has tens of posts, not thousands: the whole list at once.
    pagination_class = None

    def perform_create(self, serializer):
        serializer.save(author=self.request.user)

    @action(detail=True, methods=["get"])
    def cover(self, request, pk=None):
        """A cover as the dashboard sees it - also on a draft."""
        return cover_response(self.get_object())

    def destroy(self, request, *args, **kwargs):
        post = self.get_object()
        if post.cover:
            post.cover.delete(save=False)
        post.delete()
        return Response(status=204)
