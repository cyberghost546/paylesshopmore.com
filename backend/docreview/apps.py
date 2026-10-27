from django.apps import AppConfig


class DocreviewConfig(AppConfig):
    """AI document reading with human review. Start at docreview/models.py."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "docreview"
    verbose_name = "Document review"
