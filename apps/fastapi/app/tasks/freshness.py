"""
app.tasks.freshness — Flow 8 & Phase 5: Route-Aware Freshness & PostGIS Decay Worker.

Scans verified_traffic_signs and applies route-aware decay hierarchy:
  • Urban Corridors / Construction: L_max = 30d, T_reval = 7d, buffer = 15m
  • Provincial Roads & Mountain Passes: L_max = 90d, T_reval = 21d, buffer = 25m
  • National Expressways & Highways: L_max = 180d, T_reval = 30d, buffer = 30m
  • Temporary / Seasonal Speed Alerts: L_max = 14d, T_reval = 3d, buffer = 20m

Dynamic Urgency & Bounty Calculation:
  Urgency = max(0.0, min(1.0, 1.0 - LifetimeRemaining / T_reval))
  Bounty Reward = BaseReward + floor(Urgency * MaxBonus) (Base: 20, MaxBonus: 100)

Delisting Worker:
  When LifetimeRemaining <= 0 (Age >= L_max), sign status transitions to 'INACTIVE',
  freshness_score = 0.0, and a maximum urgency revalidation quest is spawned.

Beat schedule: every 30 minutes via Celery Beat on queue 'freshness'.
"""
from __future__ import annotations

import logging
import math
from datetime import datetime, timezone
from typing import Any

from celery import shared_task
from sqlalchemy import (
    bindparam,
    func,
    insert,
    literal_column,
    select,
    update,
)

from app.db_sync import get_sync_db
from app.models.pipeline import (
    RevalidationTask,
    RouteClassification,
    SignCategory,
    SignLifecycleEvent,
    TrafficSignType,
)
from app.models.spatial import VerifiedTrafficSign

logger = logging.getLogger(__name__)

# Base reward & max bonus parameters according to Section 3.B
BASE_BOUNTY_REWARD = 20
MAX_BOUNTY_BONUS = 100

DEFAULT_ROUTE_CLASSES = {
    "URBAN": {
        "name": "Urban Corridors / Construction",
        "road_type": "URBAN",
        "default_lifetime_days": 30,
        "revalidation_threshold_days": 7,
        "spatial_buffer_meters": 15,
    },
    "PROVINCIAL": {
        "name": "Provincial Roads & Mountain Passes",
        "road_type": "PROVINCIAL",
        "default_lifetime_days": 90,
        "revalidation_threshold_days": 21,
        "spatial_buffer_meters": 25,
    },
    "HIGHWAY": {
        "name": "National Expressways & Highways",
        "road_type": "HIGHWAY",
        "default_lifetime_days": 180,
        "revalidation_threshold_days": 30,
        "spatial_buffer_meters": 30,
    },
    "TEMPORARY": {
        "name": "Temporary / Seasonal Speed Alerts",
        "road_type": "TEMPORARY",
        "default_lifetime_days": 14,
        "revalidation_threshold_days": 3,
        "spatial_buffer_meters": 20,
    },
}

_ROUTE_CLASSES_SQL = select(
    RouteClassification.id,
    RouteClassification.name,
    RouteClassification.road_type,
    RouteClassification.default_lifetime_days,
    RouteClassification.revalidation_threshold_days,
    RouteClassification.spatial_buffer_meters,
)

_CATEGORY_NAME_EXPR = (
    func.coalesce(SignCategory.name_en, "")
    + " "
    + func.coalesce(SignCategory.name_vi, "")
)

_AGE_DAYS_EXPR = (
    func.extract("epoch", func.now() - VerifiedTrafficSign.last_verified_at) / 86400.0
)

_EXISTING_REVAL_TASK_SUBQ = (
    select(1)
    .where(
        (RevalidationTask.verified_sign_id == VerifiedTrafficSign.id)
        & (RevalidationTask.status.in_(["OPEN", "EVALUATING"]))
    )
    .exists()
)

_ACTIVE_SIGNS_SQL = (
    select(
        VerifiedTrafficSign.id.label("sign_id"),
        VerifiedTrafficSign.last_verified_at,
        VerifiedTrafficSign.status,
        VerifiedTrafficSign.freshness_score,
        VerifiedTrafficSign.route_classification_id,
        VerifiedTrafficSign.road_name,
        TrafficSignType.sign_code,
        _CATEGORY_NAME_EXPR.label("category_name"),
        _AGE_DAYS_EXPR.label("age_days"),
    )
    .select_from(VerifiedTrafficSign)
    .join(TrafficSignType, TrafficSignType.id == VerifiedTrafficSign.sign_type_id)
    .outerjoin(SignCategory, SignCategory.id == TrafficSignType.category_id)
    .where(
        VerifiedTrafficSign.status.in_(["ACTIVE", "STALE", "REVALIDATION_REQUIRED"])
        | (
            (VerifiedTrafficSign.status == "INACTIVE")
            & (~_EXISTING_REVAL_TASK_SUBQ)
        )
    )
    .order_by(VerifiedTrafficSign.last_verified_at.asc())
)

