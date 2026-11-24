"""
app.tasks.media_retention — Scheduled raw-media retention & expired upload session cleanup (Issue #7).

Deletes raw uploaded videos, GPX logs, and frame sequences from MinIO once their parent
submission has reached a terminal state and exceeded ``survey.raw_media_retention_days``
(default: 30 days). Cropped sign evidence in ``stm-sign-crops`` is NEVER deleted.

Also transitions stale ``upload_sessions`` past ``expires_at`` to ``EXPIRED``.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from celery import shared_task
from sqlalchemy import text

from app.config import settings
from app.db_sync import get_sync_db
from app.models.pipeline import SystemParameter
from sqlalchemy import select

logger = logging.getLogger(__name__)

_RAW_BUCKETS = ("stm-raw-videos", "stm-gpx-logs")
_TERMINAL_SUBMISSION_STATUSES = ("COMPLETED", "NO_SIGN_DETECTED", "REJECTED", "FAILED")

_SELECT_RETENTION_PARAM_STMT = (
    select(SystemParameter.value)
    .where(SystemParameter.key == "survey.raw_media_retention_days")
    .limit(1)
)

_SELECT_EXPIRED_RAW_MEDIA_SQL = text(
    """
    SELECT smf.id, smf.submission_id, smf.media_type, smf.storage_bucket, smf.storage_key
    FROM submission_media_files smf
    JOIN survey_submissions ss ON ss.id = smf.submission_id
    WHERE smf.media_type IN ('VIDEO', 'GPX', 'FRAME_SEQUENCE')
      AND smf.storage_bucket IN ('stm-raw-videos', 'stm-gpx-logs')
      AND ss.status IN ('COMPLETED', 'NO_SIGN_DETECTED', 'REJECTED', 'FAILED')
      AND ss.updated_at < NOW() - MAKE_INTERVAL(days => :retention_days)
      AND smf.storage_key IS NOT NULL
      AND smf.storage_key NOT LIKE 'PURGED/%'
    ORDER BY ss.updated_at ASC
    LIMIT :batch_limit
    """
)

_MARK_MEDIA_PURGED_SQL = text(
    """
    UPDATE submission_media_files
    SET storage_key = 'PURGED/' || storage_key
    WHERE id = :media_id
    """
)

_EXPIRE_UPLOAD_SESSIONS_SQL = text(
    """
    UPDATE upload_sessions
    SET status = 'EXPIRED', updated_at = NOW()
    WHERE status IN ('INITIATED', 'UPLOADING')
      AND expires_at < NOW()
    """
)


def _get_minio_client():
    from minio import Minio

    endpoint = settings.MINIO_ENDPOINT.replace("http://", "").replace("https://", "")
    region = settings.MINIO_REGION or ("auto" if "r2.cloudflarestorage.com" in endpoint else None)
    return Minio(
        endpoint,
        access_key=settings.MINIO_ACCESS_KEY,
        secret_key=settings.MINIO_SECRET_KEY,
        secure=settings.MINIO_SECURE,
        region=region,
    )


def _resolve_retention_days(db) -> int:
    try:
        row = db.execute(_SELECT_RETENTION_PARAM_STMT).first()
        if row and row[0] is not None:
            parsed = int(row[0])
            if parsed >= 1:
                return parsed
    except Exception as exc:
        logger.debug("[media-retention] fallback to settings.RAW_MEDIA_RETENTION_DAYS: %s", exc)
    return max(1, int(settings.RAW_MEDIA_RETENTION_DAYS))


@shared_task(
    name="app.tasks.media_retention.task_cleanup_expired_raw_media",
    bind=True,
    max_retries=3,
    default_retry_delay=300,
    acks_late=True,
)
def task_cleanup_expired_raw_media(self, batch_limit: int = 200) -> dict[str, Any]:  # type: ignore[no-untyped-def]
    """Purge raw videos/GPX logs past retention window and expire abandoned upload sessions."""
    run_at = datetime.now(timezone.utc)
    deleted_objects = 0
    already_missing = 0
    failed_objects = 0
    expired_sessions = 0
    retention_days = int(settings.RAW_MEDIA_RETENTION_DAYS)

    try:
        with get_sync_db() as db:
            retention_days = _resolve_retention_days(db)
            rows = db.execute(
                _SELECT_EXPIRED_RAW_MEDIA_SQL,
                {"retention_days": retention_days, "batch_limit": max(1, min(batch_limit, 1000))},
            ).mappings().all()

            minio_client = _get_minio_client() if rows else None

            for row in rows:
                bucket = str(row["storage_bucket"])
                key = str(row["storage_key"])
                media_id = str(row["id"])

                # Guardrail: never touch stm-sign-crops
                if bucket not in _RAW_BUCKETS:
                    continue

                try:
                    if minio_client is not None:
                        minio_client.remove_object(bucket, key)
                    deleted_objects += 1
                    db.execute(_MARK_MEDIA_PURGED_SQL, {"media_id": media_id})
                except Exception as exc:
                    err_str = str(exc)
                    if "NoSuchKey" in err_str or "NoSuchBucket" in err_str:
                        already_missing += 1
                        db.execute(_MARK_MEDIA_PURGED_SQL, {"media_id": media_id})
                    else:
                        failed_objects += 1
                        logger.warning(
                            "[media-retention] Failed deleting %s/%s (media_id=%s): %s",
                            bucket,
                            key,
                            media_id,
                            exc,
                        )

            try:
                res = db.execute(_EXPIRE_UPLOAD_SESSIONS_SQL)
                expired_sessions = int(res.rowcount or 0)
            except Exception as exc:
                logger.warning("[media-retention] Failed expiring stale upload_sessions: %s", exc)

            db.commit()
    except Exception as exc:
        logger.exception("[media-retention] Fatal error during raw media retention cleanup: %s", exc)
        raise self.retry(exc=exc)

    summary = {
        "run_at": run_at.isoformat(),
        "retention_days": retention_days,
        "deleted_objects": deleted_objects,
        "already_missing": already_missing,
        "failed_objects": failed_objects,
        "expired_upload_sessions": expired_sessions,
    }
    logger.info("[media-retention] Cleanup completed: %s", summary)
    return summary
