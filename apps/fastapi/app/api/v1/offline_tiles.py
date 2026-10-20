"""
app.api.v1.offline_tiles — Offline PMTiles Map Pack Management and Streaming.

Allows clients (mobile app, web) to:
1. List available offline PMTiles map packs with metadata (size, bbox, zooms, version).
2. Download or stream .pmtiles archives using HTTP Range requests (206 Partial Content),
   compatible with MapLibre PMTiles protocol adapters and resumable download managers.
"""
from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timezone
from typing import Generator

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import StreamingResponse

from app.config import settings
from app.schemas.spatial import OfflineMapPack, OfflineMapPacksResponse

logger = logging.getLogger(__name__)
router = APIRouter()

OFFLINE_PACKS_CONFIG = {
    "vietnam-osm": {
        "id": "vietnam-osm",
        "name": "Vietnam Base Map",
        "description": "Full vector tile archive of Vietnam OpenStreetMap for offline driving navigation and sign detection.",
        "region": "Vietnam",
        "country_code": "VN",
        "format": "pmtiles",
        "file_name": "osm.pmtiles",
        "min_zoom": 0,
        "max_zoom": 15,
        "bounds": [102.14, 8.18, 109.46, 23.39],
    },
    "vietnam-osm-gzip": {
        "id": "vietnam-osm-gzip",
        "name": "Vietnam Base Map (Gzip Compressed)",
        "description": "Full vector tile archive of Vietnam with gzip compression for low-bandwidth transmission.",
        "region": "Vietnam",
        "country_code": "VN",
        "format": "pmtiles",
        "file_name": "osm-gzip.pmtiles",
        "min_zoom": 0,
        "max_zoom": 15,
        "bounds": [102.14, 8.18, 109.46, 23.39],
    },
}

ALIAS_MAP = {
    "vietnam": "vietnam-osm",
    "osm": "vietnam-osm",
    "default": "vietnam-osm",
    "vietnam-osm.pmtiles": "vietnam-osm",
    "osm.pmtiles": "vietnam-osm",
    "vietnam-osm-gzip.pmtiles": "vietnam-osm-gzip",
    "osm-gzip.pmtiles": "vietnam-osm-gzip",
    "osm-gzip": "vietnam-osm-gzip",
}


def resolve_pmtiles_path(file_name: str) -> str | None:
    """Resolve absolute path to a PMTiles archive on the host or in docker volume."""
    candidates = [
        os.path.join(settings.PMTILES_DATA_DIR, file_name),
        os.path.join("/data/pmtiles", file_name),
        os.path.join("/data", file_name),
        os.path.join(os.getcwd(), "pmtiles", file_name),
        os.path.join(os.getcwd(), "..", "pmtiles", file_name),
        os.path.join(os.getcwd(), "..", "..", "pmtiles", file_name),
        os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "..", "pmtiles", file_name),
        os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "pmtiles", file_name),
        os.path.join(os.path.dirname(__file__), "..", "..", "..", "pmtiles", file_name),
    ]
    for c in candidates:
        abs_c = os.path.abspath(c)
        if os.path.isfile(abs_c):
            return abs_c
    return None


@router.get(
    "/tiles/offline/packs",
    response_model=OfflineMapPacksResponse,
    summary="List available offline PMTiles map packs",
    tags=["Offline Maps"],
)
async def list_offline_map_packs(request: Request) -> OfflineMapPacksResponse:
    """Return catalog of downloadable offline PMTiles archives with size and boundaries."""
    packs: list[OfflineMapPack] = []
    base_url = str(request.base_url).rstrip("/")
    for pack_id, conf in OFFLINE_PACKS_CONFIG.items():
        file_name = conf["file_name"]
        file_path = resolve_pmtiles_path(file_name)
        is_available = file_path is not None
        if is_available and file_path:
            size_bytes = os.path.getsize(file_path)
            mtime = os.path.getmtime(file_path)
            last_modified = datetime.fromtimestamp(mtime, tz=timezone.utc)
        else:
            # Fallback metadata when assets are not cloned in lightweight environments
            size_bytes = 419583237 if "gzip" not in pack_id else 445931589
            last_modified = None

        size_mb = round(size_bytes / (1024 * 1024), 2)
        download_url = f"{base_url}/api/v1/spatial/tiles/offline/download/{pack_id}"

        packs.append(
            OfflineMapPack(
                id=conf["id"],
                name=conf["name"],
                description=conf["description"],
                region=conf["region"],
                country_code=conf["country_code"],
                format=conf["format"],
                file_name=conf["file_name"],
                size_bytes=size_bytes,
                size_mb=size_mb,
                min_zoom=conf["min_zoom"],
                max_zoom=conf["max_zoom"],
                bounds=conf["bounds"],
                is_available=is_available,
                last_modified=last_modified,
                download_url=download_url,
            )
        )

    return OfflineMapPacksResponse(packs=packs, total=len(packs))


