from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from app.tasks.daily_tasks import task_daily_task_midnight_rollover


class DailyTaskRolloverTests(unittest.TestCase):
    @patch("httpx.Client.post")
    def test_daily_task_midnight_rollover_success(self, mock_post: MagicMock) -> None:
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "success": True,
            "rolloverDate": "2026-09-24",
            "resetTasks": 2,
        }
        mock_post.return_value = mock_response

        result = task_daily_task_midnight_rollover.apply().get()

        self.assertTrue(result["success"])
        self.assertEqual(result["resetTasks"], 2)
        mock_post.assert_called_once()
        args, kwargs = mock_post.call_args
        self.assertTrue(args[0].endswith("/api/v1/daily-tasks/internal/rollover"))
        self.assertIn("X-Internal-Token", kwargs["headers"])

    @patch("httpx.Client.post")
    def test_daily_task_midnight_rollover_retry_on_failure(self, mock_post: MagicMock) -> None:
        mock_post.side_effect = Exception("NestJS internal connection timeout")

        with self.assertRaises(Exception):
            task_daily_task_midnight_rollover.apply().get()
