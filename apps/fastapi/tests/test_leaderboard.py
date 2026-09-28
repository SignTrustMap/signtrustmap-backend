from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from app.tasks.leaderboard import task_refresh_community_leaderboard


class LeaderboardTaskTests(unittest.TestCase):
    @patch("app.tasks.leaderboard.sync_engine.connect")
    def test_refresh_community_leaderboard_success(self, mock_connect: MagicMock) -> None:
        mock_conn = MagicMock()
        mock_connect.return_value.execution_options.return_value.__enter__.return_value = mock_conn

        result = task_refresh_community_leaderboard.apply().get()

        self.assertIn("refreshed_at", result)
        self.assertIn("elapsed_ms", result)
        mock_conn.execute.assert_called_once()
        sql_arg = str(mock_conn.execute.call_args[0][0])
        self.assertIn("REFRESH MATERIALIZED VIEW CONCURRENTLY mv_community_leaderboard", sql_arg)

    @patch("app.tasks.leaderboard.sync_engine.connect")
    def test_refresh_community_leaderboard_retry_on_failure(self, mock_connect: MagicMock) -> None:
        mock_connect.side_effect = Exception("Database lock contention")

        with self.assertRaises(Exception):
            task_refresh_community_leaderboard.apply().get()
