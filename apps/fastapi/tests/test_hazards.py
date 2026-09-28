from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from app.tasks.hazards import task_decay_hazard_events


class HazardDecaySweeperTests(unittest.TestCase):
    @patch("app.tasks.hazards.get_sync_db")
    def test_decay_sweeper_transitions_expired_and_dismissed_hazards(
        self, mock_get_db: MagicMock
    ) -> None:
        db = MagicMock()
        mock_get_db.return_value.__enter__.return_value = db

        mock_result = MagicMock()
        mock_result.mappings().all.return_value = [
            {"id": "hazard-uuid-1", "hazard_type": "SPEED_CHECK", "status": "DISMISSED"},
            {"id": "hazard-uuid-2", "hazard_type": "OBSTACLE", "status": "DISMISSED"},
        ]
        db.execute.return_value = mock_result

        result = task_decay_hazard_events()

        self.assertEqual(result["swept"], 2)
        self.assertEqual(result["swept_ids"], ["hazard-uuid-1", "hazard-uuid-2"])
        self.assertIn("completed_at", result)
        db.commit.assert_called_once()

    @patch("app.tasks.hazards.get_sync_db")
    def test_decay_sweeper_when_no_hazards_need_decay(
        self, mock_get_db: MagicMock
    ) -> None:
        db = MagicMock()
        mock_get_db.return_value.__enter__.return_value = db

        mock_result = MagicMock()
        mock_result.mappings().all.return_value = []
        db.execute.return_value = mock_result

        result = task_decay_hazard_events()

        self.assertEqual(result["swept"], 0)
        self.assertEqual(result["swept_ids"], [])
        self.assertIn("completed_at", result)
        db.commit.assert_called_once()
