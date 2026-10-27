from django.apps import AppConfig


class AccountsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'accounts'

    def ready(self):
        # Registers the deployment checks (config/checks.py). Imported here
        # because `config` is the project package rather than an app, so it
        # has no ready() of its own.
        # Every sign-in, however it happens: two-factor starts over and staff
        # get their idle timeout. See accounts/staff_sessions.py.
        from django.contrib.auth.signals import user_logged_in

        from config import checks  # noqa: F401

        from .staff_sessions import on_login

        user_logged_in.connect(on_login, dispatch_uid="accounts.staff_sessions.on_login")
