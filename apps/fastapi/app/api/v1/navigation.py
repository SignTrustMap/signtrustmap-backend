"""app.api.v1.navigation -- Smart Navigation WebSocket + Session REST (Flow 7)."""
from __future__ import annotations
import json
import logging
from typing import Any
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Path, Query, WebSocket, WebSocketDisconnect
from geoalchemy2 import Geography, Geometry
from sqlalchemy import (
    BigInteger, Numeric, cast, func, insert, or_, select, update,
    text as sa_text,
)
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from app.config import settings
from app.database import AsyncSessionLocal, get_db
from app.models.spatial import (
    NavigationRoutePoint,
    NavigationSession,
    NavigationSignAlert,
    VerifiedTrafficSign,
)
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


def _nearby_signs_stmt(lon: float, lat: float, heading: float, radius_m: int, heading_threshold: float):
    heading_diff = func.abs(
        func.mod(
            cast(VerifiedTrafficSign.traffic_direction - heading + 180.0 + 360.0, Numeric),
            360.0,
        )
        - 180.0
    )
    return (
        select(
            VerifiedTrafficSign.id,
            VerifiedTrafficSign.sign_type_id,
            func.ST_X(cast(VerifiedTrafficSign.location, Geometry)).label("longitude"),
            func.ST_Y(cast(VerifiedTrafficSign.location, Geometry)).label("latitude"),
            VerifiedTrafficSign.traffic_direction,
            VerifiedTrafficSign.sign_crop_url,
        )
        .where(
            func.ST_DWithin(
                cast(VerifiedTrafficSign.location, Geography),
                cast(func.ST_SetSRID(func.ST_MakePoint(lon, lat), 4326), Geography),
                radius_m,
            ),
            VerifiedTrafficSign.status == "ACTIVE",
            or_(
                VerifiedTrafficSign.traffic_direction.is_(None),
                heading_diff <= heading_threshold,
            ),
        )
    )


def _insert_session_stmt(driver_id: UUID | str, origin_lon: float, origin_lat: float, dest_lon: float, dest_lat: float):
    return (
        insert(NavigationSession)
        .values(
            driver_id=driver_id,
            origin=func.ST_SetSRID(func.ST_MakePoint(origin_lon, origin_lat), 4326),
            destination=func.ST_SetSRID(func.ST_MakePoint(dest_lon, dest_lat), 4326),
        )
        .returning(
            NavigationSession.id,
            NavigationSession.driver_id,
            NavigationSession.status,
            NavigationSession.started_at,
            NavigationSession.ended_at,
            func.ST_X(cast(NavigationSession.origin, Geometry)).label("origin_longitude"),
            func.ST_Y(cast(NavigationSession.origin, Geometry)).label("origin_latitude"),
            func.ST_X(cast(NavigationSession.destination, Geometry)).label("destination_longitude"),
            func.ST_Y(cast(NavigationSession.destination, Geometry)).label("destination_latitude"),
        )
    )


def _update_session_stmt(session_id: UUID, status: str):
    return (
        update(NavigationSession)
        .where(NavigationSession.id == session_id, NavigationSession.status == "ACTIVE")
        .values(status=status, ended_at=func.now())
        .returning(
            NavigationSession.id,
            NavigationSession.driver_id,
            NavigationSession.status,
            NavigationSession.started_at,
            NavigationSession.ended_at,
            func.ST_X(cast(NavigationSession.origin, Geometry)).label("origin_longitude"),
            func.ST_Y(cast(NavigationSession.origin, Geometry)).label("origin_latitude"),
            func.ST_X(cast(NavigationSession.destination, Geometry)).label("destination_longitude"),
            func.ST_Y(cast(NavigationSession.destination, Geometry)).label("destination_latitude"),
        )
    )


