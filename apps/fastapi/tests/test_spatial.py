"""
tests.test_spatial — Regression tests for GET /api/v1/spatial/signs.

Covers Schemathesis ST101 reproduction (all-zero / zero-area bbox → must be
422, never 500) and related bounding-box / filter edge cases.
"""
from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.database import get_db
from app.main import app
from app.schemas.spatial import BoundingBoxParams


@pytest.fixture
def mock_db():
    db = AsyncMock()
    result = MagicMock()
    result.mappings.return_value.all.return_value = []
    db.execute.return_value = result
    return db


@pytest.fixture
def client(mock_db):
    app.dependency_overrides[get_db] = lambda: mock_db
    yield TestClient(app)
    app.dependency_overrides.pop(get_db, None)


def _signs_url(**params: object) -> str:
    query = "&".join(f"{key}={value}" for key, value in params.items())
    return f"/api/v1/spatial/signs?{query}"


def test_valid_bounding_box_returns_empty_feature_collection(client, mock_db):
    res = client.get(
        _signs_url(min_lat=10.75, min_lon=106.65, max_lat=10.82, max_lon=106.75)
    )
    assert res.status_code == 200
    body = res.json()
    assert body["type"] == "FeatureCollection"
    assert body["features"] == []
    assert body["total"] == 0
    mock_db.execute.assert_awaited()


def test_bbox_touching_latitude_zero_allowed(client, mock_db):
    """0° latitude is geographically valid when the box still has area."""
    res = client.get(_signs_url(min_lat=-0.5, min_lon=106.65, max_lat=0.5, max_lon=106.75))
    assert res.status_code == 200
    assert res.json()["total"] == 0


def test_bbox_touching_longitude_zero_allowed(client, mock_db):
    """0° longitude is geographically valid when the box still has area."""
    res = client.get(_signs_url(min_lat=10.75, min_lon=-0.5, max_lat=10.82, max_lon=0.5))
    assert res.status_code == 200
    assert res.json()["total"] == 0


def test_zero_area_bbox_all_zeros_returns_422_not_500(client, mock_db):
    """
    Schemathesis reproduction:
    GET .../signs?max_lat=0.0&max_lon=0.0&min_lat=0.0&min_lon=0.0&sign_type_id=1
    Must never become an unhandled HTTP 500.
    """
    res = client.get(
        _signs_url(
            min_lat=0.0,
            min_lon=0.0,
            max_lat=0.0,
            max_lon=0.0,
            sign_type_id=1,
            **{"x-schemathesis-unknown-property": 42},
        )
    )
    assert res.status_code == 422
    mock_db.execute.assert_not_awaited()
    detail = res.json()["detail"]
    assert isinstance(detail, list)
    fields = {err["loc"][-1] for err in detail}
    assert "min_lat" in fields
    assert "min_lon" in fields


def test_zero_area_latitude_only_returns_422(client, mock_db):
    res = client.get(_signs_url(min_lat=10.8, min_lon=106.65, max_lat=10.8, max_lon=106.75))
    assert res.status_code == 422
    mock_db.execute.assert_not_awaited()


def test_min_lat_greater_than_max_lat_returns_422(client, mock_db):
    res = client.get(_signs_url(min_lat=10.9, min_lon=106.65, max_lat=10.7, max_lon=106.75))
    assert res.status_code == 422
    mock_db.execute.assert_not_awaited()


def test_min_lon_greater_than_max_lon_returns_422(client, mock_db):
    res = client.get(_signs_url(min_lat=10.75, min_lon=106.8, max_lat=10.82, max_lon=106.65))
    assert res.status_code == 422
    mock_db.execute.assert_not_awaited()


def test_out_of_range_latitude_returns_422(client):
    res = client.get(_signs_url(min_lat=-91, min_lon=106.65, max_lat=10.82, max_lon=106.75))
    assert res.status_code == 422


def test_out_of_range_longitude_returns_422(client):
    res = client.get(_signs_url(min_lat=10.75, min_lon=-181, max_lat=10.82, max_lon=106.75))
    assert res.status_code == 422


def test_missing_required_parameters_returns_422(client):
    res = client.get("/api/v1/spatial/signs?min_lat=10.75&min_lon=106.65")
    assert res.status_code == 422


def test_non_numeric_parameter_returns_422(client):
    res = client.get(
        _signs_url(min_lat="abc", min_lon=106.65, max_lat=10.82, max_lon=106.75)
    )
    assert res.status_code == 422


def test_unknown_query_parameter_is_ignored(client, mock_db):
    res = client.get(
        _signs_url(
            min_lat=10.75,
            min_lon=106.65,
            max_lat=10.82,
            max_lon=106.75,
            **{"x-schemathesis-unknown-property": 42},
        )
    )
    assert res.status_code == 200
    mock_db.execute.assert_awaited()


def test_existing_sign_type_id_filter_accepted(client, mock_db):
    res = client.get(
        _signs_url(
            min_lat=10.75,
            min_lon=106.65,
            max_lat=10.82,
            max_lon=106.75,
            sign_type_id=1,
        )
    )
    assert res.status_code == 200


def test_nonexistent_sign_type_id_returns_empty_not_error(client, mock_db):
    """Unknown sign_type_id is a filter, not a 404 — empty FeatureCollection."""
    res = client.get(
        _signs_url(
            min_lat=10.75,
            min_lon=106.65,
            max_lat=10.82,
            max_lon=106.75,
            sign_type_id=2147483647,
        )
    )
    assert res.status_code == 200
    assert res.json()["features"] == []
    assert res.json()["total"] == 0


def test_empty_query_result_serializes_features(client, mock_db):
    sign_id = uuid4()
    now = datetime.now(timezone.utc)
    result = MagicMock()
    result.mappings.return_value.all.return_value = [
        {
            "id": sign_id,
            "sign_type_id": 1,
            "category_id": 2,
            "sign_code": "P.101",
            "name_vi": "Cấm đi",
            "name_en": "No entry",
            "longitude": 106.7,
            "latitude": 10.78,
            "traffic_direction": 90.0,
            "sign_crop_url": "https://example.com/crop.jpg",
            "best_frame_url": None,
            "status": "ACTIVE",
            "freshness_score": None,
            "last_verified_at": now,
            "created_at": now,
        }
    ]
    mock_db.execute.return_value = result

    res = client.get(
        _signs_url(min_lat=10.75, min_lon=106.65, max_lat=10.82, max_lon=106.75)
    )
    assert res.status_code == 200
    body = res.json()
    assert body["total"] == 1
    assert body["features"][0]["properties"]["freshnessScore"] == 0.0
    assert body["features"][0]["properties"]["id"] == str(sign_id)


def test_bounding_box_params_model_rejects_zero_area():
    with pytest.raises(ValidationError):
        BoundingBoxParams(min_lat=0.0, min_lon=0.0, max_lat=0.0, max_lon=0.0)


def test_bounding_box_params_model_accepts_box_crossing_zero():
    bbox = BoundingBoxParams(min_lat=-1.0, min_lon=-1.0, max_lat=1.0, max_lon=1.0)
    assert bbox.min_lat == -1.0
    assert bbox.max_lon == 1.0
