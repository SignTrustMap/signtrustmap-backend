"""
app.tasks.catalog_sync — Scenario #4: CLIP label cache sync (Celery task).

When staff/admin approve a missing-type report and NestJS creates a new
`traffic_sign_types` row, NestJS POSTs to `/api/v1/catalog/sync` which
dispatches this task.  The task rebuilds the CLIP label→sign_type_id map
(used by the AI classification label resolver) and caches it in Redis so
newly approved sign types are immediately classifiable.

Cache key: ``stm:clip:labels`` (JSON), refreshed atomically.
"""
from __future__ import annotations

import json
import logging

from celery import shared_task
from sqlalchemy import text

from app.config import settings
from app.db_sync import get_sync_db

logger = logging.getLogger(__name__)

_LABELS_SQL = text(
    """
    SELECT
        tst.id            AS sign_type_id,
        tst.sign_code     AS sign_code,
        tst.slug          AS slug,
        tst.name_vi       AS name_vi,
        tst.name_en       AS name_en,
        tst.shape         AS shape,
        tst.color_scheme  AS color_scheme,
        ap.prompt_text    AS prompt
    FROM traffic_sign_types tst
    LEFT JOIN sign_type_ai_prompts ap
           ON ap.sign_type_id = tst.id
          AND ap.is_active = TRUE
          AND ap.target_model = 'CLIP'
    WHERE tst.is_active = TRUE
    ORDER BY tst.id
    """
)

_VERSION_SQL = text(
    "SELECT COALESCE(MAX(version_number), 0) AS version_number FROM catalog_versions"
)


def _redis_client():
    try:
        import redis
        return redis.Redis.from_url(settings.REDIS_URL)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("[catalog-sync] redis unavailable: %s", exc)
        return None


def load_catalog_labels() -> dict:
    """Query traffic_sign_types + active CLIP prompts and structure the payload."""
    with get_sync_db() as db:
        version_row = db.execute(_VERSION_SQL).mappings().first()
        rows = db.execute(_LABELS_SQL).mappings().all()
    version_number = int(version_row["version_number"]) if version_row else 0
    labels = [
        {
            "sign_type_id": int(row["sign_type_id"]),
            "sign_code": str(row["sign_code"]),
            "slug": row["slug"],
            "name_vi": row["name_vi"],
            "name_en": row["name_en"],
            "shape": row["shape"],
            "color_scheme": row["color_scheme"],
            "prompt": row["prompt"],
        }
        for row in rows
    ]
    return {"version": version_number, "label_count": len(labels), "labels": labels}


@shared_task(
    name="app.tasks.catalog_sync.task_sync_catalog_labels",
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    acks_late=True,
)
def task_sync_catalog_labels(self):
    """Rebuild and cache the CLIP label map after a catalog mutation."""
    try:
        payload = load_catalog_labels()
    except Exception as exc:
        logger.exception("[catalog-sync] DB query failed: %s", exc)
        if self.request.retries < self.max_retries:
            raise self.retry(exc=exc)
        raise

    client = _redis_client()
    if client is not None:
        try:
            client.set("stm:clip:labels", json.dumps(payload))
            client.expire("stm:clip:labels", 7 * 24 * 3600)
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("[catalog-sync] could not cache labels in redis: %s", exc)

    logger.info("[catalog-sync] synced %d labels (catalog v%d)", payload["label_count"], payload["version"])
    return {"synced": True, "label_count": payload["label_count"], "version": payload["version"]}