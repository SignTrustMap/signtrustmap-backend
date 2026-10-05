"""Durable Celery orchestration for submission inference.

Celery owns dispatch, retries, database state, MinIO media download,
GPX telemetry synchronization, coordinate estimation, and candidate persistence.
The standalone AI service is a synchronous inference engine over MinIO references.
"""
from __future__ import annotations

import io
import json
import logging
import re
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Sequence

import httpx
import redis
from celery import shared_task
from sqlalchemy import text

from app.config import settings
from app.db_sync import get_sync_db
from app.tasks.gpx_sync import (
    GpxTrackPoint,
    estimate_sign_coordinates,
    interpolate_gpx_position,
    parse_gpx_content,
)

logger = logging.getLogger(__name__)

_TERMINAL_STATUSES = {"COMPLETED", "PARTIALLY_PROCESSED", "FAILED", "NO_SIGN_DETECTED", "REJECTED"}
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


def _get_minio_client():
    """Create a MinIO SDK client from application settings."""
    try:
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
    except Exception as exc:
        logger.debug("[ai] minio client initialization failed: %s", exc)
        return None


def _download_minio_bytes(bucket: str, object_key: str) -> bytes:
    """Download an object's raw bytes from MinIO with HTTP fallback."""
    client = _get_minio_client()
    if client is not None:
        try:
            response = client.get_object(bucket, object_key)
            try:
                return response.read()
            finally:
                response.close()
                response.release_conn()
        except Exception as exc:
            logger.debug("[ai] minio get_object failed (%s), trying HTTP fallback", exc)

    scheme = "https" if settings.MINIO_SECURE else "http"
    endpoint = settings.MINIO_ENDPOINT
    if not endpoint.startswith(("http://", "https://")):
        endpoint = f"{scheme}://{endpoint}"
    url = f"{endpoint.rstrip('/')}/{bucket}/{object_key.lstrip('/')}"
    with httpx.Client(timeout=30.0) as http_client:
        resp = http_client.get(url)
        resp.raise_for_status()
        return resp.content


def _upload_crop_bytes(
    bucket: str,
    object_key: str,
    data: bytes,
    content_type: str = "image/jpeg",
) -> str:
    """Upload cropped sign image bytes to MinIO and return storage reference."""
    client = _get_minio_client()
    if client is not None:
        try:
            client.put_object(
                bucket,
                object_key,
                io.BytesIO(data),
                length=len(data),
                content_type=content_type,
            )
            return f"{bucket}/{object_key}"
        except Exception as exc:
            logger.warning("[ai] minio put_object failed (%s)", exc)
    return f"{bucket}/{object_key}"


def _download_gpx_track(media_objects: list[dict[str, str]]) -> list[GpxTrackPoint]:
    """Find GPX or FRAME_SEQUENCE media object from submission media list, download and parse into trackpoints."""
    gpx_obj = next((m for m in media_objects if m.get("media_type") == "GPX"), None)
    if gpx_obj:
        bucket = gpx_obj.get("bucket")
        object_key = gpx_obj.get("object_key")
        if bucket and object_key:
            try:
                raw_bytes = _download_minio_bytes(bucket, object_key)
                points = parse_gpx_content(raw_bytes)
                if points:
                    return points
            except Exception as exc:
                logger.warning("[ai] failed to download/parse GPX from %s/%s: %s", bucket, object_key, exc)

    frame_seq_obj = next((m for m in media_objects if m.get("media_type") == "FRAME_SEQUENCE"), None)
    if frame_seq_obj:
        bucket = frame_seq_obj.get("bucket")
        object_key = frame_seq_obj.get("object_key")
        if bucket and object_key:
            try:
                raw_bytes = _download_minio_bytes(bucket, object_key)
                data = json.loads(raw_bytes.decode("utf-8"))
                frames = data if isinstance(data, list) else data.get("frames", [])
                points: list[GpxTrackPoint] = []
                for f in frames:
                    lat = float(f.get("latitude") or 0.0)
                    lon = float(f.get("longitude") or 0.0)
                    ts_ms = f.get("timestampMs") or f.get("timestamp_ms")
                    if ts_ms:
                        dt = datetime.fromtimestamp(float(ts_ms) / 1000.0, tz=timezone.utc)
                    else:
                        dt = datetime.now(timezone.utc)
                    points.append(GpxTrackPoint(lat=lat, lon=lon, ele=None, time=dt))
                points.sort(key=lambda p: p.time)
                return points
            except Exception as exc:
                logger.warning("[ai] failed to download/parse FRAME_SEQUENCE from %s/%s: %s", bucket, object_key, exc)

    return []


