"""
tests.test_navigation -- Unit tests for Navigation sessions REST endpoints and Schemathesis regression tests.
"""
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient

from app.database import get_db
from app.main import app


@pytest.fixture
def mock_db():
    db = AsyncMock()
    mock_count = MagicMock()
    mock_count.mappings.return_value.first.return_value = {"cnt": 0}
    db.execute.return_value = mock_count
    return db


@pytest.fixture
def client(mock_db):
    app.dependency_overrides[get_db] = lambda: mock_db
    yield TestClient(app)
    app.dependency_overrides.pop(get_db, None)


def test_list_my_sessions_valid(client, mock_db):
    driver_id = str(uuid4())
    res = client.get(f"/api/v1/spatial/navigation/sessions/me?driver_id={driver_id}&page=1&pageSize=20")
    assert res.status_code == 200
    data = res.json()
    assert data["items"] == []
    assert data["total"] == 0
    assert data["page"] == 1
    assert data["pageSize"] == 20
    assert data["totalPages"] == 0


def test_list_my_sessions_schemathesis_overflow_repro(client):
    """
    Regression test for Schemathesis test case k7iDzv:
    GET /api/v1/spatial/navigation/sessions/me?driver_id=d8f1801a-69a7-23f3-93b4-d21b8e348951&pageSize=-2279&page=41443638922020143497216
    Must return 422 Unprocessable Entity, NEVER 500 Internal Server Error.
    """
    res = client.get(
        "/api/v1/spatial/navigation/sessions/me"
        "?driver_id=d8f1801a-69a7-23f3-93b4-d21b8e348951"
        "&pageSize=-2279"
        "&page=41443638922020143497216"
    )
    assert res.status_code == 422
    errors = res.json()["detail"]
    fields = [err["loc"][-1] for err in errors]
    assert "page" in fields
    assert "pageSize" in fields


def test_list_my_sessions_negative_page(client):
    driver_id = str(uuid4())
    res = client.get(f"/api/v1/spatial/navigation/sessions/me?driver_id={driver_id}&page=-5&pageSize=20")
    assert res.status_code == 422


def test_list_my_sessions_page_size_exceeded(client):
    driver_id = str(uuid4())
    res = client.get(f"/api/v1/spatial/navigation/sessions/me?driver_id={driver_id}&page=1&pageSize=500")
    assert res.status_code == 422


def test_list_my_sessions_invalid_driver_uuid(client):
    res = client.get("/api/v1/spatial/navigation/sessions/me?driver_id=not-a-uuid&page=1&pageSize=20")
    assert res.status_code == 422


def test_list_my_sessions_offset_beyond_total(client, mock_db):
    """Ensure large page within int32 range does not trigger query when offset >= total."""
    driver_id = str(uuid4())
    res = client.get(f"/api/v1/spatial/navigation/sessions/me?driver_id={driver_id}&page=2147483647&pageSize=100")
    assert res.status_code == 200
    data = res.json()
    assert data["items"] == []
    assert data["total"] == 0
    assert data["page"] == 2147483647
    assert data["pageSize"] == 100
    assert data["totalPages"] == 0
