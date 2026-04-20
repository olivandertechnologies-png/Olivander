"""Job queue runner and enqueue helper.

Usage
-----
Enqueue a job anywhere in the backend:

    from jobs.queue import enqueue_job
    enqueue_job(
        job_type="follow_up_email",
        payload={"business_id": "...", ...},
        delay_seconds=172800,  # 48 hours
        business_id="...",
    )

The JobRunner is started as a background asyncio task when the FastAPI app
starts up and stopped on shutdown.
"""
import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any

from db.supabase import (
    claim_job,
    complete_job,
    enqueue_job as _db_enqueue_job,
    fail_job,
    get_due_jobs,
)
from jobs.handlers import HANDLERS

logger = logging.getLogger("olivander")

_POLL_INTERVAL_SECONDS = 30
_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="job-runner")


def enqueue_job(
    *,
    job_type: str,
    payload: dict[str, Any],
    delay_seconds: float = 0,
    run_at: str | None = None,
    business_id: str | None = None,
    max_attempts: int = 3,
) -> dict[str, Any] | None:
    """Convenience wrapper: compute run_at and insert the job.

    Provide either delay_seconds (offset from now) or an explicit run_at ISO string.
    """
    if run_at is None:
        run_at = (
            datetime.now(timezone.utc) + timedelta(seconds=delay_seconds)
        ).isoformat()

    return _db_enqueue_job(
        job_type=job_type,
        payload=payload,
        run_at=run_at,
        business_id=business_id,
        max_attempts=max_attempts,
    )


def _execute_job(job: dict[str, Any]) -> None:
    """Run a single job synchronously (called from thread pool)."""
    job_id = str(job.get("id", ""))
    job_type = str(job.get("job_type", ""))
    attempts = int(job.get("attempts") or 0) + 1
    max_attempts = int(job.get("max_attempts") or 3)

    handler = HANDLERS.get(job_type)
    if handler is None:
        logger.warning("No handler registered for job_type=%s (id=%s)", job_type, job_id)
        fail_job(job_id, f"Unknown job_type: {job_type}", attempts, max_attempts)
        return

    try:
        handler(job)
        complete_job(job_id)
        logger.info("Job completed: id=%s type=%s", job_id, job_type)
    except Exception as error:
        logger.error(
            "Job failed: id=%s type=%s attempt=%d/%d error=%s",
            job_id,
            job_type,
            attempts,
            max_attempts,
            error,
            exc_info=True,
        )
        fail_job(job_id, str(error)[:2000], attempts, max_attempts)


async def _poll_once(loop: asyncio.AbstractEventLoop) -> None:
    """Fetch due jobs and dispatch each to the thread pool."""
    try:
        jobs = await loop.run_in_executor(None, get_due_jobs)
    except Exception as error:
        logger.error("Job queue poll failed: %s", error, exc_info=True)
        return

    for job in jobs:
        job_id = str(job.get("id", ""))
        claimed = await loop.run_in_executor(None, claim_job, job_id)
        if not claimed:
            continue  # Another instance claimed it first
        loop.run_in_executor(_executor, _execute_job, job)


class JobRunner:
    """Background asyncio task that polls the job_queue on a fixed interval."""

    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        self._running = False

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        loop = asyncio.get_event_loop()
        self._task = asyncio.create_task(self._run(loop))
        logger.info("JobRunner started (poll interval=%ds)", _POLL_INTERVAL_SECONDS)

    async def stop(self) -> None:
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("JobRunner stopped")

    async def _run(self, loop: asyncio.AbstractEventLoop) -> None:
        while self._running:
            await _poll_once(loop)
            await asyncio.sleep(_POLL_INTERVAL_SECONDS)


# Singleton instance — imported and managed by main.py startup/shutdown hooks
job_runner = JobRunner()