def serve_ranged_file(
    file_path: str,
    request: Request,
    download_filename: str,
    media_type: str = "application/vnd.pmtiles",
) -> StreamingResponse:
    """Stream file with support for RFC 7233 HTTP Range requests (206 Partial Content)."""
    file_size = os.path.getsize(file_path)
    range_header = request.headers.get("range")

    headers = {
        "Accept-Ranges": "bytes",
        "Content-Disposition": f'attachment; filename="{download_filename}"',
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Range, Content-Range, Content-Type, Accept",
        "Access-Control-Expose-Headers": "Content-Range, Accept-Ranges, Content-Length",
    }

    if not range_header:
        headers["Content-Length"] = str(file_size)

        def iter_file() -> Generator[bytes, None, None]:
            with open(file_path, "rb") as f:
                while chunk := f.read(1024 * 1024):
                    yield chunk

        return StreamingResponse(
            iter_file(),
            status_code=status.HTTP_200_OK,
            headers=headers,
            media_type=media_type,
        )

    # Parse Range: bytes=start-end
    match = re.match(r"^bytes=(\d*)-(\d*)$", range_header.strip())
    if not match:
        raise HTTPException(
            status_code=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE,
            headers={"Content-Range": f"bytes */{file_size}"},
            detail="Invalid HTTP Range specification",
        )

    start_str, end_str = match.groups()
    if start_str and end_str:
        start = int(start_str)
        end = int(end_str)
    elif start_str:
        start = int(start_str)
        end = file_size - 1
    elif end_str:
        start = file_size - int(end_str)
        end = file_size - 1
    else:
        raise HTTPException(
            status_code=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE,
            headers={"Content-Range": f"bytes */{file_size}"},
            detail="Invalid HTTP Range specification",
        )

    if start < 0 or start >= file_size or end < start or end >= file_size:
        raise HTTPException(
            status_code=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE,
            headers={"Content-Range": f"bytes */{file_size}"},
            detail="Range not satisfiable",
        )

    content_length = end - start + 1
    headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"
    headers["Content-Length"] = str(content_length)

    def iter_range() -> Generator[bytes, None, None]:
        with open(file_path, "rb") as f:
            f.seek(start)
            remaining = content_length
            chunk_size = 1024 * 1024
            while remaining > 0:
                to_read = min(remaining, chunk_size)
                data = f.read(to_read)
                if not data:
                    break
                remaining -= len(data)
                yield data

    return StreamingResponse(
        iter_range(),
        status_code=status.HTTP_206_PARTIAL_CONTENT,
        headers=headers,
        media_type=media_type,
    )


def _get_resolved_pack_path(pack_id: str) -> tuple[str, str]:
    target_id = ALIAS_MAP.get(pack_id.lower(), pack_id.lower())
    if target_id not in OFFLINE_PACKS_CONFIG:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Offline map pack '{pack_id}' not found.",
        )

    conf = OFFLINE_PACKS_CONFIG[target_id]
    file_path = resolve_pmtiles_path(conf["file_name"])
    if not file_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"PMTiles archive '{conf['file_name']}' is not available on the server.",
        )
    return file_path, conf["file_name"]


@router.get(
    "/tiles/offline/download/{pack_id}",
    summary="Download or stream an offline PMTiles map pack archive",
    tags=["Offline Maps"],
)
async def download_offline_map_pack(pack_id: str, request: Request) -> StreamingResponse:
    file_path, file_name = _get_resolved_pack_path(pack_id)
    return serve_ranged_file(file_path, request, download_filename=file_name)


@router.get(
    "/tiles/offline/{pack_id}.pmtiles",
    summary="Stream PMTiles file directly with .pmtiles extension",
    tags=["Offline Maps"],
)
async def get_offline_pmtiles_file(pack_id: str, request: Request) -> StreamingResponse:
    file_path, file_name = _get_resolved_pack_path(pack_id)
    return serve_ranged_file(file_path, request, download_filename=file_name)
