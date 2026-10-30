"""
app.api.v1.spatial -- Spatial GIS endpoints (Flow 6).

GET /spatial/signs            -> GeoJSON FeatureCollection with optional filters.
GET /spatial/signs/{sign_id}  -> Full sign detail (joined with traffic_sign_types).
"""
from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from geoalchemy2 import Geometry
from sqlalchemy import cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.spatial import VerifiedTrafficSign
from app.models.pipeline import TrafficSignType, UnverifiedSignCandidate
from app.schemas.spatial import (
    GeoJSONFeature,
    GeoJSONFeatureCollection,
    HealthResponse,
    SignDetailResponse,
)
from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Spatial GIS health check",
    tags=["Health"],
)
async def spatial_health() -> dict:  # type: ignore[no-untyped-def]
    return HealthResponse(
        status="ok",
        service="stm-fastapi",
        version="1.0.0",
        env=settings.APP_ENV,
    ).model_dump()


def _signs_in_bbox_query(
    min_lon: float,
    min_lat: float,
    max_lon: float,
    max_lat: float,
    sign_type_id: int | None = None,
    category_id: int | None = None,
):
    stmt = (
        select(
            VerifiedTrafficSign.id,
            VerifiedTrafficSign.sign_type_id,
            TrafficSignType.category_id,
            TrafficSignType.sign_code,
            TrafficSignType.name_vi,
            TrafficSignType.name_en,
            func.ST_X(cast(VerifiedTrafficSign.location, Geometry)).label("longitude"),
            func.ST_Y(cast(VerifiedTrafficSign.location, Geometry)).label("latitude"),
            VerifiedTrafficSign.traffic_direction,
            VerifiedTrafficSign.sign_crop_url,
            UnverifiedSignCandidate.best_frame_url,
            VerifiedTrafficSign.status,
            VerifiedTrafficSign.freshness_score,
            VerifiedTrafficSign.last_verified_at,
            VerifiedTrafficSign.created_at,
        )
        .select_from(VerifiedTrafficSign)
        .join(TrafficSignType, TrafficSignType.id == VerifiedTrafficSign.sign_type_id)
        .outerjoin(UnverifiedSignCandidate, UnverifiedSignCandidate.id == VerifiedTrafficSign.origin_candidate_id)
        .where(
            func.ST_Within(
                VerifiedTrafficSign.location,
                func.ST_MakeEnvelope(min_lon, min_lat, max_lon, max_lat, 4326),
            ),
            VerifiedTrafficSign.status == "ACTIVE",
        )
        .order_by(VerifiedTrafficSign.last_verified_at.desc())
    )
    if sign_type_id is not None:
        stmt = stmt.where(VerifiedTrafficSign.sign_type_id == sign_type_id)
    if category_id is not None:
        stmt = stmt.where(TrafficSignType.category_id == category_id)
    return stmt


def _sign_by_id_query(sign_id: UUID):
    return (
        select(
            VerifiedTrafficSign.id,
            VerifiedTrafficSign.sign_type_id,
            TrafficSignType.category_id,
            TrafficSignType.sign_code,
            TrafficSignType.name_vi,
            TrafficSignType.name_en,
            func.ST_X(cast(VerifiedTrafficSign.location, Geometry)).label("longitude"),
            func.ST_Y(cast(VerifiedTrafficSign.location, Geometry)).label("latitude"),
            VerifiedTrafficSign.traffic_direction,
            VerifiedTrafficSign.sign_crop_url,
            UnverifiedSignCandidate.best_frame_url,
            VerifiedTrafficSign.status,
            VerifiedTrafficSign.freshness_score,
            VerifiedTrafficSign.last_verified_at,
            VerifiedTrafficSign.created_at,
            VerifiedTrafficSign.updated_at,
        )
        .select_from(VerifiedTrafficSign)
        .join(TrafficSignType, TrafficSignType.id == VerifiedTrafficSign.sign_type_id)
        .outerjoin(UnverifiedSignCandidate, UnverifiedSignCandidate.id == VerifiedTrafficSign.origin_candidate_id)
        .where(VerifiedTrafficSign.id == sign_id)
    )