_CHECK_EXISTING_TASK_SQL = (
    select(RevalidationTask.id)
    .where(
        (RevalidationTask.verified_sign_id == bindparam("sign_id"))
        & (RevalidationTask.status.in_(["OPEN", "EVALUATING"]))
    )
    .limit(1)
)

_INSERT_TASK_SQL = (
    insert(RevalidationTask)
    .values(
        verified_sign_id=bindparam("sign_id"),
        priority=bindparam("priority"),
        reward_credits=bindparam("reward_credits"),
        urgency=bindparam("urgency"),
        status="OPEN",
        route_classification_id=bindparam("route_class_id"),
        created_at=func.now(),
        expired_at=func.now() + (bindparam("remaining_days") * literal_column("INTERVAL '1 day'")),
    )
    .returning(RevalidationTask.id)
)

_UPDATE_SIGN_STALE_SQL = (
    update(VerifiedTrafficSign)
    .where(VerifiedTrafficSign.id == bindparam("sign_id"))
    .values(
        status="STALE",
        freshness_score=bindparam("freshness_score"),
        updated_at=func.now(),
    )
)

_UPDATE_SIGN_INACTIVE_SQL = (
    update(VerifiedTrafficSign)
    .where(VerifiedTrafficSign.id == bindparam("sign_id"))
    .values(
        status="INACTIVE",
        freshness_score=0.0,
        updated_at=func.now(),
    )
)

_UPDATE_SIGN_SCORE_SQL = (
    update(VerifiedTrafficSign)
    .where(VerifiedTrafficSign.id == bindparam("sign_id"))
    .values(
        freshness_score=bindparam("freshness_score"),
        updated_at=func.now(),
    )
)

_INSERT_LIFECYCLE_EVENT_SQL = (
    insert(SignLifecycleEvent)
    .values(
        verified_sign_id=bindparam("sign_id"),
        event_type=bindparam("event_type"),
        note=bindparam("note"),
        created_at=func.now(),
    )
)


