"""
app.api.v1.catalog — Catalog AI-label sync endpoints (Scenario #4).

Used by NestJS after staff/admin approve a missing-type report and create a
new TrafficSignType: the CLIP label map is rebuilt so the AI classifier can
immediately resolve the new sign code.

  POST /catalog/sync      Dispatch a CLIP label cache rebuild (Celery task).
  GET  /catalog/labels    Read the current label map (cache-first fallback).
"""
from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, Header, HTTPException

from app.celery_app import celery_app
from app.config import settings
from app.tasks.catalog_sync import load_catalog_labels

logger = logging.getLogger(__name__)
router = APIRouter()

_SYNC_TASK = "app.tasks.catalog_sync.task_sync_catalog_labels"


def _authorize(x_internal_token: str | None) -> None:
    if not settings.INTERNAL_API_TOKEN:
        return
    if not x_internal_token or x_internal_token != settings.INTERNAL_API_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid or missing X-Internal-Token")


@router.post("/sync", summary="Rebuild CLIP label cache", tags=["Catalog Sync"])
async def catalog_sync(
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict:
    """Dispatch a Celery task that reloads traffic_sign_types + CLIP prompts into Redis."""
    _authorize(x_internal_token)
    async_result = celery_app.send_task(_SYNC_TASK, kwargs={"trigger": "catalog_mutation"})
    return {"synced": True, "task_id": async_result.id}


@router.get("/labels", summary="Read current CLIP label map", tags=["Catalog Sync"])
async def catalog_labels(
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> dict[str, Any]:
    """Return the label map from cache when possible; otherwise read the DB directly."""
    _authorize(x_internal_token)
    try:
        import redis
        client = redis.Redis.from_url(settings.REDIS_URL)
        raw = client.get("stm:clip:labels")
        client.close()
        if raw:
            return json.loads(raw)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("[catalog-sync] redis read failed: %s", exc)
    return load_catalog_labels()