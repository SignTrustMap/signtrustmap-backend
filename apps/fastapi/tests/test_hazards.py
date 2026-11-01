from __future__ import annotations

import unittest

# TEMPORARILY DISABLED: Road hazard functions and tests commented out
# from app.tasks.hazards import task_decay_hazard_events
# 
# @unittest.skip("Roadside hazard functionality temporarily disabled")
# class HazardDecaySweeperTests(unittest.TestCase):
#     @patch("app.tasks.hazards.get_sync_db")
#     def test_decay_sweeper_transitions_expired_and_dismissed_hazards(
#         self, mock_get_db: MagicMock
#     ) -> None:
#         ...

class HazardDecaySweeperTests(unittest.TestCase):
    @unittest.skip("Roadside hazard functionality temporarily disabled")
    def test_placeholder(self) -> None:
        pass