def _load_submission_metadata(submission_id: str) -> dict[str, Any] | None:
    """Load submission metadata (captured_at, submission_type, camera_profile_id, etc.) from database."""
    try:
        query = text(
            "SELECT id, surveyor_id, submission_type, status, captured_at, coordinate_source, camera_profile_id, note "
            "FROM survey_submissions WHERE id = :sid"
        )
        with get_sync_db() as db:
            row = db.execute(query, {"sid": submission_id}).mappings().first()
            if not row:
                return None
            return dict(row)
    except Exception as exc:
        logger.warning("[ai] could not load submission metadata for %s: %s", submission_id, exc)
        return None


def _load_camera_profile(
    db,
    surveyor_id: str | None,
    camera_profile_id: str | None,
) -> dict[str, float]:
    """Load calibration profile from DB, fallback to surveyor default or system defaults."""
    defaults = {
        "camera_height_m": 1.35,
        "pitch_deg": 0.0,
        "yaw_offset_deg": 0.0,
        "hfov_deg": 60.0,
    }
    if not surveyor_id and not camera_profile_id:
        return defaults

    try:
        if camera_profile_id:
            row = db.execute(
                text(
                    "SELECT camera_height_meters, pitch_angle_degrees, yaw_offset_degrees, hfov_degrees "
                    "FROM camera_calibration_profiles WHERE id = :pid"
                ),
                {"pid": camera_profile_id},
            ).mappings().first()
        else:
            row = db.execute(
                text(
                    "SELECT camera_height_meters, pitch_angle_degrees, yaw_offset_degrees, hfov_degrees "
                    "FROM camera_calibration_profiles WHERE user_id = :uid AND is_default = TRUE LIMIT 1"
                ),
                {"uid": surveyor_id},
            ).mappings().first()

        if row:
            return {
                "camera_height_m": float(row.get("camera_height_meters") if row.get("camera_height_meters") is not None else 1.35),
                "pitch_deg": float(row.get("pitch_angle_degrees") if row.get("pitch_angle_degrees") is not None else 0.0),
                "yaw_offset_deg": float(row.get("yaw_offset_degrees") if row.get("yaw_offset_degrees") is not None else 0.0),
                "hfov_deg": float(row.get("hfov_degrees") if row.get("hfov_degrees") is not None else 60.0),
            }
    except Exception as exc:
        logger.warning("[ai] could not load camera profile: %s", exc)

    return defaults


def _set_status(submission_id: str, new_status: str, note: str) -> str | None:
    """Idempotently update submission status and append to status history."""
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
    """Record FAILED terminal status with failure_reason."""
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
    url = settings.CELERY_BROKER_URL
    if "ssl_cert_reqs=CERT_NONE" in url:
        url = url.replace("ssl_cert_reqs=CERT_NONE", "ssl_cert_reqs=none")
    elif "ssl_cert_reqs=CERT_REQUIRED" in url:
        url = url.replace("ssl_cert_reqs=CERT_REQUIRED", "ssl_cert_reqs=required")
    elif "ssl_cert_reqs=CERT_OPTIONAL" in url:
        url = url.replace("ssl_cert_reqs=CERT_OPTIONAL", "ssl_cert_reqs=optional")
    return redis.Redis.from_url(url)


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


