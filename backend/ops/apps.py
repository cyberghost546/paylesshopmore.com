from django.apps import AppConfig


class OpsConfig(AppConfig):
    """Keeping the site healthy: database backups and error reports.

    Nothing a customer ever sees. See ops/backup.py for the backups and
    ops/views.py for the dashboard's "System" page and the browser's error
    reports.
    """

    default_auto_field = "django.db.models.BigAutoField"
    name = "ops"
    verbose_name = "Operations"