def _list_sessions_stmt(driver_id: UUID, limit: int, offset: int):
    return (
        select(
            NavigationSession.id,
            NavigationSession.driver_id,
            NavigationSession.status,
            NavigationSession.started_at,
            NavigationSession.ended_at,
            func.ST_X(cast(NavigationSession.origin, Geometry)).label("origin_longitude"),
            func.ST_Y(cast(NavigationSession.origin, Geometry)).label("origin_latitude"),
            func.ST_X(cast(NavigationSession.destination, Geometry)).label("destination_longitude"),
            func.ST_Y(cast(NavigationSession.destination, Geometry)).label("destination_latitude"),
        )
        .where(NavigationSession.driver_id == driver_id)
        .order_by(NavigationSession.started_at.desc())
        .limit(limit)
        .offset(offset)
    )


def _count_sessions_stmt(driver_id: UUID):
    return select(func.count().label("cnt")).select_from(NavigationSession).where(NavigationSession.driver_id == driver_id)


def _get_session_stmt(session_id: UUID):
    return (
        select(
            NavigationSession.id,
            NavigationSession.driver_id,
            NavigationSession.status,
            NavigationSession.started_at,
            NavigationSession.ended_at,
            func.ST_X(cast(NavigationSession.origin, Geometry)).label("origin_longitude"),
            func.ST_Y(cast(NavigationSession.origin, Geometry)).label("origin_latitude"),
            func.ST_X(cast(NavigationSession.destination, Geometry)).label("destination_longitude"),
            func.ST_Y(cast(NavigationSession.destination, Geometry)).label("destination_latitude"),
        )
        .where(NavigationSession.id == session_id)
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
    operation_id="create_navigation_session",
    summary="Start a navigation session",
    description="Creates navigation_sessions row with PostGIS Points (SRID 4326). Returned id is used as sessionId in WS ticks.",
    responses={
        201: {
            "description": "Session created",
            "links": {
                "GetSessionById": {
                    "operationId": "get_navigation_session",
                    "parameters": {"session_id": "$response.body#/id"},
                },
                "UpdateSessionById": {
                    "operationId": "update_navigation_session",
                    "parameters": {"session_id": "$response.body#/id"},
                },
            },
        },
        422: {"description": "Validation error or Driver not found"},
    },
)
async def create_navigation_session(
    body: CreateSessionRequest,
    db: AsyncSession = Depends(get_db),
) -> SessionResponse:
    try:
        result = await db.execute(
            _insert_session_stmt(
                body.driver_id,
                body.origin_longitude,
                body.origin_latitude,
                body.destination_longitude,
                body.destination_latitude,
            )
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
                from sqlalchemy import text as sa_text
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
        tr = await db.execute(_count_sessions_stmt(driver_id))
        tot = tr.mappings().first()
        total = tot["cnt"] if tot else 0
        offset = (p2 - 1) * ps2
        if total == 0 or offset >= total:
            rows = []
        else:
            res = await db.execute(_list_sessions_stmt(driver_id, ps2, offset))
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
    operation_id="get_navigation_session",
    summary="Get a single navigation session by id",
)
async def get_navigation_session(
    session_id: UUID = Path(..., description="Navigation session UUID"),
    db: AsyncSession = Depends(get_db),
) -> SessionResponse:
    try:
        res = await db.execute(_get_session_stmt(session_id))
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
    operation_id="update_navigation_session",
    summary="End a navigation session (COMPLETED or CANCELED)",
    description="Transitions ACTIVE session to terminal state and sets ended_at=NOW(). 404 if not found or already terminal.",
)
async def update_navigation_session(
    session_id: UUID = Path(..., description="Navigation session UUID"),
    body: UpdateSessionRequest = ...,
    db: AsyncSession = Depends(get_db),
) -> SessionResponse:
    try:
        result = await db.execute(_update_session_stmt(session_id, body.status))
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
            ins_points = [
                {
                    "session_id": item["session_id"],
                    "sequence_no": item["sequence_no"],
                    "location": func.ST_SetSRID(func.ST_MakePoint(item["lon"], item["lat"]), 4326),
                }
                for item in route_buffer
            ]
            await db.execute(insert(NavigationRoutePoint), ins_points)
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
                        _nearby_signs_stmt(lon, lat, heading, radius_m, h_thr)
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
                            await db.execute(
                                pg_insert(NavigationSignAlert)
                                .values(session_id=sid, verified_sign_id=UUID(sid_str), alert_type="VOICE")
                                .on_conflict_do_nothing()
                            )
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