@router.get(
    "/signs",
    response_model=GeoJSONFeatureCollection,
    summary="Get verified signs in a bounding box (GeoJSON)",
    description=(
        "ST_Within + ST_MakeEnvelope query (GIST index). "
        "Returns ACTIVE signs as GeoJSON FeatureCollection. "
        "Optionally filter by sign_type_id or category_id."
    ),
    tags=["Spatial GIS"],
)
async def get_signs_in_viewport(
    min_lat: float = Query(..., ge=-90.0, le=90.0, description="South boundary"),
    min_lon: float = Query(..., ge=-180.0, le=180.0, description="West boundary"),
    max_lat: float = Query(..., ge=-90.0, le=90.0, description="North boundary"),
    max_lon: float = Query(..., ge=-180.0, le=180.0, description="East boundary"),
    sign_type_id: int | None = Query(default=None, ge=1, le=2147483647, description="Filter by traffic_sign_types.id"),
    category_id: int | None = Query(default=None, ge=1, le=2147483647, description="Filter by sign_categories.id"),
    db: AsyncSession = Depends(get_db),
) -> GeoJSONFeatureCollection:
    if min_lat > max_lat:
        min_lat, max_lat = max_lat, min_lat
    if min_lon > max_lon:
        min_lon, max_lon = max_lon, min_lon
    stmt = _signs_in_bbox_query(min_lon, min_lat, max_lon, max_lat, sign_type_id, category_id)
    result = await db.execute(stmt)
    rows = result.mappings().all()
    features: list[GeoJSONFeature] = [
        GeoJSONFeature(
            geometry={
                "type": "Point",
                "coordinates": [float(r["longitude"]), float(r["latitude"])],
            },
            properties={
                "id": str(r["id"]),
                "signTypeId": r["sign_type_id"],
                "categoryId": r["category_id"],
                "signCode": r["sign_code"],
                "nameVi": r["name_vi"],
                "nameEn": r["name_en"],
                "trafficDirection": r["traffic_direction"],
                "signCropUrl": r["sign_crop_url"],
                "frameUrl": r["best_frame_url"],
                "bestFrameUrl": r["best_frame_url"],
                "status": r["status"],
                "freshnessScore": float(r["freshness_score"]),
                "lastVerifiedAt": (
                    r["last_verified_at"].isoformat() if r["last_verified_at"] else None
                ),
                "createdAt": (
                    r["created_at"].isoformat() if r["created_at"] else None
                ),
            },
        )
        for r in rows
    ]
    return GeoJSONFeatureCollection(features=features, total=len(features))


@router.get(
    "/signs/{sign_id}",
    response_model=SignDetailResponse,
    summary="Get full details of a single verified sign",
    description=(
        "Returns all sign fields plus joined traffic_sign_type metadata "
        "(name_vi, name_en, sign_code, category_id). 404 if not found."
    ),
    tags=["Spatial GIS"],
)
async def get_sign_detail(
    sign_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> SignDetailResponse:
    stmt = _sign_by_id_query(sign_id)
    result = await db.execute(stmt)
    row = result.mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Sign {sign_id} not found")
    return SignDetailResponse(
        id=row["id"],
        sign_type_id=row["sign_type_id"],
        category_id=row["category_id"],
        sign_code=row["sign_code"],
        name_vi=row["name_vi"],
        name_en=row["name_en"],
        longitude=float(row["longitude"]),
        latitude=float(row["latitude"]),
        traffic_direction=row["traffic_direction"],
        sign_crop_url=row["sign_crop_url"],
        status=row["status"],
        freshness_score=float(row["freshness_score"]),
        last_verified_at=row["last_verified_at"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )
