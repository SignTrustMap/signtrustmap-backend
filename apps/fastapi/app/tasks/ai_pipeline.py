"""Durable Celery orchestration for submission inference.

Celery owns dispatch, retries, database state, and candidate persistence. The
standalone AI service is a synchronous inference engine over MinIO references.
"""
from __future__ import annotations

import logging
from collections import defaultdict
from typing import Any

import httpx
import redis
from celery import shared_task
from sqlalchemy import text

from app.config import settings
from app.db_sync import get_sync_db

logger = logging.getLogger(__name__)

_TERMINAL_STATUSES = {"COMPLETED", "PARTIALLY_PROCESSED", "FAILED", "NO_SIGN_DETECTED"}
_PROCESSING_STATUSES = {"SYNCHRONIZING", "DETECTING", "TRACKING", "ESTIMATING", "CLASSIFYING"}
_SELECT_SUBMISSION = text("SELECT id, status FROM survey_submissions WHERE id = :sid")
_SELECT_SUBMISSION_FOR_UPDATE = text(
    "SELECT id, status FROM survey_submissions WHERE id = :sid FOR UPDATE"
)
_UPDATE_STATUS = text(
    "UPDATE survey_submissions "
    "SET status = CAST(:new_status AS submission_status), updated_at = NOW() "
    "WHERE id = :sid"
)
_INSERT_HISTORY = text(
    "INSERT INTO submission_status_history (submission_id, old_status, new_status, note) "
    "VALUES (:sid, CAST(:old_status AS submission_status), "
    "CAST(:new_status AS submission_status), :note)"
)
_DISPATCH_LOCK_SECONDS = 60 * 60


def _set_status(submission_id: str, new_status: str, note: str) -> str | None:
    with get_sync_db() as db:
        row = db.execute(_SELECT_SUBMISSION, {"sid": submission_id}).mappings().first()
        if row is None:
            return None
        old_status = str(row["status"])
        if old_status == new_status:
            return old_status
        if old_status in _TERMINAL_STATUSES:
            return old_status
        db.execute(_UPDATE_STATUS, {"sid": submission_id, "new_status": new_status})
        db.execute(
            _INSERT_HISTORY,
            {
                "sid": submission_id,
                "old_status": old_status,
                "new_status": new_status,
                "note": note,
            },
        )
        db.commit()
        logger.info("[ai] submission %s: %s -> %s", submission_id, old_status, new_status)
        return old_status


def _claim_submission(submission_id: str) -> str | None:
    """Atomically move one queued submission into processing."""
    with get_sync_db() as db:
        row = db.execute(
            _SELECT_SUBMISSION_FOR_UPDATE,
            {"sid": submission_id},
        ).mappings().first()
        if row is None:
            return None
        old_status = str(row["status"])
        if old_status != "QUEUED":
            return old_status
        db.execute(
            _UPDATE_STATUS,
            {"sid": submission_id, "new_status": "SYNCHRONIZING"},
        )
        db.execute(
            _INSERT_HISTORY,
            {
                "sid": submission_id,
                "old_status": old_status,
                "new_status": "SYNCHRONIZING",
                "note": "AI worker accepted MinIO media references.",
            },
        )
        db.commit()
        return old_status


def _mark_failed(submission_id: str, reason: str) -> None:
    reason = reason[:2000]
    try:
        old_status = _set_status(submission_id, "FAILED", reason)
        if old_status is not None:
            with get_sync_db() as db:
                db.execute(
                    text(
                        "UPDATE survey_submissions SET failure_reason = :reason, updated_at = NOW() "
                        "WHERE id = :sid"
                    ),
                    {"sid": submission_id, "reason": reason},
                )
                db.commit()
    except Exception:
        logger.exception("[ai] could not mark submission %s as FAILED", submission_id)


def _parse_storage_key(storage_key: str) -> tuple[str, str]:
    bucket, separator, object_key = storage_key.partition("/")
    if not separator or not bucket or not object_key:
        raise ValueError(f"Invalid MinIO storage key: {storage_key!r}")
    return bucket, object_key


def _load_queued_media(limit: int) -> dict[str, list[dict[str, str]]]:
    query = text(
        "WITH queued AS ("
        "SELECT id, created_at FROM survey_submissions WHERE status = 'QUEUED' "
        "ORDER BY created_at LIMIT :limit"
        ") "
        "SELECT submission.id AS submission_id, media.media_type, media.file_url "
        "FROM queued submission "
        "JOIN submission_media_files media ON media.submission_id = submission.id "
        "ORDER BY submission.created_at, media.uploaded_at "
    )
    grouped: dict[str, list[dict[str, str]]] = defaultdict(list)
    with get_sync_db() as db:
        rows = db.execute(query, {"limit": limit}).mappings().all()
    for row in rows:
        bucket, object_key = _parse_storage_key(str(row["file_url"]))
        grouped[str(row["submission_id"])].append(
            {
                "media_type": str(row["media_type"]),
                "bucket": bucket,
                "object_key": object_key,
            }
        )
    return grouped


def _broker_client() -> redis.Redis:
    return redis.Redis.from_url(settings.CELERY_BROKER_URL)


def _lock_key(submission_id: str) -> str:
    return f"stm:ai-dispatch:{submission_id}"


def _clear_dispatch_lock(submission_id: str) -> None:
    try:
        _broker_client().delete(_lock_key(submission_id))
    except Exception:
        logger.warning("[ai] could not clear dispatch lock for %s", submission_id)


@shared_task(name="app.tasks.ai_pipeline.task_dispatch_queued_submissions")
def task_dispatch_queued_submissions(limit: int = 100) -> dict[str, int]:
    """Publish undispatched QUEUED rows using MinIO keys already stored by NestJS."""
    media_by_submission = _load_queued_media(limit)
    broker = _broker_client()
    dispatched = 0
    for submission_id, media_objects in media_by_submission.items():
        key = _lock_key(submission_id)
        if not broker.set(key, "1", nx=True, ex=_DISPATCH_LOCK_SECONDS):
            continue
        try:
            task_process_submission_pipeline.apply_async(
                kwargs={
                    "submission_id": submission_id,
                    "media_objects": media_objects,
                },
                queue="ai_pipeline",
            )
            dispatched += 1
        except Exception:
            broker.delete(key)
            raise
    return {"queued": len(media_by_submission), "dispatched": dispatched}


def _call_inference_engine(submission_id: str, media_objects: list[dict[str, str]]) -> dict:
    url = f"{settings.AI_INFERENCE_URL.rstrip('/')}/api/v1/inference/submissions/{submission_id}"
    timeout = httpx.Timeout(settings.AI_INFERENCE_TIMEOUT_SECONDS, connect=10.0)
    with httpx.Client(timeout=timeout) as client:
        response = client.post(
            url,
            json={"media_objects": media_objects},
            headers={"X-Internal-Token": settings.INTERNAL_API_TOKEN},
        )
        response.raise_for_status()
        payload = response.json()
    if payload.get("submission_id") != submission_id or not isinstance(payload.get("signs"), list):
        raise ValueError("AI inference service returned an invalid submission response")
    return payload


def _complete_submission(submission_id: str, note: str) -> None:
    """Close the business workflow through NestJS so rewards and notifications run."""
    url = (
        f"{settings.NESTJS_INTERNAL_URL.rstrip('/')}"
        f"/api/v1/submissions/internal/{submission_id}/complete"
    )
    with httpx.Client(timeout=15.0) as client:
        response = client.post(
            url,
            json={"note": note},
            headers={"X-Internal-Token": settings.INTERNAL_API_TOKEN},
        )
        response.raise_for_status()


def _resolve_sign_type_id(db, sign: dict[str, Any]) -> int | None:
    class_name = str(sign.get("class_name", "")).strip()
    row = db.execute(
        text(
            "SELECT id FROM traffic_sign_types "
            "WHERE is_active = TRUE AND ("
            "lower(sign_code) = lower(:class_name) OR "
            "lower(replace(sign_code, '-', '_')) = lower(:class_name) OR "
            "lower(replace(name_en, ' ', '_')) = lower(:class_name)"
            ") ORDER BY CASE WHEN lower(sign_code) = lower(:class_name) THEN 0 ELSE 1 END LIMIT 1"
        ),
        {"class_name": class_name},
    ).mappings().first()
    return int(row["id"]) if row else None


