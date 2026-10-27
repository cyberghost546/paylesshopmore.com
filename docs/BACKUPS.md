# Database backups and error monitoring

This page covers how the site makes a copy of its database every night, how to get that copy back, and how errors reach us.

---

## 1. Backups: how it works

Every night at 03:00 UTC a scheduled job (`database-backup` in `.do/app.yaml`) runs:

```
python manage.py backup_database
```

That command (code: `backend/ops/backup.py`):

1. Dumps the whole Postgres database with `pg_dump --format=custom`. The dump is a single compressed file, e.g. `db-2026-10-23_030000.dump`.
2. Uploads the file to a **private** S3-compatible bucket, such as Cloudflare R2, Amazon S3 or Backblaze B2.
3. Deletes copies older than `BACKUP_KEEP_DAYS` (30 days by default). The newest `BACKUP_KEEP_MIN` copies (7 by default) are never deleted.
4. Writes a row to the `BackupRun` table. The dashboard's **System** page shows these rows.

If a backup fails:

- the System page shows it in red, with the reason;
- every admin gets an e-mail with the subject "Database backup FAILED";
- DigitalOcean marks the run as failed;
- if Sentry is set up, the error shows up there. Sentry also e-mails you when a night is **missed** entirely (cron monitor `database-backup`).

## 2. Backups: one-time setup

### a. Create a private bucket

For example, in Cloudflare R2: **R2 → Create bucket**, named something like `plsm-backups`.

- Do **not** make it public, and do **not** use the media bucket (`AWS_STORAGE_BUCKET_NAME`). A backup holds every customer's name, address and orders. The command refuses to run when the two buckets are the same.
- Create an API token that can read and write **only** this bucket.

### b. Switch on the scheduled job

In `.do/app.yaml`, uncomment the `jobs:` block (at least `database-backup`) and apply the spec again: App → **Settings → App Spec → Edit**.

### c. Set its variables

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | the same as the api component |
| `DJANGO_SECRET_KEY` | the same as the web service |
| `BACKUP_S3_BUCKET` | `plsm-backups` |
| `BACKUP_S3_ENDPOINT_URL` | e.g. `https://<account-id>.r2.cloudflarestorage.com` |
| `BACKUP_S3_ACCESS_KEY_ID` / `BACKUP_S3_SECRET_ACCESS_KEY` | the token from step a |
| `EMAIL_HOST`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `DJANGO_FROM_EMAIL` | the same as the web service, so failure e-mails go out |
| `SENTRY_DSN` | the same as the web service (optional, but recommended) |

Optional: `BACKUP_KEEP_DAYS` (default 30), `BACKUP_KEEP_MIN` (default 7), `BACKUP_S3_PREFIX` (default `backups/`).

If you leave out `BACKUP_S3_ENDPOINT_URL` and the keys, the media bucket's `AWS_*` values are used. That is fine when both buckets are on the same storage account.

### d. Test it

Run the job once from its page in the App, or wait for 03:00. Then open **Dashboard → System**. The newest backup should say **OK**, with a size.

> The Docker image installs `pg_dump` version 18 (`PG_CLIENT_VERSION` in the Dockerfile). `pg_dump` refuses to dump a **newer** server, so if the managed Postgres is ever upgraded past 18, raise that number.

## 3. Restoring a backup

**Practise this once on a test database.** A backup nobody has ever restored is only a hope.

1. Download the file you want from the bucket (in R2: open the bucket, click the file, then **Download**).
2. Restore it into an **empty** database with `pg_restore`. You need the PostgreSQL client tools on your computer. DigitalOcean shows a database's connection string on its **Overview** page, under *Connection Details*.

   ```bash
   # Into a brand-new, empty database (safest: check it, then switch the site over):
   pg_restore --no-owner --no-privileges --dbname "postgresql://USER:PASSWORD@HOST:PORT/NEWDB" db-2026-10-23_030000.dump

   # Or OVER the existing database (this replaces everything in it!):
   pg_restore --clean --if-exists --no-owner --no-privileges --dbname "$DATABASE_URL" db-2026-10-23_030000.dump
   ```

3. If you restored into a new database, point the web service's `DATABASE_URL` at it and redeploy.

To see what is inside a dump without restoring it: `pg_restore --list db-....dump`.

On a developer's computer without a bucket, `manage.py backup_database` writes a gzipped copy of `db.sqlite3` to `backend/backups/` (ignored by git). To restore it, unzip it and put it back as `db.sqlite3`.

---

## 4. Error monitoring

### Server errors (Django, Celery workers, scheduled jobs)

These go to **Sentry** once `SENTRY_DSN` is set on each component. See the "Error reporting" section of `backend/config/settings.py`. Without Sentry they are still in the DigitalOcean runtime logs, but nobody gets told.

Setup: create a free project at sentry.io (platform: Django). Copy its DSN into `SENTRY_DSN` on the web, worker and cron services. Optionally set `SENTRY_ENVIRONMENT=production`.

### Browser errors (the React site)

When something crashes in a visitor's browser, the site reports it to `POST /api/client-errors/`. The frontend code is in `frontend/src/utils/errorReporting.js`. The server writes each report to the log as an ERROR under the name `frontend`, so with Sentry on, browser errors arrive in the same Sentry project as server errors. The reports:

- never include who was signed in, cookies or form contents: only the error message, where in the code it happened, the page address and the browser;
- are rate-limited (30 per visitor per hour), and the browser sends at most 10 per page visit.

### Checking it all at a glance

**Dashboard → System** (admins only) shows the last backups, whether Sentry is on, and whether the site can send e-mail.
