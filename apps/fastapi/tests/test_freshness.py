from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from app.tasks.freshness import (
    DEFAULT_ROUTE_CLASSES,
    resolve_sign_route_class,
    task_check_freshness_and_spawn_revalidations,
)


class RouteAwareFreshnessTests(unittest.TestCase):
    def test_resolve_sign_route_class_hierarchy(self) -> None:
        classes_by_id = {}
        classes_by_type = DEFAULT_ROUTE_CLASSES

        # 1. Highway classification
        hw_sign = {"road_name": "Cao tốc TP.HCM - Long Thành", "sign_code": "P.102"}
        rc_hw = resolve_sign_route_class(hw_sign, classes_by_id, classes_by_type)
        self.assertEqual(rc_hw["road_type"], "HIGHWAY")
        self.assertEqual(rc_hw["default_lifetime_days"], 180)
        self.assertEqual(rc_hw["revalidation_threshold_days"], 30)

        # 2. Provincial classification
        prov_sign = {"road_name": "Đèo Hải Vân", "sign_code": "W.205"}
        rc_prov = resolve_sign_route_class(prov_sign, classes_by_id, classes_by_type)
        self.assertEqual(rc_prov["road_type"], "PROVINCIAL")
        self.assertEqual(rc_prov["default_lifetime_days"], 90)
        self.assertEqual(rc_prov["revalidation_threshold_days"], 21)

        # 3. Temporary classification
        temp_sign = {"road_name": "Đường Lê Lợi", "category_name": "Biển báo tạm thời", "sign_code": "W.201"}
        rc_temp = resolve_sign_route_class(temp_sign, classes_by_id, classes_by_type)
        self.assertEqual(rc_temp["road_type"], "TEMPORARY")
        self.assertEqual(rc_temp["default_lifetime_days"], 14)
        self.assertEqual(rc_temp["revalidation_threshold_days"], 3)

        # 4. Urban corridor default
        urban_sign = {"road_name": "Đường Nguyễn Huệ", "sign_code": "P.123"}
        rc_urban = resolve_sign_route_class(urban_sign, classes_by_id, classes_by_type)
        self.assertEqual(rc_urban["road_type"], "URBAN")
        self.assertEqual(rc_urban["default_lifetime_days"], 30)
        self.assertEqual(rc_urban["revalidation_threshold_days"], 7)

    @patch("app.tasks.freshness.get_sync_db")
    def test_freshness_worker_spawns_quest_with_urgency_and_bounty(self, mock_get_db: MagicMock) -> None:
        db = MagicMock()
        mock_get_db.return_value.__enter__.return_value = db

        # Mock route classifications
        rc_mappings = MagicMock()
        rc_mappings.all.return_value = [
            {"id": 1, "name": "Urban Corridors / Construction", "road_type": "URBAN", "default_lifetime_days": 30, "revalidation_threshold_days": 7}
        ]

        # Sign with age = 26.5 days (L_max = 30, remaining = 3.5 days <= 7 days)
        # Urgency = 1 - 3.5 / 7 = 0.5
        # Bounty = 20 + floor(0.5 * 100) = 70 credits
        sign_mappings = MagicMock()
        sign_mappings.all.return_value = [
            {
                "sign_id": "sign-uuid-1",
                "last_verified_at": "2026-09-01T00:00:00Z",
                "status": "ACTIVE",
                "freshness_score": 0.9,
                "route_classification_id": 1,
                "road_name": "Đường Lê Lợi",
                "sign_code": "P.102",
                "category_name": "Prohibitory",
                "age_days": 26.5,
            }
        ]

        # No existing task
        existing_task_res = MagicMock()
        existing_task_res.first.return_value = None

        inserted_task = MagicMock()
        inserted_task.first.return_value = {"id": "task-uuid-1"}

        def execute_side_effect(sql: Any, params: Any = None) -> Any:
            sql_str = str(sql)
            res = MagicMock()
            if "FROM route_classifications" in sql_str:
                res.mappings.return_value = rc_mappings
                return res
            if "FROM verified_traffic_signs" in sql_str:
                res.mappings.return_value = sign_mappings
                return res
            if "FROM revalidation_tasks" in sql_str:
                return existing_task_res
            if "INSERT INTO revalidation_tasks" in sql_str:
                res.mappings.return_value = inserted_task
                return res
            return res

        db.execute.side_effect = execute_side_effect

        summary = task_check_freshness_and_spawn_revalidations.apply().get()

        self.assertEqual(summary["scanned"], 1)
        self.assertEqual(summary["spawned"], 1)
        self.assertEqual(summary["delisted"], 0)
        self.assertEqual(summary["errors"], 0)

    @patch("app.tasks.freshness.get_sync_db")
    def test_freshness_worker_delists_expired_sign_and_spawns_quest(self, mock_get_db: MagicMock) -> None:
        db = MagicMock()
        mock_get_db.return_value.__enter__.return_value = db

        rc_mappings = MagicMock()
        rc_mappings.all.return_value = [
            {"id": 1, "name": "Urban Corridors / Construction", "road_type": "URBAN", "default_lifetime_days": 30, "revalidation_threshold_days": 7}
        ]

        # Sign age = 35.0 days (exceeded L_max 30.0) -> delist to INACTIVE and spawn revalidation quest
        sign_mappings = MagicMock()
        sign_mappings.all.return_value = [
            {
                "sign_id": "expired-sign-1",
                "last_verified_at": "2026-08-01T00:00:00Z",
                "status": "ACTIVE",
                "freshness_score": 0.1,
                "route_classification_id": 1,
                "road_name": "Đường Lê Lợi",
                "sign_code": "P.102",
                "category_name": "Prohibitory",
                "age_days": 35.0,
            }
        ]

        existing_task_res = MagicMock()
        existing_task_res.first.return_value = None

        inserted_task = MagicMock()
        inserted_task.first.return_value = {"id": "task-uuid-expired"}

        inserted_params = None

        def execute_side_effect(sql: Any, params: Any = None) -> Any:
            nonlocal inserted_params
            sql_str = str(sql)
            res = MagicMock()
            if "FROM route_classifications" in sql_str:
                res.mappings.return_value = rc_mappings
                return res
            if "FROM verified_traffic_signs" in sql_str:
                res.mappings.return_value = sign_mappings
                return res
            if "FROM revalidation_tasks" in sql_str:
                return existing_task_res
            if "INSERT INTO revalidation_tasks" in sql_str:
                inserted_params = params
                res.mappings.return_value = inserted_task
                return res
            return res

        db.execute.side_effect = execute_side_effect

        summary = task_check_freshness_and_spawn_revalidations.apply().get()

        self.assertEqual(summary["scanned"], 1)
        self.assertEqual(summary["spawned"], 1)
        self.assertEqual(summary["delisted"], 1)
        self.assertEqual(summary["errors"], 0)

        # Verify spawned task properties for expired sign
        self.assertIsNotNone(inserted_params)
        self.assertEqual(inserted_params["priority"], "HIGH")
        self.assertEqual(inserted_params["reward_credits"], 120)
        self.assertEqual(inserted_params["urgency"], 1.0)
        self.assertEqual(inserted_params["remaining_days"], 7)

    @patch("app.tasks.freshness.get_sync_db")
    def test_freshness_worker_expired_sign_with_existing_quest_idempotent(self, mock_get_db: MagicMock) -> None:
        db = MagicMock()
        mock_get_db.return_value.__enter__.return_value = db

        rc_mappings = MagicMock()
        rc_mappings.all.return_value = [
            {"id": 1, "name": "Urban Corridors / Construction", "road_type": "URBAN", "default_lifetime_days": 30, "revalidation_threshold_days": 7}
        ]

        sign_mappings = MagicMock()
        sign_mappings.all.return_value = [
            {
                "sign_id": "expired-sign-2",
                "last_verified_at": "2026-08-01T00:00:00Z",
                "status": "ACTIVE",
                "freshness_score": 0.1,
                "route_classification_id": 1,
                "road_name": "Đường Lê Lợi",
                "sign_code": "P.102",
                "category_name": "Prohibitory",
                "age_days": 35.0,
            }
        ]

        existing_task_res = MagicMock()
        existing_task_res.first.return_value = {"id": "existing-task-uuid"}

        def execute_side_effect(sql: Any, params: Any = None) -> Any:
            sql_str = str(sql)
            res = MagicMock()
            if "FROM route_classifications" in sql_str:
                res.mappings.return_value = rc_mappings
                return res
            if "FROM verified_traffic_signs" in sql_str:
                res.mappings.return_value = sign_mappings
                return res
            if "FROM revalidation_tasks" in sql_str:
                return existing_task_res
            return res

        db.execute.side_effect = execute_side_effect

        summary = task_check_freshness_and_spawn_revalidations.apply().get()

        self.assertEqual(summary["scanned"], 1)
        self.assertEqual(summary["spawned"], 0)
        self.assertEqual(summary["delisted"], 1)
        self.assertEqual(summary["errors"], 0)