def _persist_candidates(submission_id: str, signs: list[dict[str, Any]]) -> tuple[int, int]:
    inserted = 0
    unmapped = 0
    with get_sync_db() as db:
        db.execute(
            text(
                "DELETE FROM candidate_detection_metadata WHERE candidate_id IN ("
                "SELECT id FROM unverified_sign_candidates WHERE submission_id = :sid)"
            ),
            {"sid": submission_id},
        )
        db.execute(
            text("DELETE FROM unverified_sign_candidates WHERE submission_id = :sid"),
            {"sid": submission_id},
        )
        for sign in signs:
            sign_type_id = _resolve_sign_type_id(db, sign)
            if sign_type_id is None:
                unmapped += 1
                logger.warning("[ai] no catalog mapping for model label %r", sign.get("class_name"))
                continue
            candidate_id = db.execute(
                text(
                    "INSERT INTO unverified_sign_candidates ("
                    "submission_id, predicted_sign_type_id, confidence_score, best_frame_url, "
                    "sign_crop_url, spatial_confidence, active_learning_priority, status"
                    ") VALUES ("
                    ":sid, :sign_type_id, :confidence, :best_frame_key, :sign_crop_key, "
                    "'LOW', :priority, 'PENDING_REVIEW'"
                    ") RETURNING id"
                ),
                {
                    "sid": submission_id,
                    "sign_type_id": sign_type_id,
                    "confidence": float(sign["confidence"]),
                    "best_frame_key": str(sign["best_frame_key"]),
                    "sign_crop_key": str(sign["sign_crop_key"]),
                    "priority": 1.0 - float(sign["confidence"]),
                },
            ).scalar_one()
            box = sign.get("box_xyxy") or [None, None, None, None]
            width = box[2] - box[0] if all(value is not None for value in box) else None
            height = box[3] - box[1] if all(value is not None for value in box) else None
            db.execute(
                text(
                    "INSERT INTO candidate_detection_metadata ("
                    "candidate_id, frame_number, bbox_x, bbox_y, bbox_width, bbox_height, tracking_id"
                    ") VALUES (:candidate_id, :frame_number, :x, :y, :width, :height, :tracking_id)"
                ),
                {
                    "candidate_id": candidate_id,
                    "frame_number": sign.get("frame_index"),
                    "x": box[0],
                    "y": box[1],
                    "width": width,
                    "height": height,
                    "tracking_id": str(sign["track_id"]) if sign.get("track_id") is not None else None,
                },
            )
            inserted += 1
        db.execute(
            text(
                "UPDATE survey_submissions SET total_candidates_extracted = :count, "
                "failure_reason = NULL, updated_at = NOW() WHERE id = :sid"
            ),
            {"sid": submission_id, "count": inserted},
        )
        db.commit()
    return inserted, unmapped


@shared_task(
    name="app.tasks.ai_pipeline.task_process_submission_pipeline",
    bind=True,
    max_retries=2,
    default_retry_delay=60,
    acks_late=True,
)
def task_process_submission_pipeline(
    self,
    submission_id: str,
    media_objects: list[dict[str, str]],
) -> dict[str, Any]:
    """Run one durable submission job using existing MinIO objects."""
    if self.request.retries == 0:
        claimed_status = _claim_submission(submission_id)
        if claimed_status is None:
            return {"submission_id": submission_id, "skipped": True, "reason": "not_found"}
        if claimed_status != "QUEUED":
            if claimed_status in _TERMINAL_STATUSES:
                _clear_dispatch_lock(submission_id)
            return {"submission_id": submission_id, "skipped": True, "reason": claimed_status}
    else:
        with get_sync_db() as db:
            row = db.execute(_SELECT_SUBMISSION, {"sid": submission_id}).mappings().first()
        if row is None:
            return {"submission_id": submission_id, "skipped": True, "reason": "not_found"}
        status = str(row["status"])
        if status in _TERMINAL_STATUSES:
            _clear_dispatch_lock(submission_id)
            return {"submission_id": submission_id, "skipped": True, "reason": status}
        if status not in _PROCESSING_STATUSES:
            return {"submission_id": submission_id, "skipped": True, "reason": status}

    try:
        _set_status(submission_id, "DETECTING", "Inference engine is processing submission media.")
        result = _call_inference_engine(submission_id, media_objects)
        _set_status(submission_id, "CLASSIFYING", "Inference returned; resolving catalog labels.")
        inserted, unmapped = _persist_candidates(submission_id, result["signs"])

        if not result["signs"]:
            terminal_status = "NO_SIGN_DETECTED"
            note = "Inference completed without traffic sign detections."
        elif unmapped:
            terminal_status = "PARTIALLY_PROCESSED"
            note = f"Stored {inserted} candidate(s); {unmapped} model label(s) were not in the catalog."
        else:
            terminal_status = "COMPLETED"
            note = f"Stored {inserted} candidate(s) for community review."
        if terminal_status == "COMPLETED":
            _complete_submission(submission_id, note)
        else:
            _set_status(submission_id, terminal_status, note)
        _clear_dispatch_lock(submission_id)
        return {
            "submission_id": submission_id,
            "status": terminal_status,
            "total_candidates": inserted,
            "unmapped_labels": unmapped,
        }
    except Exception as exc:
        logger.exception("[ai] submission %s failed", submission_id)
        if self.request.retries < self.max_retries:
            raise self.retry(exc=exc)
        _mark_failed(submission_id, f"AI inference failed after retries: {exc}")
        _clear_dispatch_lock(submission_id)
        raise
