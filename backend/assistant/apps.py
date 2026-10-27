from django.apps import AppConfig


class AssistantConfig(AppConfig):
    """The website's chat assistant (OpenAI). Start at assistant/ai.py."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "assistant"
    verbose_name = "Chat assistant"
