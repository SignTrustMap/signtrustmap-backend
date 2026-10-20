"""
tests.test_offline_tiles — Unit tests for offline PMTiles metadata and HTTP range streaming.
"""
import os
import tempfile
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api.v1.offline_tiles import OFFLINE_PACKS_CONFIG


@pytest.fixture
def client():
    return TestClient(app)


def test_list_offline_map_packs(client):
    response = client.get("/api/v1/spatial/tiles/offline/packs")
    assert response.status_code == 200
    data = response.json()
    assert "packs" in data
    assert "total" in data
    assert data["total"] >= 1

    ids = [p["id"] for p in data["packs"]]
    assert "vietnam-osm" in ids

    pack = next(p for p in data["packs"] if p["id"] == "vietnam-osm")
    assert pack["format"] == "pmtiles"
    assert pack["countryCode"] == "VN"
    assert len(pack["bounds"]) == 4
    assert pack["downloadUrl"].endswith("/api/v1/spatial/tiles/offline/download/vietnam-osm")


def test_download_offline_pack_not_found(client):
    response = client.get("/api/v1/spatial/tiles/offline/download/non-existent-pack")
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


def test_stream_offline_pack_range_requests(client, monkeypatch):
    # Create a dummy PMTiles file of known size (10,000 bytes)
    dummy_data = b"PMTilesHeader123" + (b"0123456789" * 998) + b"END!"
    assert len(dummy_data) == 10000

    with tempfile.NamedTemporaryFile(suffix=".pmtiles", delete=False) as tf:
        tf.write(dummy_data)
        tf_path = tf.name

    try:
        from app.api.v1 import offline_tiles
        monkeypatch.setattr(offline_tiles, "resolve_pmtiles_path", lambda fname: tf_path)

        # 1. Full download (No Range Header)
        res_full = client.get("/api/v1/spatial/tiles/offline/download/vietnam-osm")
        assert res_full.status_code == 200
        assert res_full.headers["accept-ranges"] == "bytes"
        assert res_full.headers["content-length"] == "10000"
        assert res_full.content == dummy_data

        # 2. Partial Content: bytes=0-15 (First 16 bytes)
        res_p1 = client.get(
            "/api/v1/spatial/tiles/offline/download/vietnam-osm",
            headers={"Range": "bytes=0-15"},
        )
        assert res_p1.status_code == 206
        assert res_p1.headers["content-range"] == "bytes 0-15/10000"
        assert res_p1.headers["content-length"] == "16"
        assert res_p1.content == b"PMTilesHeader123"

        # 3. Partial Content: bytes=9996-9999 (Last 4 bytes)
        res_p2 = client.get(
            "/api/v1/spatial/tiles/offline/download/vietnam-osm",
            headers={"Range": "bytes=9996-9999"},
        )
        assert res_p2.status_code == 206
        assert res_p2.headers["content-range"] == "bytes 9996-9999/10000"
        assert res_p2.content == b"END!"

        # 4. Partial Content: suffix range bytes=-4
        res_p3 = client.get(
            "/api/v1/spatial/tiles/offline/download/vietnam-osm",
            headers={"Range": "bytes=-4"},
        )
        assert res_p3.status_code == 206
        assert res_p3.headers["content-range"] == "bytes 9996-9999/10000"
        assert res_p3.content == b"END!"

        # 5. Direct .pmtiles alias URL
        res_alias = client.get(
            "/api/v1/spatial/tiles/offline/osm.pmtiles",
            headers={"Range": "bytes=0-15"},
        )
        assert res_alias.status_code == 206
        assert res_alias.content == b"PMTilesHeader123"

        # 6. Invalid / Out of bounds range
        res_invalid = client.get(
            "/api/v1/spatial/tiles/offline/download/vietnam-osm",
            headers={"Range": "bytes=20000-30000"},
        )
        assert res_invalid.status_code == 416
        assert "bytes */10000" in res_invalid.headers["content-range"]

    finally:
        if os.path.exists(tf_path):
            os.unlink(tf_path)
