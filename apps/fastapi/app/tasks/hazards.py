"""
app.tasks.hazards — Flow 8 & Phase 6: Roadside Hazard Decay & Micro-TTL Sweeper.

Sweeps road_hazard_events where:
  • expires_at <= NOW() (micro-TTL expired without sufficient active confirmations)
  • dismissals_count > confirmations_count (negative peer consensus)

Transitions matched active events to 'DISMISSED' status.
Runs periodically every 5 minutes on queue 'default'.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from celery import shared_task
from sqlalchemy import text

from app.db_sync import get_sync_db

logger = logging.getLogger(__name__)

_SWEEP_EXPIRED_HAZARDS_SQL = text(
    """
    UPDATE road_hazard_events
    SET status = 'DISMISSED',
        updated_at = NOW()
    WHERE status IN ('UNCONFIRMED', 'CONFIRMED')
      AND (expires_at <= NOW() OR dismissals_count > confirmations_count)
    RETURNING id, hazard_type, status
    """
)


@shared_task(
    name="app.tasks.hazards.task_decay_hazard_events",
    bind=True,
    max_retries=3,
    default_retry_delay=30,
    acks_late=True,
)
def task_decay_hazard_events(self) -> dict[str, Any]:  # type: ignore[no-untyped-def]
    """Sweep expired or dismissed road hazard events."""
    started_at = datetime.now(timezone.utc)
    logger.info("[hazards] Starting hazard decay sweep at %s", started_at.isoformat())

    try:
        with get_sync_db() as db:
            result = db.execute(_SWEEP_EXPIRED_HAZARDS_SQL)
            swept_rows = result.mappings().all()
            db.commit()
    except Exception as exc:
        logger.exception("[hazards] Failed sweeping expired hazards: %s", exc)
        raise self.retry(exc=exc)

    swept_count = len(swept_rows)
    logger.info(
        "[hazards] Swept %d expired or dismissed hazard events in %s",
        swept_count,
        datetime.now(timezone.utc) - started_at,
    )

    return {
        "swept": swept_count,
        "swept_ids": [str(r["id"]) for r in swept_rows],
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }
