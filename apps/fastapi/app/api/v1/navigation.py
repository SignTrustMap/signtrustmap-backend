"""app.api.v1.navigation -- Smart Navigation WebSocket + Session REST (Flow 7)."""
from __future__ import annotations
import json
import logging
from typing import Any
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Path, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import text as sa_text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from app.config import settings
from app.database import AsyncSessionLocal, get_db
from app.schemas.spatial import (
    CreateSessionRequest,
    NavigationAlertMessage,
    NavigationErrorMessage,
    NavigationPointPayload,
    NavigationSignAlertItem,
    PaginatedSessionsResponse,
    SessionResponse,
    UpdateSessionRequest,
)
logger = logging.getLogger(__name__)
router = APIRouter()
_NEARBY = sa_text(
    "SELECT id, sign_type_id, ST_X(location::geometry) AS longitude, "
    "ST_Y(location::geometry) AS latitude, traffic_direction, sign_crop_url "
    "FROM verified_traffic_signs "
    "WHERE ST_DWithin(location::geography, "
    "      ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography, :radius_m) "
    "  AND status = 'ACTIVE' "
    "  AND (traffic_direction IS NULL OR "
    "       ABS(MOD(CAST(traffic_direction - :heading + 180.0 + 360.0 AS numeric), 360.0) - 180.0) <= :heading_threshold)"
)
_INS_PT = sa_text(
    "INSERT INTO navigation_route_points (session_id, sequence_no, location) "
    "VALUES (:session_id, :sequence_no, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326))"
)
_INS_ALERT = sa_text(
    "INSERT INTO navigation_sign_alerts (session_id, verified_sign_id, alert_type) "
    "VALUES (:session_id, :sign_id, 'VOICE') ON CONFLICT DO NOTHING"
)
_INS_SESSION = sa_text(
    "INSERT INTO navigation_sessions (driver_id, origin, destination) "
    "VALUES (:driver_id, "
    "        ST_SetSRID(ST_MakePoint(:origin_lon, :origin_lat), 4326), "
    "        ST_SetSRID(ST_MakePoint(:dest_lon, :dest_lat), 4326)) "
    "RETURNING id, driver_id, status, started_at, ended_at, "
    "  ST_X(origin::geometry) AS origin_longitude, "
    "  ST_Y(origin::geometry) AS origin_latitude, "
    "  ST_X(destination::geometry) AS destination_longitude, "
    "  ST_Y(destination::geometry) AS destination_latitude"
)
_UPDATE_SESSION = sa_text(
    "UPDATE navigation_sessions "
    "SET status = CAST(:status AS nav_session_status), ended_at = NOW() "
    "WHERE id = CAST(:id AS uuid) AND status = 'ACTIVE' "
    "RETURNING id, driver_id, status, started_at, ended_at, "
    "  ST_X(origin::geometry) AS origin_longitude, "
    "  ST_Y(origin::geometry) AS origin_latitude, "
    "  ST_X(destination::geometry) AS destination_longitude, "
    "  ST_Y(destination::geometry) AS destination_latitude"
)
def _row_to_session_response(row: Any) -> SessionResponse:
    return SessionResponse(
        id=row["id"],
        driver_id=row["driver_id"],
        status=row["status"],
        started_at=row["started_at"],
        ended_at=row["ended_at"],
        origin_latitude=float(row["origin_latitude"]),
        origin_longitude=float(row["origin_longitude"]),
        destination_latitude=float(row["destination_latitude"]),
        destination_longitude=float(row["destination_longitude"]),
    )
@router.post(
    "/navigation/sessions",
    response_model=SessionResponse,
    status_code=201,
    summary="Start a navigation session",
    description="Creates navigation_sessions row with PostGIS Points (SRID 4326). Returned id is used as sessionId in WS ticks.",
)
async def create_navigation_session(
    body: CreateSessionRequest,
    db: AsyncSession = Depends(get_db),
) -> SessionResponse:
    try:
        result = await db.execute(
            _INS_SESSION,
            {
                "driver_id": str(body.driver_id),
                "origin_lon": body.origin_longitude,
                "origin_lat": body.origin_latitude,
                "dest_lon": body.destination_longitude,
                "dest_lat": body.destination_latitude,
            },
        )
        # Read the row from RETURNING clause BEFORE committing or consuming
        # the cursor again — a CursorResult can only be iterated once.
        row = result.mappings().first()
        await db.commit()
        # Fire-and-forget credit deduction via NestJS internal endpoint
        try:
            import os as _os2
            import httpx as _httpx2
            base = _os2.environ.get("NESTJS_INTERNAL_URL") or _os2.environ.get("NESTJS_URL") or "http://nestjs:3000"
            tok = _os2.environ.get("INTERNAL_API_TOKEN", "")
            fee = 1
            try:
                fee_rows = await db.execute(sa_text("SELECT value FROM system_parameters WHERE key = 'navigation_credit_fee' LIMIT 1"))
                fr = fee_rows.mappings().first()
                if fr and fr["value"]:
                    fee = int(float(fr["value"]))
            except Exception:
                pass
            _sid = str(row["id"]) if row else "unknown"
            url = base.rstrip("/") + "/api/v1/wallet/internal/deduct"
            hdr = {"x-internal-token": tok} if tok else {}
            try:
                async with _httpx2.AsyncClient(timeout=4.0) as _cli:
                    _resp = await _cli.post(url, json={"userId": str(body.driver_id), "amount": fee, "referenceType": "navigation_session", "referenceId": _sid, "description": "Navigation session fee"}, headers=hdr)
                    if _resp.status_code not in (200, 201):
                        logger.warning("[nav] deduct %s: %s", _resp.status_code, _resp.text[:300])
            except Exception as _e:
                logger.warning("[nav] deduct failed: %s", _e)
        except Exception as _outer:
            logger.warning("[nav] deduct hook error: %s", _outer)
    except IntegrityError as exc:
        await db.rollback()
        # asyncpg ForeignKeyViolationError wrapped as IntegrityError
        msg = str(exc.orig) if hasattr(exc, "orig") and exc.orig else str(exc)
        if "navigation_sessions_driver_id_fkey" in msg or "is not present in table \"users\"" in msg:
            logger.warning("create_navigation_session: driver_id %s not found", body.driver_id)
            raise HTTPException(
                status_code=422,
                detail=f"Driver {body.driver_id} not found. Insert that user into users table first, or use an existing users.id. Detail: {msg}",
            )
        logger.exception("Failed to create navigation session (IntegrityError)")
        raise HTTPException(status_code=400, detail=f"Could not create session: {exc}")
    except Exception as exc:
        await db.rollback()
        logger.exception("Failed to create navigation session")
        raise HTTPException(status_code=400, detail=f"Could not create session: {exc}")
    if row is None:
        raise HTTPException(status_code=500, detail="Session creation returned no row")
    return _row_to_session_response(row)
_LIST_SESSIONS = sa_text(
    "SELECT id, driver_id, status, started_at, ended_at, "
    "  ST_X(origin::geometry) AS origin_longitude, "
    "  ST_Y(origin::geometry) AS origin_latitude, "
    "  ST_X(destination::geometry) AS destination_longitude, "
    "  ST_Y(destination::geometry) AS destination_latitude "
    "FROM navigation_sessions "
    "WHERE driver_id = CAST(:driver_id AS uuid) "
    "ORDER BY started_at DESC LIMIT :limit OFFSET :offset"
)
_COUNT_SESSIONS = sa_text("SELECT COUNT(*) AS cnt FROM navigation_sessions WHERE driver_id = CAST(:driver_id AS uuid)")
_GET_SESSION = sa_text(
    "SELECT id, driver_id, status, started_at, ended_at, "
    "  ST_X(origin::geometry) AS origin_longitude, "
    "  ST_Y(origin::geometry) AS origin_latitude, "
    "  ST_X(destination::geometry) AS destination_longitude, "
    "  ST_Y(destination::geometry) AS destination_latitude "
    "FROM navigation_sessions WHERE id = CAST(:id AS uuid)"
)
@router.get(
    "/navigation/sessions/me",
    response_model=PaginatedSessionsResponse,
    summary="List my navigation sessions (paginated)",
)
async def list_my_sessions(
    driver_id: UUID = Query(..., description="UUID of the Driver user (users.id)"),
    page: int = Query(default=1, ge=1, le=2147483647, description="Page number (1-based)"),
    pageSize: int = Query(default=20, ge=1, le=100, description="Page size (1 to 100)"),
    db: AsyncSession = Depends(get_db),
) -> PaginatedSessionsResponse:
    p2 = max(1, page)
    ps2 = min(max(1, pageSize), 100)
    try:
        tr = await db.execute(_COUNT_SESSIONS, {"driver_id": str(driver_id)})
        tot = tr.mappings().first()
        total = tot["cnt"] if tot else 0
        offset = (p2 - 1) * ps2
        if total == 0 or offset >= total:
            rows = []
        else:
            res = await db.execute(_LIST_SESSIONS, {"driver_id": str(driver_id), "limit": ps2, "offset": offset})
            rows = res.mappings().all()
        items = [_row_to_session_response(r) for r in rows]
        total_pages = (total + ps2 - 1) // ps2 if ps2 else 0
        return PaginatedSessionsResponse(
            items=items,
            total=total,
            page=p2,
            pageSize=ps2,
            totalPages=total_pages,
        )
    except Exception as exc:
        logger.exception("Failed to list navigation sessions for driver %s", driver_id)
        raise HTTPException(status_code=400, detail=f"Could not list navigation sessions: {exc}")


@router.get(
    "/navigation/sessions/{session_id}",
    response_model=SessionResponse,
    summary="Get a single navigation session by id",
)
async def get_navigation_session(
    session_id: UUID = Path(..., description="Navigation session UUID"),
    db: AsyncSession = Depends(get_db),
) -> SessionResponse:
    try:
        res = await db.execute(_GET_SESSION, {"id": str(session_id)})
        row = res.mappings().first()
        if row is None:
            raise HTTPException(status_code=404, detail=f"Session {session_id} not found")
        return _row_to_session_response(row)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to get session %s", session_id)
        raise HTTPException(status_code=400, detail=f"Could not get session: {exc}")


@router.patch(
    "/navigation/sessions/{session_id}",
    response_model=SessionResponse,
    summary="End a navigation session (COMPLETED or CANCELED)",
    description="Transitions ACTIVE session to terminal state and sets ended_at=NOW(). 404 if not found or already terminal.",
)
async def update_navigation_session(
    session_id: UUID = Path(..., description="Navigation session UUID"),
    body: UpdateSessionRequest = ...,
    db: AsyncSession = Depends(get_db),
) -> SessionResponse:
    try:
        result = await db.execute(_UPDATE_SESSION, {"id": str(session_id), "status": body.status})
        await db.commit()
        row = result.mappings().first()
        if row is None:
            raise HTTPException(status_code=404, detail=f"Session {session_id} not found or already terminal.")
        return _row_to_session_response(row)
    except HTTPException:
        raise
    except Exception as exc:
        await db.rollback()
        logger.exception("Failed to update session %s", session_id)
        raise HTTPException(status_code=400, detail=f"Could not update session: {exc}")
@router.websocket("/navigation/stream")

async def navigation_stream(websocket: WebSocket) -> None:
    await websocket.accept()
    logger.info("[WS] Navigation client connected: %s", websocket.client)
    route_buffer: list[dict[str, Any]] = []
    seq: int = 0
    alerted: set[str] = set()
    buf_size: int = settings.NAVIGATION_ROUTE_POINT_BUFFER_SIZE
    radius_m: int = settings.NAVIGATION_SEARCH_RADIUS_M
    h_thr: float = settings.NAVIGATION_HEADING_THRESHOLD_DEG
    async def flush(db: AsyncSession) -> None:
        if not route_buffer:
            return
        try:
            await db.execute(_INS_PT, route_buffer)
            await db.commit()
        except Exception:
            await db.rollback()
            logger.exception("[WS] flush failed")
        finally:
            route_buffer.clear()
    async with AsyncSessionLocal() as db:
        try:
            while True:
                try:
                    raw = await websocket.receive_text()
                except WebSocketDisconnect:
                    logger.info("[WS] Client disconnected normally")
                    break
                try:
                    payload = NavigationPointPayload.model_validate(json.loads(raw))
                except Exception as exc:
                    err = NavigationErrorMessage(message=f"Invalid payload: {exc}")
                    await websocket.send_json(err.model_dump(by_alias=True, exclude_none=True))
                    continue
                lat = payload.latitude
                lon = payload.longitude
                heading = payload.heading
                sid = payload.session_id
                if sid is not None:
                    seq += 1
                    route_buffer.append({"session_id": str(sid), "sequence_no": seq, "lat": lat, "lon": lon})
                    if len(route_buffer) >= buf_size:
                        await flush(db)
                try:
                    res = await db.execute(
                        _NEARBY,
                        {"lat": lat, "lon": lon, "heading": heading, "radius_m": radius_m, "heading_threshold": h_thr},
                    )
                    rows = res.mappings().all()
                except Exception:
                    logger.exception("[WS] spatial query failed")
                    await websocket.send_json(
                        NavigationErrorMessage(message="Spatial query error").model_dump(by_alias=True, exclude_none=True)
                    )
                    continue
                new_alerts: list[NavigationSignAlertItem] = []
                for row in rows:
                    sid_str = str(row["id"])
                    if sid_str in alerted:
                        continue
                    alerted.add(sid_str)
                    new_alerts.append(NavigationSignAlertItem.model_validate(dict(row)))
                    if sid is not None:
                        try:
                            await db.execute(_INS_ALERT, {"session_id": str(sid), "sign_id": sid_str})
                        except Exception:
                            logger.warning("[WS] Could not persist alert %s", sid_str)
                if sid is not None and new_alerts:
                    try:
                        await db.commit()
                    except Exception:
                        await db.rollback()
                msg = NavigationAlertMessage(latitude=lat, longitude=lon, heading=heading, alerts=new_alerts)
                await websocket.send_json(msg.model_dump(by_alias=True, exclude_none=True))
        except WebSocketDisconnect:
            logger.info("[WS] outer disconnect")
        except Exception:
            logger.exception("[WS] Unexpected error")
        finally:
            await flush(db)
            logger.info("[WS] Closed -- alerted %d unique signs", len(alerted))
