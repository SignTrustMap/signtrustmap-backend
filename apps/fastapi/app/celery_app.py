"""
app.celery_app — Celery application factory for SignTrustMap (Phase 4).

Centralises broker/backend config, queue definitions, task routing, and
the Celery Beat periodic schedule.  All task modules listed in ``include``
are imported at start-up so the worker discovers their ``@shared_task``
decorators even when Beat sends a tick.

Launch commands (see docker-compose.yml)::

    # Worker — listens on all four queues (default, freshness, leaderboard, ai_pipeline)
    celery -A app.celery_app worker --loglevel=info --concurrency=4 --queues=default,freshness,leaderboard,ai_pipeline

    # Beat — periodic scheduler (single replica)
    celery -A app.celery_app beat --loglevel=info

Queue responsibilities
---------------------
default       General-purpose tasks; Celery fallback.
freshness     Flow 8 — Freshness Monitor (30-min interval).
leaderboard   Flow 11 — mv_community_leaderboard concurrent refresh (15-min interval).
ai_pipeline   Durable submission orchestration backed by the AI inference service.

The broker and backend URLs come from ``app.config.settings`` so that a
single ``.env`` / docker-compose environment controls all services.
"""
from __future__ import annotations

from celery import Celery
from celery.schedules import crontab
from kombu import Queue

from app.config import settings

# ---------------------------------------------------------------------------
# Application instance
# ---------------------------------------------------------------------------
celery_app = Celery("stm_worker")

celery_app.conf.update(
    broker_url=settings.CELERY_BROKER_URL,
    result_backend=settings.CELERY_RESULT_BACKEND,
    # Serialisation — JSON is sufficient for all current payloads.
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    # ------------------------------------------------------------------
    # Queues & routing — each task family is pinned to its own queue so
    # long-running AI jobs never starve the lightweight monitor tasks.
    # ------------------------------------------------------------------
    task_queues=(
        Queue("default"),
        Queue("freshness"),
        Queue("leaderboard"),
        Queue("ai_pipeline"),
    ),
    task_default_queue="default",
    task_routes={
        "app.tasks.freshness.*": {"queue": "freshness"},
        "app.tasks.leaderboard.*": {"queue": "leaderboard"},
        "app.tasks.ai_pipeline.*": {"queue": "ai_pipeline"},
        "app.tasks.catalog_sync.*": {"queue": "default"},
        "app.tasks.daily_tasks.*": {"queue": "default"},
        "app.tasks.hazards.*": {"queue": "default"},
    },
    # Reliability — acknowledge late so a crashing worker re-queues the task.
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    # Keep results for 24 hours (enough for dashboard polling).
    result_expires=86400,
    # Explicit imports — ensures Beat can dispatch even before a full scan.
    include=[
        "app.tasks.freshness",
        "app.tasks.leaderboard",
        "app.tasks.ai_pipeline",
        "app.tasks.catalog_sync",
        "app.tasks.daily_tasks",
        "app.tasks.hazards",
    ],
)

# ---------------------------------------------------------------------------
# Celery Beat — periodic schedule
# ---------------------------------------------------------------------------
celery_app.conf.beat_schedule = {
    # Durable handoff from NestJS' QUEUED database state to the Celery broker.
    "dispatch-queued-ai-submissions": {
        "task": "app.tasks.ai_pipeline.task_dispatch_queued_submissions",
        "schedule": 10.0,
        "options": {"queue": "ai_pipeline"},
    },
    # Durable handoff from NestJS' PENDING batch submissions to the Celery broker.
    "dispatch-pending-batch-submissions": {
        "task": "app.tasks.ai_pipeline.task_dispatch_pending_batch_submissions",
        "schedule": 15.0,
        "options": {"queue": "ai_pipeline"},
    },
    # Flow 8 — scans verified_traffic_signs for staleness every 30 minutes.
    "freshness-monitor-every-30min": {
        "task": "app.tasks.freshness.task_check_freshness_and_spawn_revalidations",
        "schedule": crontab(minute="*/30"),
        "options": {"queue": "freshness"},
    },
    # Flow 11 — concurrent refresh of mv_community_leaderboard every 15 minutes.
    "refresh-leaderboard-every-15min": {
        "task": "app.tasks.leaderboard.task_refresh_community_leaderboard",
        "schedule": crontab(minute="*/15"),
        "options": {"queue": "leaderboard"},
    },
    # Midnight UTC rollover — resets unclaimed daily tasks and archives stats.
    "daily-task-midnight-rollover": {
        "task": "app.tasks.daily_tasks.task_daily_task_midnight_rollover",
        "schedule": crontab(minute=0, hour=0),
        "options": {"queue": "default"},
    },
    # Flow 8 & Phase 6 — sweeps expired or dismissed roadside hazards every 5 minutes.
    "hazard-decay-sweeper-every-5min": {
        "task": "app.tasks.hazards.task_decay_hazard_events",
        "schedule": crontab(minute="*/5"),
        "options": {"queue": "default"},
    },
}
