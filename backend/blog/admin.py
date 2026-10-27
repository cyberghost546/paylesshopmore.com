from django.contrib import admin

from .models import BlogPost


@admin.register(BlogPost)
class BlogPostAdmin(admin.ModelAdmin):
    list_display = ("title", "language", "slug", "is_published", "published_at")
    list_filter = ("is_published", "language")
    search_fields = ("title", "slug", "summary", "body")
    prepopulated_fields = {"slug": ("title",)}
