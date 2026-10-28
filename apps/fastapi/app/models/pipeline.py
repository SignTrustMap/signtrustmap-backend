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

from sqlalchemy import BigInteger, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.spatial import Base


class SurveySubmission(Base):
    __tablename__ = "survey_submissions"

    id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    surveyor_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True))
    submission_type: Mapped[str] = mapped_column(String(50))
    status: Mapped[str] = mapped_column(String(50), default="DRAFT")
    captured_at: Mapped[datetime | None] = mapped_column(server_default=func.now())
    coordinate_source: Mapped[str | None] = mapped_column(String(50))
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
    spatial_confidence: Mapped[str] = mapped_column(String(20), default="HIGH")
    active_learning_priority: Mapped[float] = mapped_column(default=0.0)
    status: Mapped[str] = mapped_column(String(50), default="PENDING_REVIEW")
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
