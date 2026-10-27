"""Reading documents on the Celery worker (or straight away when there is no
broker - see CELERY_TASK_ALWAYS_EAGER in config/settings.py)."""

from celery import shared_task

from . import pipeline

# Seconds to wait before the machine tries again after the AI service was busy.
RETRY_DELAY = 60


@shared_task(bind=True)
def process_document_job(self, job_id):
    """Steps 3-7 of docreview/pipeline.py for one job.

    pipeline.process_job puts a job back on "queued" when the AI service was
    busy or unreachable (at most MAX_AUTOMATIC_ATTEMPTS times); then this
    task schedules itself again a little later.
    """
    outcome = pipeline.process_job(job_id)
    if outcome == "retry":
        process_document_job.apply_async((job_id,), countdown=RETRY_DELAY)
    return outcome
