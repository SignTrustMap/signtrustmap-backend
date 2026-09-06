"""
app.tasks.freshness — Flow 8: Freshness Monitor (Celery periodic task).

Scans verified_traffic_signs joined with freshness_rules to find stale
signs. For each stale sign without an OPEN/EVALUATING revalidation task:

  1. Insert revalidation_tasks row.
  2. Update sign status='STALE' + recalculate freshness_score.
  3. Record sign_lifecycle_events audit row.

Beat schedule: every 30 minutes (see app.celery_app).

freshness_score = max(0, 1 - days_since_verified / (period * 2))
reward          = min(50, 10 + int(max(0, days_overdue - period) * 2))
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from celery import shared_task
from sqlalchemy import text

from app.db_sync import get_sync_db

logger = logging.getLogger(__name__)

_STALE_SIGNS_SQL = text(
    """
    SELECT
        vts.id                                   AS sign_id,
        vts.last_verified_at,
        fr.id                                    AS rule_id,
        fr.freshness_period_days,
        fr.default_priority,
        EXTRACT(EPOCH FROM (NOW() - vts.last_verified_at)) / 86400.0
                                                 AS days_since_verified
    FROM verified_traffic_signs vts
    JOIN traffic_sign_types     tst ON tst.id = vts.sign_type_id
    JOIN freshness_rules        fr  ON fr.sign_category_id = tst.category_id
                                   AND fr.is_active = TRUE
    WHERE
        vts.status IN ('ACTIVE', 'STALE')
        AND vts.last_verified_at < NOW() - (fr.freshness_period_days * INTERVAL '1 day')
        AND NOT EXISTS (
            SELECT 1
            FROM revalidation_tasks rt
            WHERE rt.verified_sign_id = vts.id
              AND rt.status IN ('OPEN', 'EVALUATING')
        )
    ORDER BY days_since_verified DESC
    """
)

_INSERT_TASK_SQL = text(
    """
    INSERT INTO revalidation_tasks
        (verified_sign_id, freshness_rule_id, priority, reward_credits, status)
    VALUES
        (:sign_id, :rule_id, :priority::task_priority, :reward_credits, 'OPEN')
    RETURNING id
    """
)

_UPDATE_SIGN_STALE_SQL = text(
    """
    UPDATE verified_traffic_signs
    SET status = 'STALE'::sign_lifecycle_status,
        freshness_score = :freshness_score,
        updated_at = NOW()
    WHERE id = :sign_id
    """
)

_INSERT_LIFECYCLE_EVENT_SQL = text(
    """
    INSERT INTO sign_lifecycle_events (verified_sign_id, event_type, note)
    VALUES (:sign_id, 'MARKED_STALE', :note)
    """
)


@shared_task(
    name="app.tasks.freshness.task_check_freshness_and_spawn_revalidations",
    bind=True,
    max_retries=3,
    default_retry_delay=120,
    acks_late=True,
)
def task_check_freshness_and_spawn_revalidations(self):  # type: ignore[no-untyped-def]
    """
    Flow 8 — identifies stale signs and creates revalidation tasks.

    Idempotent: existing OPEN/EVALUATING tasks are excluded, so a re-run
    never creates duplicates.

    Returns dict with ``run_at``, ``spawned``, ``errors``.
    """
    run_at = datetime.now(timezone.utc)
    logger.info("[freshness] Starting check run at %s", run_at.isoformat())
    spawned = 0
    errors = 0
    try:
        with get_sync_db() as db:
            rows = db.execute(_STALE_SIGNS_SQL).mappings().all()
            logger.info("[freshness] Found %d stale signs", len(rows))
            for row in rows:
                sign_id = str(row["sign_id"])
                days_overdue = float(row["days_since_verified"])
                period = int(row["freshness_period_days"])
                rule_id = row["rule_id"]
                priority = row["default_priority"]
                freshness_score = max(0.0, round(1.0 - (days_overdue / (period * 2.0)), 4))
                reward = min(50, 10 + int(max(0.0, days_overdue - period) * 2))
                try:
                    task_row = db.execute(
                        _INSERT_TASK_SQL,
                        {"sign_id": sign_id, "rule_id": rule_id,
                         "priority": priority, "reward_credits": reward},
                    ).mappings().first()
                    db.execute(_UPDATE_SIGN_STALE_SQL,
                               {"sign_id": sign_id, "freshness_score": freshness_score})
                    db.execute(_INSERT_LIFECYCLE_EVENT_SQL, {
                        "sign_id": sign_id,
                        "note": (
                            f"Auto-marked STALE; days_overdue={days_overdue:.1f}, "
                            f"period={period}d, score={freshness_score:.4f}, "
                            f"task={task_row['id'] if task_row else 'unknown'}."
                        ),
                    })
                    db.commit()
                    spawned += 1
                    logger.debug("[freshness] Spawned task for sign %s (%.1f days overdue)",
                                 sign_id, days_overdue)
                except Exception as exc:
                    db.rollback()
                    errors += 1
                    logger.exception("[freshness] Failed to process sign %s: %s", sign_id, exc)
    except Exception as exc:
        logger.exception("[freshness] DB connection error: %s", exc)
        raise self.retry(exc=exc)
    summary = {"run_at": run_at.isoformat(), "spawned": spawned, "errors": errors}
    logger.info("[freshness] Run complete: %s", summary)
    return summary
