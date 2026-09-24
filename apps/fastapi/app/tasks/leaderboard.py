"""
app.tasks.leaderboard — Periodic refresh of mv_community_leaderboard.

Uses REFRESH MATERIALIZED VIEW CONCURRENTLY so reads on the view are never
blocked while the refresh computes new scores.  Postgres requires the
statement to run outside any transaction block, so the task opens a raw
connection in AUTOCOMMIT mode.

Schedule: every 15 minutes via Celery Beat (see app.celery_app).
The unique index on user_id (schema.addendum.sql) is required for
CONCURRENTLY to succeed.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from celery import shared_task
from sqlalchemy import text

from app.db_sync import sync_engine

logger = logging.getLogger(__name__)

_REFRESH_SQL = text("REFRESH MATERIALIZED VIEW CONCURRENTLY mv_community_leaderboard")


@shared_task(
    name="app.tasks.leaderboard.task_refresh_community_leaderboard",
    bind=True,
    max_retries=2,
    default_retry_delay=60,
    acks_late=True,
)
def task_refresh_community_leaderboard(self):  # type: ignore[no-untyped-def]
    """Refresh mv_community_leaderboard concurrently (non-blocking for readers)."""
    started_at = datetime.now(timezone.utc)
    logger.info("[leaderboard] Starting concurrent refresh at %s", started_at.isoformat())
    try:
        with sync_engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
            conn.execute(_REFRESH_SQL)
    except Exception as exc:
        logger.exception("[leaderboard] Refresh failed: %s", exc)
        raise self.retry(exc=exc)
    elapsed_ms = (datetime.now(timezone.utc) - started_at).total_seconds() * 1000
    result = {"refreshed_at": started_at.isoformat(), "elapsed_ms": round(elapsed_ms, 1)}
    logger.info("[leaderboard] Refresh complete in %.1f ms", elapsed_ms)
    return result
