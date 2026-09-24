"""
app.api.v1.router — Aggregates all Phase 3 FastAPI v1 routes under /api/v1.
"""

from fastapi import APIRouter

from app.api.v1 import catalog, navigation, spatial

api_v1_router = APIRouter(prefix="/api/v1")

# REST: interactive GIS map (Flow 6)
api_v1_router.include_router(spatial.router, prefix="/spatial", tags=["Spatial GIS"])
# WebSocket: smart navigation stream (Flow 7)
api_v1_router.include_router(navigation.router, prefix="/spatial", tags=["Spatial Navigation"])
# Catalog AI-label sync (Scenario #4 — approve-and-create-type)
api_v1_router.include_router(catalog.router, prefix="/catalog", tags=["Catalog Sync"])
