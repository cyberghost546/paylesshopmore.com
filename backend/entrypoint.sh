#!/bin/sh
# Start the web process: migrate, then hand the container over to gunicorn.
#
# This exists so that a failure to reach the database says so. The previous
# `migrate && exec gunicorn` chain was correct, but when migrate failed the
# container exited before anything listened on the port, and the only thing
# the platform reported was five minutes of "service unavailable" -- which
# reads like a crashed application rather than a missing variable.
set -e

echo "==> Database target: ${DATABASE_URL%%\?*}" | sed 's|://[^@]*@|://***:***@|'
echo "==> Running migrations"

if ! python manage.py migrate --noinput; then
  echo ""
  echo "!!! Migrations failed -- the web process will not start."
  echo "!!! The health check will report 'service unavailable' because"
  echo "!!! nothing ever binds to the port, not because the app crashed."
  echo "!!!"
  echo "!!! Almost always this is the database connection. Check that:"
  echo "!!!   - DATABASE_URL is set on the api component, as an encrypted"
  echo "!!!     variable, and is the database's full connection string."
  echo "!!!   - the App is in the database's Trusted Sources."
  echo "!!!   - DJANGO_DB_SSL_REQUIRE=0 if the database is reached over a"
  echo "!!!     private network that does not terminate TLS."
  exit 1
fi

# The cache table, for a deployment without REDIS_URL (see the Cache section
# of config/settings.py). Does nothing when the table exists or when the cache
# is Redis. Rate limits and sign-in lockouts are counted in it, so a site
# that cannot make it does not start.
echo "==> Ensuring the cache table"
python manage.py createcachetable

echo "==> Starting gunicorn on port ${PORT:-8000}"
exec gunicorn config.wsgi:application \
  --bind "0.0.0.0:${PORT:-8000}" \
  --workers "${WEB_CONCURRENCY:-3}" \
  --timeout 60 \
  --access-logfile - \
  --error-logfile -
