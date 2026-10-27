"""The public blog routes, mounted under /api/ by config/urls.py."""

from django.urls import path

from . import views

urlpatterns = [
    path("blog/", views.PublicBlogListView.as_view(), name="blog-list"),
    path("blog/<int:pk>/cover/", views.PublicBlogCoverView.as_view(), name="blog-cover"),
    path("blog/<slug:slug>/", views.PublicBlogPostView.as_view(), name="blog-post"),
]
