"""
app.models.pipeline — SQLAlchemy ORM models for survey ingestion and AI processing pipeline.

Declared models:
* SurveySubmission - Maps survey_submissions
* SubmissionMediaFile - Maps submission_media_files
* UnverifiedSignCandidate - Maps unverified_sign_candidates
* BatchSubmission - Maps batch_submissions
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from geoalchemy2 import Geometry
from sqlalchemy import BigInteger, Boolean, DateTime, Float, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import ENUM, JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.spatial import Base

SUBMISSION_STATUS_ENUM = ENUM(name="submission_status", create_type=False)
SPATIAL_CONFIDENCE_ENUM = ENUM(name="spatial_confidence_level", create_type=False)
CANDIDATE_STATUS_ENUM = ENUM(name="candidate_status", create_type=False)
AI_MODEL_TYPE_ENUM = ENUM(name="ai_model_type", create_type=False)
TRAINING_JOB_STATUS_ENUM = ENUM(name="training_job_status", create_type=False)
SUBMISSION_TYPE_ENUM = ENUM(name="submission_type", create_type=False)
COORDINATE_SOURCE_ENUM = ENUM(name="coordinate_source", create_type=False)
TASK_PRIORITY_ENUM = ENUM(name="task_priority", create_type=False)
TASK_STATUS_ENUM = ENUM(name="task_status", create_type=False)


class SurveySubmission(Base):
    __tablename__ = "survey_submissions"

    id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    surveyor_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True))
    submission_type: Mapped[str] = mapped_column(SUBMISSION_TYPE_ENUM)
    status: Mapped[str] = mapped_column(SUBMISSION_STATUS_ENUM, default="DRAFT")
    captured_at: Mapped[datetime | None] = mapped_column(server_default=func.now())
    coordinate_source: Mapped[str | None] = mapped_column(COORDINATE_SOURCE_ENUM, nullable=True)
    note: Mapped[str | None] = mapped_column(Text)
    validation_errors: Mapped[Any] = mapped_column(JSONB, server_default="[]")
    correction_requirements: Mapped[Any] = mapped_column(JSONB, server_default="[]")
    failure_reason: Mapped[str | None] = mapped_column(Text)
    total_candidates_extracted: Mapped[int] = mapped_column(default=0)
    camera_profile_id: Mapped[uuid.UUID | None] = mapped_column(PG_UUID(as_uuid=True))
    reward_status: Mapped[str | None] = mapped_column(String(32), default="NONE")
    reward_amount: Mapped[int | None] = mapped_column(default=0)
    idempotency_key: Mapped[str | None] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())


class SubmissionMediaFile(Base):
    __tablename__ = "submission_media_files"

    id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    submission_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True))
    upload_session_id: Mapped[uuid.UUID | None] = mapped_column(PG_UUID(as_uuid=True))
    media_type: Mapped[str] = mapped_column(String(50))
    file_url: Mapped[str] = mapped_column(String(500))
    file_size_bytes: Mapped[int | None] = mapped_column(BigInteger)
    duration_seconds: Mapped[float | None] = mapped_column()
    checksum: Mapped[str | None] = mapped_column(String(128))
    uploaded_at: Mapped[datetime] = mapped_column(server_default=func.now())


class UnverifiedSignCandidate(Base):
    __tablename__ = "unverified_sign_candidates"

    id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    submission_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True))
    predicted_sign_type_id: Mapped[int] = mapped_column()
    confidence_score: Mapped[float] = mapped_column()
    best_frame_url: Mapped[str] = mapped_column(String(500))
    sign_crop_url: Mapped[str] = mapped_column(String(500))
    spatial_confidence: Mapped[str] = mapped_column(SPATIAL_CONFIDENCE_ENUM, default="HIGH")
    active_learning_priority: Mapped[float] = mapped_column(default=0.0)
    status: Mapped[str] = mapped_column(CANDIDATE_STATUS_ENUM, default="PENDING_REVIEW")
    possible_signs: Mapped[Any] = mapped_column(JSONB, nullable=True)
    selected_sign_type_id: Mapped[int | None] = mapped_column(nullable=True)
    selected_by: Mapped[uuid.UUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    selected_at: Mapped[datetime | None] = mapped_column(nullable=True)
    selection_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())


class BatchSubmission(Base):
    __tablename__ = "batch_submissions"

    id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    user_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True))
    title: Mapped[str | None] = mapped_column(String(255))
    total_images: Mapped[int] = mapped_column(default=0)
    processed_images: Mapped[int] = mapped_column(default=0)
    extracted_candidates: Mapped[int] = mapped_column(default=0)
    reward_status: Mapped[str] = mapped_column(String(32), default="PENDING")
    reward_amount: Mapped[int] = mapped_column(default=0)
    status: Mapped[str] = mapped_column(String(32), default="PENDING")
    metadata_json: Mapped[Any] = mapped_column("metadata", JSONB, server_default="{}")
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())


class SubmissionStatusHistory(Base):
    __tablename__ = "submission_status_history"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    submission_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True))
    old_status: Mapped[str | None] = mapped_column(SUBMISSION_STATUS_ENUM, nullable=True)
    new_status: Mapped[str] = mapped_column(SUBMISSION_STATUS_ENUM)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    changed_at: Mapped[datetime] = mapped_column(server_default=func.now())


class CandidateDetectionMetadata(Base):
    __tablename__ = "candidate_detection_metadata"

    candidate_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    frame_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bbox_x: Mapped[float | None] = mapped_column(Float, nullable=True)
    bbox_y: Mapped[float | None] = mapped_column(Float, nullable=True)
    bbox_width: Mapped[float | None] = mapped_column(Float, nullable=True)
    bbox_height: Mapped[float | None] = mapped_column(Float, nullable=True)
    tracking_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    detector_model_version_id: Mapped[int | None] = mapped_column(Integer, nullable=True)


class CandidateGeoEstimation(Base):
    __tablename__ = "candidate_geo_estimations"

    candidate_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    vehicle_location: Mapped[Any] = mapped_column(Geometry("POINT", srid=4326))
    sign_location: Mapped[Any] = mapped_column(Geometry("POINT", srid=4326))
    estimated_distance: Mapped[float] = mapped_column(Float)
    bearing_angle: Mapped[float] = mapped_column(Float)
    traffic_direction: Mapped[float | None] = mapped_column(Float, nullable=True)
    projection_method: Mapped[str] = mapped_column(String(50), default="spherical_trig")


class CameraCalibrationProfile(Base):
    __tablename__ = "camera_calibration_profiles"

    id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    user_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True))
    device_model: Mapped[str] = mapped_column(String(100))
    camera_height_meters: Mapped[float] = mapped_column(Float, default=1.35)
    pitch_angle_degrees: Mapped[float] = mapped_column(Float, default=0.0)
    yaw_offset_degrees: Mapped[float] = mapped_column(Float, default=0.0)
    hfov_degrees: Mapped[float] = mapped_column(Float, default=60.0)
    focal_length_px: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())


class TrafficSignType(Base):
    __tablename__ = "traffic_sign_types"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    category_id: Mapped[int] = mapped_column(Integer)
    sign_code: Mapped[str] = mapped_column(String(50))
    name_vi: Mapped[str] = mapped_column(String(255))
    name_en: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    labeling_guidelines: Mapped[str | None] = mapped_column(Text, nullable=True)
    shape: Mapped[str | None] = mapped_column(String(30), nullable=True)
    color_scheme: Mapped[str | None] = mapped_column(String(30), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    slug: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())


class ModelTrainingJob(Base):
    __tablename__ = "model_training_jobs"

    id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    model_type: Mapped[str] = mapped_column(AI_MODEL_TYPE_ENUM)
    triggered_by: Mapped[uuid.UUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    status: Mapped[str] = mapped_column(TRAINING_JOB_STATUS_ENUM, default="QUEUED")
    result_model_version_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    evaluation_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(nullable=True)


class AiModelVersion(Base):
    __tablename__ = "ai_model_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    model_type: Mapped[str] = mapped_column(AI_MODEL_TYPE_ENUM)
    version_tag: Mapped[str] = mapped_column(String(50))
    artifact_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    trained_at: Mapped[datetime | None] = mapped_column(nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    evaluation_metrics: Mapped[Any] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    action: Mapped[str] = mapped_column(String(100))
    resource_name: Mapped[str] = mapped_column(String(100))
    resource_id: Mapped[str] = mapped_column(String(100))
    old_values: Mapped[Any] = mapped_column(JSONB, nullable=True)
    new_values: Mapped[Any] = mapped_column(JSONB, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class RouteClassification(Base):
    __tablename__ = "route_classifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    road_type: Mapped[str] = mapped_column(String(50))
    default_lifetime_days: Mapped[int] = mapped_column(Integer)
    revalidation_threshold_days: Mapped[int] = mapped_column(Integer)
    spatial_buffer_meters: Mapped[int] = mapped_column(Integer, default=20)


class RevalidationTask(Base):
    __tablename__ = "revalidation_tasks"

    id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    verified_sign_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True))
    freshness_rule_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    priority: Mapped[str] = mapped_column(TASK_PRIORITY_ENUM, default="MEDIUM")
    reward_credits: Mapped[int] = mapped_column(Integer, default=10)
    urgency: Mapped[float] = mapped_column(Float, default=0.0)
    route_classification_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(TASK_STATUS_ENUM, default="OPEN")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SignLifecycleEvent(Base):
    __tablename__ = "sign_lifecycle_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    verified_sign_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True))
    event_type: Mapped[str] = mapped_column(String(50))
    performed_by: Mapped[uuid.UUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SignCategory(Base):
    __tablename__ = "sign_categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(50))
    name_vi: Mapped[str] = mapped_column(String(100))
    name_en: Mapped[str] = mapped_column(String(100))


class SignTypeAiPrompt(Base):
    __tablename__ = "sign_type_ai_prompts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    sign_type_id: Mapped[int] = mapped_column(Integer)
    target_model: Mapped[str] = mapped_column(String(50))
    prompt_text: Mapped[str] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class CatalogVersion(Base):
    __tablename__ = "catalog_versions"

    id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True)
    version_number: Mapped[int] = mapped_column(Integer)
    published_by: Mapped[uuid.UUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    change_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_current: Mapped[bool] = mapped_column(Boolean, default=True)
