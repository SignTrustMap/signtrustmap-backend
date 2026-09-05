"""
app.tasks.ai_pipeline — AI pipeline STUBS (Phase 4) — part 1.
Orchestration only: each task advances survey_submissions.status,
appends submission_status_history, and chains the next stage.
Real YOLO12/BoT-SORT/CLIP inference is a TODO block for the teammate.
Pipeline: QUEUED -> SYNCHRONIZING -> DETECTING -> TRACKING ->
          ESTIMATING -> CLASSIFYING -> COMPLETED / NO_SIGN_DETECTED
Queue: ai_pipeline (see app.celery_app).
"""
from __future__ import annotations
import logging
from celery import shared_task
from sqlalchemy import text
from app.db_sync import get_sync_db
logger = logging.getLogger(__name__)
_SELECT_SUBMISSION = text("SELECT id, status FROM survey_submissions WHERE id = :sid")
_UPDATE_STATUS = text(
    "UPDATE survey_submissions SET status = :new_status::submission_status, updated_at = NOW() "
    "WHERE id = :sid RETURNING status"
)
_INSERT_HISTORY = text(
    "INSERT INTO submission_status_history (submission_id, old_status, new_status, note) "
    "VALUES (:sid, :old_status::submission_status, :new_status::submission_status, :note)"
)
_COUNT_CANDIDATES = text("SELECT COUNT(*) AS cnt FROM unverified_sign_candidates WHERE submission_id = :sid")
_TERMINAL_STATUSES = {"COMPLETED", "PARTIALLY_PROCESSED", "FAILED", "NO_SIGN_DETECTED"}
def _advance_status(submission_id, new_status, note, expected_old=None):
    with get_sync_db() as db:
        row = db.execute(_SELECT_SUBMISSION, {"sid": submission_id}).mappings().first()
        if row is None:
            logger.warning("[ai] submission %s not found — skipping %s", submission_id, new_status)
            return None
        old_status = str(row["status"])
        if old_status in _TERMINAL_STATUSES:
            logger.info("[ai] submission %s already terminal (%s) — skipping %s", submission_id, old_status, new_status)
            return old_status
        if expected_old is not None and old_status != expected_old:
            logger.info("[ai] submission %s status=%s != expected %s — skipping %s", submission_id, old_status, expected_old, new_status)
            return old_status
        updated = db.execute(_UPDATE_STATUS, {"sid": submission_id, "new_status": new_status})
        if updated.rowcount == 0:
            db.rollback()
            return None
        db.execute(_INSERT_HISTORY, {"sid": submission_id, "old_status": old_status, "new_status": new_status, "note": note})
        db.commit()
        logger.info("[ai] submission %s: %s -> %s", submission_id, old_status, new_status)
        return old_status
def _mark_failed(submission_id, reason):
    try:
        _advance_status(submission_id, "FAILED", reason)
    except Exception:
        logger.exception("[ai] Could not mark submission %s as FAILED", submission_id)
@shared_task(name="app.tasks.ai_pipeline.task_process_submission_pipeline", bind=True, max_retries=2, default_retry_delay=60, acks_late=True)
def task_process_submission_pipeline(self, submission_id):  # type: ignore[no-untyped-def]
    """Entry point: QUEUED -> SYNCHRONIZING, then chains YOLO detection."""
    logger.info("[ai] pipeline start for submission %s", submission_id)
    old = _advance_status(submission_id, "SYNCHRONIZING", "Pipeline started -- synchronising GPX and video streams.", expected_old="QUEUED")
    if old is None or old in _TERMINAL_STATUSES:
        return {"submission_id": submission_id, "skipped": True, "reason": old}
    # STUB: GPX <-> video temporal synchronisation
    # TODO(teammate): fetch MinIO objects, parse GPX, interpolate timestamps.
    # On failure: _mark_failed(submission_id, "..."); return.
    logger.info("[ai] [STUB] GPX/video sync complete for %s", submission_id)
    task_run_yolo_detection.apply_async(args=[submission_id])
    return {"submission_id": submission_id, "status": "SYNCHRONIZING"}
@shared_task(name="app.tasks.ai_pipeline.task_run_yolo_detection", bind=True, max_retries=2, default_retry_delay=60, acks_late=True)
def task_run_yolo_detection(self, submission_id):  # type: ignore[no-untyped-def]
    """YOLO12 frame-level detection (stub): SYNCHRONIZING -> DETECTING."""
    logger.info("[ai] YOLO12 detection for submission %s", submission_id)
    _advance_status(submission_id, "DETECTING", "YOLO12 detection running (stub).")
    # STUB: YOLO12 inference
    # TODO(teammate): load YOLO12 checkpoint, run on every frame, write
    # unverified_sign_candidates rows + upload crops to stm-sign-crops.
    # On failure: _mark_failed(submission_id, "YOLO12: ..."); return.
    logger.info("[ai] [STUB] YOLO12 complete for %s", submission_id)
    task_run_botsort_tracking.apply_async(args=[submission_id])
    return {"submission_id": submission_id, "status": "DETECTING"}
@shared_task(name="app.tasks.ai_pipeline.task_run_botsort_tracking", bind=True, max_retries=2, default_retry_delay=60, acks_late=True)
def task_run_botsort_tracking(self, submission_id):  # type: ignore[no-untyped-def]
    """BoT-SORT tracking (stub): DETECTING -> TRACKING."""
    logger.info("[ai] BoT-SORT tracking for submission %s", submission_id)
    _advance_status(submission_id, "TRACKING", "BoT-SORT tracker running (stub).")
    # STUB: BoT-SORT
    # TODO(teammate): stitch per-frame detections into tracks, deduplicate
    # overlapping views, update unverified_sign_candidates (merge/drop).
    # On failure: _mark_failed(submission_id, "BoT-SORT: ..."); return.
    logger.info("[ai] [STUB] BoT-SORT complete for %s", submission_id)
    task_estimate_sign_locations.apply_async(args=[submission_id])
    return {"submission_id": submission_id, "status": "TRACKING"}
