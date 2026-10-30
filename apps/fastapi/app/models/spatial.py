"""
app.models.spatial — SQLAlchemy ORM models for the Phase 3 spatial domain.

Only the tables needed by the Phase 3 HTTP + WebSocket endpoints are
declared here:

* ``VerifiedTrafficSign`` — traffic signs already verified and georeferenced
  (``verified_traffic_signs``).
* ``NavigationSession``   — a single driver's premium navigation run
  (``navigation_sessions``).
* ``NavigationRoutePoint`` — an individual GPS point of the driven route
  (``navigation_route_points``).
* ``NavigationSignAlert``  — a proximity alert triggered during navigation
  (``navigation_sign_alerts``).

Geometry columns use ``geoalchemy2.Geometry`` with ``srid=4326`` so inserts
and spatial predicates can delegate to PostGIS operators.  When inserting we
prefer ``ST_SetSRID(ST_MakePoint(lon, lat), 4326)`` via raw SQL for clarity,
but the object mapper also round-trips correctly via the ``WKBElement`` type.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from geoalchemy2 import Geometry
from sqlalchemy import BigInteger, String, Text, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """Shared declarative base for the FastAPI app.

    Other phase apps reuse their own bases; keeping this one minimal lets
    Alembic/``Base.metadata`` introspection stay scoped to the app.
    """

    __table_args__ = {"extend_existing": True}


# ── Verified traffic signs (Flow 6: interactive GIS map) ───────────────────
class VerifiedTrafficSign(Base):
    __tablename__ = "verified_traffic_signs"

    id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    sign_type_id: Mapped[int] = mapped_column()
    origin_candidate_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True))
    # geoalchemy2 emits ``geometry(Point,4326)`` in CREATE TABLE.
    location: Mapped[object] = mapped_column(Geometry("POINT", srid=4326))
    traffic_direction: Mapped[float | None] = mapped_column()
    sign_crop_url: Mapped[str] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(30), default="ACTIVE")
    freshness_score: Mapped[float] = mapped_column(default=1.0)
    route_classification_id: Mapped[int | None] = mapped_column(nullable=True)
    road_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_verified_at: Mapped[datetime] = mapped_column(server_default=func.now())
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())


# ── Navigation sessions & route points (Flow 7: smart navigation) ──────────
class NavigationSession(Base):
    __tablename__ = "navigation_sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )
    driver_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True))
    origin: Mapped[object] = mapped_column(Geometry("POINT", srid=4326))
    destination: Mapped[object] = mapped_column(Geometry("POINT", srid=4326))
    credits_deducted: Mapped[int] = mapped_column(default=0)
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE")
    started_at: Mapped[datetime] = mapped_column(server_default=func.now())
    ended_at: Mapped[datetime | None] = mapped_column(default=None)


class NavigationRoutePoint(Base):
    __tablename__ = "navigation_route_points"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    session_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True))
    sequence_no: Mapped[int] = mapped_column()
    location: Mapped[object] = mapped_column(Geometry("POINT", srid=4326))
    recorded_at: Mapped[datetime] = mapped_column(server_default=func.now())


class NavigationSignAlert(Base):
    __tablename__ = "navigation_sign_alerts"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    session_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True))
    verified_sign_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True))
    alert_type: Mapped[str] = mapped_column(String(30), default="VOICE")
    triggered_at: Mapped[datetime] = mapped_column(server_default=func.now())