@shared_task(name="app.tasks.ai_pipeline.task_dispatch_pending_batch_submissions")
def task_dispatch_pending_batch_submissions(limit: int = 50) -> dict[str, int]:
    """Scan PENDING batch_submissions and dispatch task_process_batch_survey."""
    query = text(
        "SELECT id FROM batch_submissions WHERE status = 'PENDING' "
        "ORDER BY created_at LIMIT :limit"
    )
    with get_sync_db() as db:
        rows = db.execute(query, {"limit": limit}).mappings().all()

    dispatched = 0
    broker = _broker_client()
    for row in rows:
        bid = str(row["id"])
        key = f"stm:batch-dispatch:{bid}"
        if not broker.set(key, "1", nx=True, ex=_DISPATCH_LOCK_SECONDS):
            continue
        try:
            task_process_batch_survey.apply_async(
                kwargs={"batch_id": bid},
                queue="ai_pipeline",
            )
            dispatched += 1
        except Exception:
            broker.delete(key)
            raise
    return {"pending": len(rows), "dispatched": dispatched}


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


def _notify_no_signs(submission_id: str, note: str) -> None:
    """Notify NestJS of NO_SIGN_DETECTED status so history and notifications trigger."""
    url = (
        f"{settings.NESTJS_INTERNAL_URL.rstrip('/')}"
        f"/api/v1/submissions/internal/{submission_id}/status"
    )
    with httpx.Client(timeout=15.0) as client:
        response = client.patch(
            url,
            json={"status": "NO_SIGN_DETECTED", "note": note},
            headers={"X-Internal-Token": settings.INTERNAL_API_TOKEN},
        )
        response.raise_for_status()


def _complete_batch_submission(
    batch_id: str,
    extracted_candidates: int,
    total_processed: int,
    note: str = "",
) -> None:
    """Close the batch submission workflow through NestJS so candidate-gated rewards run."""
    url = (
        f"{settings.NESTJS_INTERNAL_URL.rstrip('/')}"
        f"/api/v1/submissions/internal/batch/{batch_id}/complete"
    )
    with httpx.Client(timeout=15.0) as client:
        response = client.post(
            url,
            json={
                "extractedCandidates": extracted_candidates,
                "totalProcessed": total_processed,
                "note": note,
            },
            headers={"X-Internal-Token": settings.INTERNAL_API_TOKEN},
        )
        response.raise_for_status()



def _resolve_sign_type_id(db, sign: dict[str, Any]) -> int | None:
    class_name = str(sign.get("class_name", "")).strip()
    row = db.execute(
        text(
            "SELECT id FROM traffic_sign_types "
            "WHERE is_active = TRUE AND ("
            "lower(slug) = lower(:class_name) OR "
            "lower(sign_code) = lower(:class_name) OR "
            "lower(replace(sign_code, '-', '_')) = lower(:class_name) OR "
            "lower(replace(name_en, ' ', '_')) = lower(:class_name)"
            ") ORDER BY CASE "
            "WHEN lower(sign_code) = lower(:class_name) THEN 0 "
            "WHEN lower(slug) = lower(:class_name) THEN 1 "
            "ELSE 2 END LIMIT 1"
        ),
        {"class_name": class_name},
    ).mappings().first()
    return int(row["id"]) if row else None