def resolve_sign_route_class(
    sign_row: dict[str, Any],
    classes_by_id: dict[int, dict[str, Any]],
    classes_by_type: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """Resolve route classification hierarchy for a sign based on category, road name, or explicit ID."""
    rc_id = sign_row.get("route_classification_id")
    if rc_id and rc_id in classes_by_id:
        return classes_by_id[rc_id]

    cat_name = str(sign_row.get("category_name") or "").lower()
    sign_code = str(sign_row.get("sign_code") or "").upper()
    if any(k in cat_name for k in ["temporary", "thi công", "tạm"]) or sign_code.startswith("W.227"):
        return classes_by_type.get("TEMPORARY", DEFAULT_ROUTE_CLASSES["TEMPORARY"])

    road_name = str(sign_row.get("road_name") or "").strip().upper()
    if any(h in road_name for h in ["CAO TỐC", "CT", "QL", "HIGHWAY", "EXPRESSWAY"]):
        return classes_by_type.get("HIGHWAY", DEFAULT_ROUTE_CLASSES["HIGHWAY"])

    if any(p in road_name for p in ["ĐT", "TL", "ĐÈO", "PASS", "PROVINCIAL"]):
        return classes_by_type.get("PROVINCIAL", DEFAULT_ROUTE_CLASSES["PROVINCIAL"])

    return classes_by_type.get("URBAN", DEFAULT_ROUTE_CLASSES["URBAN"])


@shared_task(
    name="app.tasks.freshness.task_check_freshness_and_spawn_revalidations",
    bind=True,
    max_retries=3,
    default_retry_delay=120,
    acks_late=True,
)
def task_check_freshness_and_spawn_revalidations(self) -> dict[str, Any]:  # type: ignore[no-untyped-def]
    """
    Flow 8 & Phase 5 — Route-aware sign decay, quest urgency calculation, and automatic delisting.

    Scans active signs, compares Age against route-specific L_max and T_reval, and:
      1. Delists signs exceeding L_max to INACTIVE (freshness_score = 0.0).
      2. Marks signs within T_reval window as STALE, computes Urgency and Bounty, and spawns revalidation_tasks.
      3. Recalculates decaying freshness_score for active signs.
    """
    run_at = datetime.now(timezone.utc)
    logger.info("[freshness] Starting route-aware freshness check at %s", run_at.isoformat())

    scanned = 0
    spawned = 0
    delisted = 0
    errors = 0

    try:
        with get_sync_db() as db:
            # 1. Load route classifications
            classes_by_id: dict[int, dict[str, Any]] = {}
            classes_by_type: dict[str, dict[str, Any]] = {}
            try:
                rc_rows = db.execute(_ROUTE_CLASSES_SQL).mappings().all()
                for r in rc_rows:
                    rc_dict = dict(r)
                    if "id" in rc_dict and rc_dict["id"]:
                        classes_by_id[int(rc_dict["id"])] = rc_dict
                    if "road_type" in rc_dict:
                        classes_by_type[str(rc_dict["road_type"]).upper()] = rc_dict
            except Exception as exc:
                logger.warning("[freshness] route_classifications query failed, using built-in defaults: %s", exc)
                classes_by_type = DEFAULT_ROUTE_CLASSES

            # 2. Fetch signs eligible for evaluation
            rows = db.execute(_ACTIVE_SIGNS_SQL).mappings().all()
            scanned = len(rows)
            logger.info("[freshness] Scanning %d active/stale verified sign(s)", scanned)

            for row in rows:
                sign_id = str(row["sign_id"])
                age_days = float(row["age_days"] or 0.0)

                route_info = resolve_sign_route_class(dict(row), classes_by_id, classes_by_type)
                l_max = int(route_info.get("default_lifetime_days", 30))
                t_reval = int(route_info.get("revalidation_threshold_days", 7))
                route_class_id = route_info.get("id")

                lifetime_remaining = l_max - age_days

                try:
                    # M5.4 Delisting Worker: Age >= L_max (LifetimeRemaining <= 0)
                    if lifetime_remaining <= 0.0:
                        if str(row.get("status") or "").upper() != "INACTIVE":
                            db.execute(_UPDATE_SIGN_INACTIVE_SQL, {"sign_id": sign_id})
                            db.execute(
                                _INSERT_LIFECYCLE_EVENT_SQL,
                                {
                                    "sign_id": sign_id,
                                    "event_type": "AUTO_DELISTED",
                                    "note": f"Delisted to INACTIVE: age={age_days:.1f}d exceeded L_max={l_max}d ({route_info.get('name')}).",
                                },
                            )
                            delisted += 1
                            logger.info("[freshness] Sign %s delisted: age %.1f >= L_max %d", sign_id, age_days, l_max)

                        # Even when lifetime reaches 0, ensure maximum urgency revalidation quest is spawned
                        urgency = 1.0
                        bounty_reward = BASE_BOUNTY_REWARD + MAX_BOUNTY_BONUS
                        priority = "HIGH"
                        remaining_days = max(1, t_reval)
                    elif lifetime_remaining <= t_reval:
                        # M5.3 Revalidation Required & Dynamic Urgency Bounty
                        freshness_score = max(0.0, min(1.0, round(lifetime_remaining / l_max, 4)))
                        urgency = max(0.0, min(1.0, round(1.0 - (lifetime_remaining / t_reval), 4)))
                        bounty_reward = BASE_BOUNTY_REWARD + math.floor(urgency * MAX_BOUNTY_BONUS)
                        priority = "HIGH" if urgency >= 0.7 else ("MEDIUM" if urgency >= 0.3 else "LOW")
                        remaining_days = max(1, int(lifetime_remaining))

                        db.execute(_UPDATE_SIGN_STALE_SQL, {"sign_id": sign_id, "freshness_score": freshness_score})
                    else:
                        # Fresh / Aging sign: update decayed freshness score
                        freshness_score = max(0.0, min(1.0, round(lifetime_remaining / l_max, 4)))
                        db.execute(_UPDATE_SIGN_SCORE_SQL, {"sign_id": sign_id, "freshness_score": freshness_score})
                        db.commit()
                        continue

                    # Ensure revalidation quest exists (for both expired signs and signs within t_reval window)
                    existing_task = db.execute(_CHECK_EXISTING_TASK_SQL, {"sign_id": sign_id}).first()
                    if not existing_task:
                        task_row = db.execute(
                            _INSERT_TASK_SQL,
                            {
                                "sign_id": sign_id,
                                "priority": priority,
                                "reward_credits": bounty_reward,
                                "urgency": urgency,
                                "route_class_id": route_class_id,
                                "remaining_days": remaining_days,
                            },
                        ).mappings().first()

                        task_id = task_row["id"] if task_row else "unknown"
                        db.execute(
                            _INSERT_LIFECYCLE_EVENT_SQL,
                            {
                                "sign_id": sign_id,
                                "event_type": "MARKED_STALE",
                                "note": (
                                    f"Revalidation quest spawned: route={route_info.get('road_type')}, "
                                    f"remaining={lifetime_remaining:.1f}d, urgency={urgency:.2f}, "
                                    f"bounty={bounty_reward}, task={task_id}."
                                ),
                            },
                        )
                        spawned += 1
                        logger.info(
                            "[freshness] Spawned task for sign %s (remaining: %.1f d, urgency: %.2f, bounty: %d)",
                            sign_id,
                            lifetime_remaining,
                            urgency,
                            bounty_reward,
                        )
                    db.commit()

                except Exception as exc:
                    db.rollback()
                    errors += 1
                    logger.exception("[freshness] Failed processing sign %s: %s", sign_id, exc)

    except Exception as exc:
        logger.exception("[freshness] Fatal database error during freshness run: %s", exc)
        raise self.retry(exc=exc)

    summary = {
        "run_at": run_at.isoformat(),
        "scanned": scanned,
        "spawned": spawned,
        "delisted": delisted,
        "errors": errors,
    }
    logger.info("[freshness] Route-aware freshness run complete: %s", summary)
    return summary
