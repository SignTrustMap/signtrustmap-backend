"""
app.api.v1.spatial -- Spatial GIS endpoints (Flow 6).

GET /spatial/signs            -> GeoJSON FeatureCollection with optional filters.
GET /spatial/signs/{sign_id}  -> Full sign detail (joined with traffic_sign_types).
"""
from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.spatial import (
    GeoJSONFeature,
    GeoJSONFeatureCollection,
    SignDetailResponse,
)

logger = logging.getLogger(__name__)
router = APIRouter()

# GIST index on verified_traffic_signs.location via ST_Within.
# JOIN with traffic_sign_types enriches each feature with name/code/category.
_SIGNS_IN_BBOX = text(
    """
    SELECT
        vts.id,
        vts.sign_type_id,
        tst.category_id,
        tst.sign_code,
        tst.name_vi,
        tst.name_en,
        ST_X(vts.location::geometry) AS longitude,
        ST_Y(vts.location::geometry) AS latitude,
        vts.traffic_direction,
        vts.sign_crop_url,
        vts.status,
        vts.freshness_score,
        vts.last_verified_at
    FROM verified_traffic_signs vts
    JOIN traffic_sign_types tst ON tst.id = vts.sign_type_id
    WHERE
        ST_Within(
            vts.location,
            ST_MakeEnvelope(:min_lon, :min_lat, :max_lon, :max_lat, 4326)
        )
        AND vts.status = 'ACTIVE'
        AND (CAST(:sign_type_id AS INTEGER) IS NULL OR vts.sign_type_id = CAST(:sign_type_id AS INTEGER))
        AND (CAST(:category_id  AS INTEGER) IS NULL OR tst.category_id  = CAST(:category_id  AS INTEGER))
    ORDER BY vts.last_verified_at DESC
    """
)

_SIGN_BY_ID = text(
    """
    SELECT
        vts.id,
        vts.sign_type_id,
        tst.category_id,
        tst.sign_code,
        tst.name_vi,
        tst.name_en,
        ST_X(vts.location::geometry) AS longitude,
        ST_Y(vts.location::geometry) AS latitude,
        vts.traffic_direction,
        vts.sign_crop_url,
        vts.status,
        vts.freshness_score,
        vts.last_verified_at,
        vts.created_at,
        vts.updated_at
    FROM verified_traffic_signs vts
    JOIN traffic_sign_types tst ON tst.id = vts.sign_type_id
    WHERE vts.id = :id
    """
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
    sign_type_id: int | None = Query(default=None, description="Filter by traffic_sign_types.id"),
    category_id: int | None = Query(default=None, description="Filter by sign_categories.id"),
    db: AsyncSession = Depends(get_db),
) -> GeoJSONFeatureCollection:
    if min_lat > max_lat:
        min_lat, max_lat = max_lat, min_lat
    if min_lon > max_lon:
        min_lon, max_lon = max_lon, min_lon
    result = await db.execute(
        _SIGNS_IN_BBOX,
        {
            "min_lon": min_lon,
            "min_lat": min_lat,
            "max_lon": max_lon,
            "max_lat": max_lat,
            "sign_type_id": sign_type_id,
            "category_id": category_id,
        },
    )
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
                "status": r["status"],
                "freshnessScore": float(r["freshness_score"]),
                "lastVerifiedAt": (
                    r["last_verified_at"].isoformat() if r["last_verified_at"] else None
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
    result = await db.execute(_SIGN_BY_ID, {"id": str(sign_id)})
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
