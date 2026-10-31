"""
app.main — SignTrustMap FastAPI (Phase 3: Spatial GIS & Smart Navigation).

Spins up a FastAPI instance with:
  * global ``/api/v1`` prefix (all spatial + navigation routes)
  * an explicit ``/health`` liveness probe (not version-prefixed)
  * CORS (wildcard in development, wired via middleware)
  * an async lifespan hook that cleanly disposes the asyncpg engine on shutdown.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

from app.api.v1.router import api_v1_router
from app.config import settings
from app.database import engine
from app.schemas.spatial import HealthResponse


@asynccontextmanager
async def lifespan(app: FastAPI):  # type: ignore[no-untyped-def]
    """Clean up the async engine when the worker shuts down."""
    yield
    await engine.dispose()


app = FastAPI(
    title="SignTrustMap — FastAPI (Phase 3: Spatial GIS & Smart Navigation)",
    version="1.0.0",
    description=(
        "Phase 3 spatial services for SignTrustMap.  "
        "Flow 6: interactive GIS map (bounding-box sign queries as GeoJSON).  "
        "Flow 7: smart-navigation WebSocket stream (proximity + heading-filtered sign alerts, "
        "route-point buffering, and alert deduplication)."
    ),
    lifespan=lifespan,
)


@app.exception_handler(ValidationError)
async def pydantic_validation_exception_handler(request: Request, exc: ValidationError):
    """Ensure any Pydantic model_validator returns 422 Unprocessable Entity instead of 500."""
    return await request_validation_exception_handler(
        request, RequestValidationError(exc.errors())
    )

# ---------------------------------------------------------------------------
# Global middleware
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
app.include_router(api_v1_router)


# ---------------------------------------------------------------------------
# Non-prefixed health probe (useful for docker-compose healthchecks)
# ---------------------------------------------------------------------------
@app.get(
    "/health",
    response_model=HealthResponse,
    summary="Liveness probe",
    tags=["Health"],
)
async def health() -> dict:  # type: ignore[no-untyped-def]
    return HealthResponse(status="ok", service="stm-fastapi", version="1.0.0", env=settings.APP_ENV).model_dump()


@app.get(
    "/api/v1/health",
    response_model=HealthResponse,
    summary="Liveness probe (version-prefixed)",
    tags=["Health"],
)
async def health_v1() -> dict:  # type: ignore[no-untyped-def]
    return HealthResponse(status="ok", service="stm-fastapi", version="1.0.0", env=settings.APP_ENV).model_dump()
