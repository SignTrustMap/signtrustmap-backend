"""
app.schemas.spatial — Pydantic request / response contracts for Phase 3.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


# ── Bounding box (Flow 6: interactive GIS map) ──────────────────────────────
class BoundingBoxParams(BaseModel):
    min_lat: float = Field(ge=-90.0, le=90.0, description="South boundary (degrees).")
    min_lon: float = Field(ge=-180.0, le=180.0, description="West boundary.")
    max_lat: float = Field(ge=-90.0, le=90.0, description="North boundary.")
    max_lon: float = Field(ge=-180.0, le=180.0, description="East boundary.")

    @model_validator(mode="after")
    def _check_bbox_order(self) -> "BoundingBoxParams":
        if self.min_lat > self.max_lat:
            raise ValueError("min_lat must be <= max_lat")
        if self.min_lon > self.max_lon:
            raise ValueError("min_lon must be <= max_lon")
        return self


class GeoJSONFeature(BaseModel):
    type: Literal["Feature"] = "Feature"
    geometry: dict[str, Any]  # {"type":"Point","coordinates":[lon, lat]}
    properties: dict[str, Any]


class GeoJSONFeatureCollection(BaseModel):
    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: list[GeoJSONFeature]
    total: int = Field(description="Total number of features returned.")


# ── Navigation WebSocket payloads (Flow 7) ─────────────────────────────────
class NavigationPointPayload(BaseModel):
    """Payload that the driver sends once per telemetry tick."""

    latitude: float = Field(ge=-90.0, le=90.0)
    longitude: float = Field(ge=-180.0, le=180.0)
    # Compass heading: 0 == North, 90 == East, 180 == South, 270 == West.
    heading: float = Field(default=0.0, ge=0.0, lt=360.0)
    # If omitted, the point is still used for proximity alerts but NOT persisted.
    session_id: UUID | None = Field(
        default=None,
        validation_alias="sessionId",
        serialization_alias="sessionId",
        description="Active navigation_sessions.id — when provided each point is persisted.",
    )

    model_config = ConfigDict(populate_by_name=True)


class NavigationSignAlertItem(BaseModel):
    id: UUID
    sign_type_id: int = Field(validation_alias="sign_type_id", serialization_alias="signTypeId")
    longitude: float
    latitude: float
    traffic_direction: float | None = Field(
        default=None, validation_alias="traffic_direction", serialization_alias="trafficDirection"
    )
    sign_crop_url: str = Field(
        validation_alias="sign_crop_url", serialization_alias="signCropUrl"
    )

    model_config = ConfigDict(populate_by_name=True)


class NavigationAlertMessage(BaseModel):
    type: Literal["sign_alerts"] = "sign_alerts"
    latitude: float
    longitude: float
    heading: float
    alerts: list[NavigationSignAlertItem]
    alert_count: int = Field(description="len(alerts) — convenience for clients.")

    @model_validator(mode="after")
    def _set_count(self) -> "NavigationAlertMessage":
        self.alert_count = len(self.alerts)
        return self


class NavigationErrorMessage(BaseModel):
    type: Literal["error"] = "error"
    message: str


# ── Health ──────────────────────────────────────────────────────────────────
class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    service: str = "stm-fastapi"
    version: str = "1.0.0"
    env: str


# ── Sign detail response (Flow 6: GET /signs/{id}) ─────────────────────────
class SignDetailResponse(BaseModel):
    id: UUID
    sign_type_id: int
    category_id: int | None = None
    sign_code: str | None = None
    name_vi: str | None = None
    name_en: str | None = None
    longitude: float
    latitude: float
    traffic_direction: float | None = None
    sign_crop_url: str
    status: str
    freshness_score: float
    last_verified_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


# ── Navigation session management (Flow 7: REST lifecycle) ──────────────────
class CreateSessionRequest(BaseModel):
    """Body for POST /navigation/sessions."""

    driver_id: UUID = Field(description="UUID of the Driver user (users.id).")
    origin_latitude: float = Field(ge=-90.0, le=90.0)
    origin_longitude: float = Field(ge=-180.0, le=180.0)
    destination_latitude: float = Field(ge=-90.0, le=90.0)
    destination_longitude: float = Field(ge=-180.0, le=180.0)


class SessionResponse(BaseModel):
    id: UUID
    driver_id: UUID
    status: str
    started_at: datetime
    ended_at: datetime | None = None
    origin_latitude: float
    origin_longitude: float
    destination_latitude: float
    destination_longitude: float


class UpdateSessionRequest(BaseModel):
    """Body for PATCH /navigation/sessions/{id}."""

    status: Literal["COMPLETED", "CANCELED"] = Field(
        description="Terminal status. Only ACTIVE sessions can be transitioned."
    )
