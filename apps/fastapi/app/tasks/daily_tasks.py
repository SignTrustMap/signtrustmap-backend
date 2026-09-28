"""
app.tasks.daily_tasks — Midnight UTC rollover for daily tasks.

Triggers the NestJS internal rollover endpoint at midnight UTC:
POST /api/v1/daily-tasks/internal/rollover

This resets unclaimed progress and logs daily rollover metrics.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import httpx
from celery import shared_task

from app.config import settings

logger = logging.getLogger(__name__)


@shared_task(
    name="app.tasks.daily_tasks.task_daily_task_midnight_rollover",
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    acks_late=True,
)
def task_daily_task_midnight_rollover(self) -> dict[str, Any]:  # type: ignore[no-untyped-def]
    """Trigger midnight UTC rollover on NestJS daily tasks engine."""
    started_at = datetime.now(timezone.utc)
    logger.info("[daily_tasks] Starting midnight UTC rollover at %s", started_at.isoformat())
    url = f"{settings.NESTJS_INTERNAL_URL.rstrip('/')}/api/v1/daily-tasks/internal/rollover"
    try:
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(
                url,
                headers={"X-Internal-Token": settings.INTERNAL_API_TOKEN},
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.exception("[daily_tasks] Rollover failed: %s", exc)
        raise self.retry(exc=exc)

    logger.info("[daily_tasks] Midnight rollover successful: %s", data)
    return data
