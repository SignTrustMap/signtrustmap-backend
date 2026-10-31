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
    """Geographic viewport. Zero-area boxes (min == max) are rejected.

    Latitude/longitude of 0 is valid (e.g. boxes that cross the equator or
    prime meridian). The box itself must have positive area so PostGIS
    ``ST_MakeEnvelope`` receives a non-degenerate polygon.
    """
    model_config = ConfigDict(extra="ignore")

    min_lat: float = Field(
        ge=-90.0,
        le=90.0,
        description="South boundary (degrees). 0 is a valid latitude.",
        examples=[10.75],
    )
    min_lon: float = Field(
        ge=-180.0,
        le=180.0,
        description="West boundary (degrees). 0 is a valid longitude.",
        examples=[106.65],
    )
    max_lat: float = Field(
        ge=-90.0,
        le=90.0,
        description="North boundary (degrees).",
        examples=[10.82],
    )
    max_lon: float = Field(
        ge=-180.0,
        le=180.0,
        description="East boundary (degrees).",
        examples=[106.75],
    )

    @model_validator(mode="after")
    def _check_bbox_area(self) -> "BoundingBoxParams":
        # Align with NestJS verified-sign bbox: require strict inequality so
        # ST_MakeEnvelope never receives a degenerate zero-area envelope.
        if self.min_lat >= self.max_lat:
            raise ValueError("min_lat must be less than max_lat (zero-area bounding boxes are not allowed)")
        if self.min_lon >= self.max_lon:
            raise ValueError("min_lon must be less than max_lon (zero-area bounding boxes are not allowed)")
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


class PaginatedSessionsResponse(BaseModel):
    items: list[SessionResponse] = Field(default_factory=list, description="List of navigation sessions")
    total: int = Field(ge=0, description="Total count of sessions for this driver")
    page: int = Field(ge=1, description="Current page number")
    pageSize: int = Field(ge=1, le=100, description="Page size")
    totalPages: int = Field(ge=0, description="Total number of pages")


class UpdateSessionRequest(BaseModel):
    """Body for PATCH /navigation/sessions/{id}."""

    status: Literal["COMPLETED", "CANCELED"] = Field(
        description="Terminal status. Only ACTIVE sessions can be transitioned."
    )


# ── Offline PMTiles Map Packs ───────────────────────────────────────────────
class OfflineMapPack(BaseModel):
    id: str
    name: str
    description: str
    region: str
    country_code: str = Field(default="VN", validation_alias="country_code", serialization_alias="countryCode")
    format: str = "pmtiles"
    file_name: str = Field(validation_alias="file_name", serialization_alias="fileName")
    size_bytes: int = Field(validation_alias="size_bytes", serialization_alias="sizeBytes")
    size_mb: float = Field(validation_alias="size_mb", serialization_alias="sizeMb")
    min_zoom: int = Field(default=0, validation_alias="min_zoom", serialization_alias="minZoom")
    max_zoom: int = Field(default=15, validation_alias="max_zoom", serialization_alias="maxZoom")
    bounds: list[float]  # [west, south, east, north]
    is_available: bool = Field(default=True, validation_alias="is_available", serialization_alias="isAvailable")
    last_modified: datetime | None = Field(default=None, validation_alias="last_modified", serialization_alias="lastModified")
    download_url: str = Field(validation_alias="download_url", serialization_alias="downloadUrl")

    model_config = ConfigDict(populate_by_name=True)


class OfflineMapPacksResponse(BaseModel):
    packs: list[OfflineMapPack]
    total: int