@shared_task(name="app.tasks.ai_pipeline.task_estimate_sign_locations",
             bind=True, max_retries=2, default_retry_delay=60, acks_late=True)
def task_estimate_sign_locations(self, submission_id):  # type: ignore[no-untyped-def]
    """GPS/heading -> world-coordinate estimation (stub): TRACKING -> ESTIMATING."""
    logger.info("[ai] Spatial estimation for submission %s", submission_id)
    _advance_status(submission_id, "ESTIMATING", "Spatial estimation running (stub).")
    # STUB: world-coordinate estimation
    # TODO(teammate): use trajectory LineString + candidate frame index +
    # camera intrinsics + heading to estimate each sign geographic location
    # and traffic_direction. Persist to candidate geometry cols.
    # On failure: _mark_failed(submission_id, "estimation: ..."); return.
    logger.info("[ai] [STUB] Spatial estimation complete for %s", submission_id)
    task_classify_signs_clip.apply_async(args=[submission_id])
    return {"submission_id": submission_id, "status": "ESTIMATING"}

@shared_task(name="app.tasks.ai_pipeline.task_classify_signs_clip",
             bind=True, max_retries=2, default_retry_delay=60, acks_late=True)
def task_classify_signs_clip(self, submission_id):  # type: ignore[no-untyped-def]
    """CLIP classification coordinator (stub): ESTIMATING -> CLASSIFYING."""
    logger.info("[ai] CLIP coordinator for submission %s", submission_id)
    _advance_status(submission_id, "CLASSIFYING", "CLIP classification running (stub).")
    # STUB: CLIP classification
    # TODO(teammate): for each candidate: emb=clip_model.encode_image(crop),
    # best_type, conf = classify(emb, sign_catalog),
    # UPDATE unverified_sign_candidates SET predicted_sign_type_id=best_type.
    # For fan-out at scale use:
    #   chord(task_generate_clip_embeddings.s(submission_id, str(c.id))
    #         for c in candidates)(task_finalize_submission.s(submission_id))
    logger.info("[ai] [STUB] CLIP classification complete for %s", submission_id)
    task_finalize_submission.apply_async(args=[submission_id])
    return {"submission_id": submission_id, "status": "CLASSIFYING"}

@shared_task(name="app.tasks.ai_pipeline.task_generate_clip_embeddings",
             bind=True, max_retries=2, default_retry_delay=60, acks_late=True)
def task_generate_clip_embeddings(self, submission_id, candidate_id):  # type: ignore[no-untyped-def]
    """Per-candidate CLIP embedding + classification (stub)."""
    logger.info("[ai] CLIP embedding for candidate %s (submission %s)", candidate_id, submission_id)
    # STUB: single-candidate CLIP
    # TODO(teammate): load crop from MinIO, clip_model.encode_image(crop),
    # classify against traffic_sign_types, UPDATE candidate row.
    logger.info("[ai] [STUB] CLIP embedding complete for candidate %s", candidate_id)
    return {"submission_id": submission_id, "candidate_id": candidate_id}

@shared_task(name="app.tasks.ai_pipeline.task_finalize_submission",
             bind=True, max_retries=2, default_retry_delay=60, acks_late=True)
def task_finalize_submission(self, submission_id):  # type: ignore[no-untyped-def]
    """Final aggregation: CLASSIFYING -> COMPLETED / NO_SIGN_DETECTED."""
    logger.info("[ai] Finalising submission %s", submission_id)
    try:
        with get_sync_db() as db:
            row = db.execute(_SELECT_SUBMISSION, {"sid": submission_id}).mappings().first()
            if row is None:
                logger.warning("[ai] submission %s not found at finalise", submission_id)
                return {"submission_id": submission_id, "skipped": True}
            old_status = str(row["status"])
            if old_status in _TERMINAL_STATUSES:
                logger.info("[ai] submission %s already terminal (%s) — skipping finalise",
                            submission_id, old_status)
                return {"submission_id": submission_id, "skipped": True}
            cnt_row = db.execute(_COUNT_CANDIDATES, {"sid": submission_id}).mappings().first()
            total = int(cnt_row["cnt"]) if cnt_row else 0
            db.execute(text("UPDATE survey_submissions "
                             "SET total_candidates_extracted = :cnt, updated_at = NOW() "
                             "WHERE id = :sid"),
                       {"cnt": total, "sid": submission_id})
            if total == 0:
                new_status = "NO_SIGN_DETECTED"
                note = "Pipeline finished — no sign candidates detected."
            else:
                new_status = "COMPLETED"
                note = f"Pipeline finished — {total} candidate(s) awaiting review."
            db.execute(_UPDATE_STATUS, {"sid": submission_id, "new_status": new_status})
            db.execute(_INSERT_HISTORY, {"sid": submission_id, "old_status": old_status,
                                          "new_status": new_status, "note": note})
            db.commit()
            logger.info("[ai] submission %s finalised: %s (%d candidates)",
                        submission_id, new_status, total)
            return {"submission_id": submission_id, "status": new_status, "total_candidates": total}
    except Exception as exc:
        logger.exception("[ai] Finalise failed for submission %s: %s", submission_id, exc)
        raise self.retry(exc=exc)