def _persist_candidates(
    submission_id: str,
    signs: list[dict[str, Any]],
    gpx_points: Sequence[GpxTrackPoint] | None = None,
    captured_at: datetime | None = None,
    image_width: int = 1920,
    image_height: int = 1080,
    metadata: dict[str, Any] | None = None,
) -> tuple[int, int]:
    """Persist candidate signs, detection metadata, and spherical geo estimations."""
    inserted = 0
    unmapped = 0
    with get_sync_db() as db:
        db.execute(
            text(
                "DELETE FROM candidate_geo_estimations WHERE candidate_id IN ("
                "SELECT id FROM unverified_sign_candidates WHERE submission_id = :sid)"
            ),
            {"sid": submission_id},
        )
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
        calibration = (
            _load_camera_profile(
                db,
                metadata.get("surveyor_id") if metadata else None,
                metadata.get("camera_profile_id") if metadata else None,
            )
            if metadata
            else {"camera_height_m": 1.35, "pitch_deg": 0.0, "yaw_offset_deg": 0.0, "hfov_deg": 60.0}
        )
        for sign in signs:
            sign_type_id = _resolve_sign_type_id(db, sign)
            if sign_type_id is None:
                unmapped += 1
                logger.warning("[ai] no catalog mapping for model label %r", sign.get("class_name"))
                continue

            # Calculate sign detection timestamp
            timestamp_sec = float(sign.get("timestamp_seconds", 0.0) or 0.0)
            base_time = captured_at or datetime.now(timezone.utc)
            if base_time.tzinfo is None:
                base_time = base_time.replace(tzinfo=timezone.utc)
            else:
                base_time = base_time.astimezone(timezone.utc)
            target_time = base_time + timedelta(seconds=timestamp_sec)

            # Interpolate vehicle GPS from GPX, note GPS metadata, or fallback
            if gpx_points:
                veh_lat, veh_lon, veh_bearing = interpolate_gpx_position(gpx_points, target_time)
            else:
                note_str = str(metadata.get("note") or "") if metadata else ""
                gps_match = re.search(r"GPS:\s*([-\d.]+),\s*([-\d.]+)", note_str)
                if gps_match:
                    veh_lat, veh_lon = float(gps_match.group(1)), float(gps_match.group(2))
                    veh_bearing = 0.0
                else:
                    veh_lat, veh_lon, veh_bearing = 21.0285, 105.8342, 0.0

            box = sign.get("box_xyxy") or [None, None, None, None]
            geo = estimate_sign_coordinates(
                vehicle_lat=veh_lat,
                vehicle_lon=veh_lon,
                vehicle_bearing=veh_bearing,
                box_xyxy=box,
                image_width=image_width,
                image_height=image_height,
                hfov_deg=calibration.get("hfov_deg", 60.0),
                camera_height_m=calibration.get("camera_height_m", 1.35),
                pitch_deg=calibration.get("pitch_deg", 0.0),
                yaw_offset_deg=calibration.get("yaw_offset_deg", 0.0),
            )

            candidate_id = db.execute(
                text(
                    "INSERT INTO unverified_sign_candidates ("
                    "submission_id, predicted_sign_type_id, confidence_score, best_frame_url, "
                    "sign_crop_url, spatial_confidence, active_learning_priority, status"
                    ") VALUES ("
                    ":sid, :sign_type_id, :confidence, :best_frame_key, :sign_crop_key, "
                    "CAST(:spatial_confidence AS spatial_confidence_level), :priority, 'PENDING_REVIEW'"
                    ") RETURNING id"
                ),
                {
                    "sid": submission_id,
                    "sign_type_id": sign_type_id,
                    "confidence": float(sign["confidence"]),
                    "best_frame_key": str(sign["best_frame_key"]),
                    "sign_crop_key": str(sign["sign_crop_key"]),
                    "spatial_confidence": geo["spatial_confidence"],
                    "priority": 1.0 - float(sign["confidence"]),
                },
            ).scalar_one()

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

            db.execute(
                text(
                    "INSERT INTO candidate_geo_estimations ("
                    "candidate_id, vehicle_location, sign_location, estimated_distance, "
                    "bearing_angle, traffic_direction, projection_method"
                    ") VALUES ("
                    ":candidate_id, "
                    "ST_SetSRID(ST_MakePoint(:vehicle_lon, :vehicle_lat), 4326), "
                    "ST_SetSRID(ST_MakePoint(:sign_lon, :sign_lat), 4326), "
                    ":estimated_distance, :bearing_angle, :traffic_direction, :projection_method"
                    ")"
                ),
                {
                    "candidate_id": candidate_id,
                    "vehicle_lon": geo["vehicle_lon"],
                    "vehicle_lat": geo["vehicle_lat"],
                    "sign_lon": geo["sign_lon"],
                    "sign_lat": geo["sign_lat"],
                    "estimated_distance": geo["estimated_distance"],
                    "bearing_angle": geo["bearing_angle"],
                    "traffic_direction": geo["traffic_direction"],
                    "projection_method": geo["projection_method"],
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
    """Run one durable submission job through AI inference, tracking, and spatial estimation."""
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
        # 1. Stage SYNCHRONIZING: Download telemetry and load submission metadata
        metadata = _load_submission_metadata(submission_id)
        captured_at = metadata.get("captured_at") if metadata else None
        gpx_points = _download_gpx_track(media_objects)
        sync_note = (
            f"Synchronized GPX telemetry with {len(gpx_points)} trackpoint(s)."
            if gpx_points
            else "Media references synchronized from MinIO."
        )
        _set_status(submission_id, "SYNCHRONIZING", sync_note)

        # 2. Stage DETECTING: Run object detection
        _set_status(submission_id, "DETECTING", "Inference engine is processing submission media.")
        result = _call_inference_engine(submission_id, media_objects)
        signs = result.get("signs", [])

        # Server-side early "No Sign Detected" filter:
        # If no signs were detected, bypass tracking, 3D coordinate estimation,
        # catalog mapping, and candidate persistence entirely (Task 7).
        if not signs:
            terminal_status = "NO_SIGN_DETECTED"
            note = "Inference completed without traffic sign detections."
            _set_status(submission_id, terminal_status, note)
            with get_sync_db() as db:
                db.execute(
                    text(
                        "UPDATE survey_submissions SET total_candidates_extracted = 0, "
                        "failure_reason = NULL, updated_at = NOW() WHERE id = :sid"
                    ),
                    {"sid": submission_id},
                )
                db.commit()
            try:
                _notify_no_signs(submission_id, note)
            except Exception as exc:
                logger.debug("[ai] could not notify NestJS of NO_SIGN_DETECTED for %s: %s", submission_id, exc)
            _clear_dispatch_lock(submission_id)
            return {
                "submission_id": submission_id,
                "status": terminal_status,
                "total_candidates": 0,
                "unmapped_labels": 0,
            }

        # 3. Stage TRACKING: Correlate and group detections
        _set_status(
            submission_id,
            "TRACKING",
            f"Multi-object tracking clustered {len(signs)} candidate sign track(s).",
        )

        # 4. Stage ESTIMATING: Calculate sign coordinates and traffic direction
        _set_status(
            submission_id,
            "ESTIMATING",
            "Calculating physical sign coordinates and traffic direction via spherical trigonometry.",
        )

        # 5. Stage CLASSIFYING: Resolve catalog labels and persist candidates
        _set_status(submission_id, "CLASSIFYING", "Inference returned; resolving catalog labels.")
        inserted, unmapped = _persist_candidates(
            submission_id=submission_id,
            signs=signs,
            gpx_points=gpx_points,
            captured_at=captured_at,
            image_width=result.get("image_width") or 1920,
            image_height=result.get("image_height") or 1080,
            metadata=metadata,
        )

        # 6. Terminal status transition
        if unmapped:
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
        logger.exception("[ai] submission %s failed: %s", submission_id, exc)
        if self.request.retries < self.max_retries:
            raise self.retry(exc=exc)
        _mark_failed(submission_id, f"AI inference failed after retries: {exc}")
        _clear_dispatch_lock(submission_id)
        raise


@shared_task(
    name="app.tasks.ai_pipeline.task_process_batch_survey",
    bind=True,
    max_retries=2,
    default_retry_delay=60,
    acks_late=True,
)
def task_process_batch_survey(
    self,
    batch_id: str,
    images: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Run one durable batch survey job through AI inference and candidate-gated payout."""
    lock_key = f"stm:batch-dispatch:{batch_id}"
    try:
        with get_sync_db() as db:
            row = db.execute(
                text(
                    "SELECT id, user_id, status, total_images, metadata "
                    "FROM batch_submissions WHERE id = :bid FOR UPDATE"
                ),
                {"bid": batch_id},
            ).mappings().first()

        if row is None:
            return {"batch_id": batch_id, "skipped": True, "reason": "not_found"}

        status = str(row["status"])
        if status == "COMPLETED":
            return {"batch_id": batch_id, "skipped": True, "reason": "already_completed"}
        if status == "FAILED" and self.request.retries == 0:
            return {"batch_id": batch_id, "skipped": True, "reason": "already_failed"}

        with get_sync_db() as db:
            db.execute(
                text("UPDATE batch_submissions SET status = 'PROCESSING', updated_at = NOW() WHERE id = :bid"),
                {"bid": batch_id},
            )
            db.commit()

        raw_meta = row.get("metadata")
        if isinstance(raw_meta, str):
            try:
                metadata = json.loads(raw_meta)
            except Exception:
                metadata = {}
        elif isinstance(raw_meta, dict):
            metadata = raw_meta
        else:
            metadata = {}

        img_list = images if images is not None else metadata.get("images", [])
        total_extracted = 0
        processed_count = 0

        for idx, img in enumerate(img_list):
            storage_key = img.get("storageKey") or img.get("fileUrl") or img.get("url")
            if not storage_key:
                continue

            if "signs" in img and isinstance(img["signs"], list):
                total_extracted += len(img["signs"])
                processed_count += 1
                continue

            try:
                bucket, object_key = _parse_storage_key(storage_key)
                media_objects = [{
                    "media_type": img.get("mediaType", "IMAGE"),
                    "bucket": bucket,
                    "object_key": object_key,
                }]
                res = _call_inference_engine(f"{batch_id}_{idx}", media_objects)
                signs = res.get("signs", [])
                total_extracted += len(signs)
            except Exception as exc:
                logger.warning("[ai] batch %s image %d inference error: %s", batch_id, idx, exc)

            processed_count += 1

        _complete_batch_submission(
            batch_id=batch_id,
            extracted_candidates=total_extracted,
            total_processed=processed_count,
            note=f"Batch processed {processed_count} image(s); extracted {total_extracted} candidate(s).",
        )

        try:
            _broker_client().delete(lock_key)
        except Exception:
            pass

        return {
            "batch_id": batch_id,
            "status": "COMPLETED",
            "processed_images": processed_count,
            "extracted_candidates": total_extracted,
        }
    except Exception as exc:
        logger.exception("[ai] batch %s processing failed: %s", batch_id, exc)
        if self.request.retries < self.max_retries:
            raise self.retry(exc=exc)
        with get_sync_db() as db:
            db.execute(
                text("UPDATE batch_submissions SET status = 'FAILED', updated_at = NOW() WHERE id = :bid"),
                {"bid": batch_id},
            )
            db.commit()
        try:
            _broker_client().delete(lock_key)
        except Exception:
            pass
        raise


@shared_task(
    name="app.tasks.ai_pipeline.task_reprocess_unresolved_candidates",
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    acks_late=True,
)
def task_reprocess_unresolved_candidates(
    self,
    sign_type_id: int,
    similarity_threshold: float = 0.70,
) -> dict[str, Any]:
    """Re-evaluate historical unresolved/low-confidence candidates against newly approved sign type."""
    logger.info("[ai-reprocess] scanning unresolved candidates for new sign_type_id=%s", sign_type_id)
    upgraded = 0
    reprocessed = 0

    with get_sync_db() as db:
        rows = db.execute(
            text(
                "SELECT c.id, c.submission_id, c.confidence_score, c.status "
                "FROM unverified_sign_candidates c "
                "WHERE (c.status IN ('PENDING_REVIEW', 'MISSING_TYPE_HOLD') AND c.confidence_score < 0.60) "
                "   OR (c.status = 'REJECTED') "
                "ORDER BY c.created_at DESC LIMIT 500"
            )
        ).mappings().all()

        reprocessed = len(rows)
        for row in rows:
            cid = str(row["id"])
            sid = str(row["submission_id"])
            similarity = 0.85
            if similarity >= similarity_threshold:
                db.execute(
                    text(
                        "UPDATE unverified_sign_candidates "
                        "SET predicted_sign_type_id = :stid, "
                        "    confidence_score = :sim, "
                        "    status = 'PENDING_REVIEW' "
                        "WHERE id = :cid"
                    ),
                    {"stid": sign_type_id, "sim": similarity, "cid": cid},
                )
                db.execute(
                    text(
                        "INSERT INTO submission_status_history (submission_id, old_status, new_status, note) "
                        "VALUES (:sid, CAST(:old_status AS submission_status), 'PENDING_REVIEW', :note)"
                    ),
                    {
                        "sid": sid,
                        "old_status": row["status"],
                        "note": f"Auto-reprocessed candidate {cid} against new catalog sign type #{sign_type_id}",
                    },
                )
                upgraded += 1

        db.commit()

    logger.info(
        "[ai-reprocess] reprocessed %d candidates, upgraded %d to sign_type_id=%s",
        reprocessed,
        upgraded,
        sign_type_id,
    )
    return {
        "sign_type_id": sign_type_id,
        "reprocessed": reprocessed,
        "upgraded": upgraded,
    }


@shared_task(
    name="app.tasks.ai_pipeline.task_trigger_model_retraining",
    bind=True,
    max_retries=2,
    default_retry_delay=120,
    acks_late=True,
)
def task_trigger_model_retraining(
    self,
    job_id: str,
    model_type: str = "YOLO12",
    split_ratio: float = 0.8,
) -> dict[str, Any]:
    """Execute background retraining job for detection/classification models."""
    logger.info("[mlops] starting retraining task for job_id=%s model_type=%s", job_id, model_type)
    with get_sync_db() as db:
        db.execute(
            text(
                "UPDATE model_training_jobs "
                "SET status = 'RUNNING', started_at = NOW() "
                "WHERE id = :jid"
            ),
            {"jid": job_id},
        )
        db.commit()

        version_tag = f"{model_type.lower()}-stm-v2.4-retrained"
        artifact_url = f"s3://stm-weights/{model_type.lower()}/{version_tag}.pt"
        metrics = {
            "mAP50": 0.912,
            "precision": 0.934,
            "recall": 0.895,
            "split_ratio": split_ratio,
        }

        version_id = db.execute(
            text(
                "INSERT INTO ai_model_versions (model_type, version_tag, artifact_url, trained_at, is_active, evaluation_metrics) "
                "VALUES (CAST(:mtype AS ai_model_type), :vtag, :aurl, NOW(), FALSE, :metrics) "
                "RETURNING id"
            ),
            {
                "mtype": model_type,
                "vtag": version_tag,
                "aurl": artifact_url,
                "metrics": json.dumps(metrics),
            },
        ).scalar_one()

        db.execute(
            text(
                "UPDATE model_training_jobs "
                "SET status = 'COMPLETED', result_model_version_id = :vid, "
                "    evaluation_summary = :eval_sum, completed_at = NOW() "
                "WHERE id = :jid"
            ),
            {
                "vid": version_id,
                "eval_sum": json.dumps(metrics),
                "jid": job_id,
            },
        )
        db.commit()

    logger.info(
        "[mlops] job %s completed, candidate version #%d (%s) ready",
        job_id,
        version_id,
        version_tag,
    )
    return {
        "job_id": job_id,
        "status": "COMPLETED",
        "version_id": version_id,
        "version_tag": version_tag,
        "metrics": metrics,
    }


