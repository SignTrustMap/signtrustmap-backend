from unittest import TestCase
from unittest.mock import MagicMock, patch

from app.tasks import ai_pipeline


class AiPipelineContractTests(TestCase):
    def test_storage_key_is_split_once(self) -> None:
        self.assertEqual(
            ai_pipeline._parse_storage_key("stm-raw-videos/uploads/user/drive.mp4"),
            ("stm-raw-videos", "uploads/user/drive.mp4"),
        )

    def test_dispatcher_passes_only_submission_and_minio_references(self) -> None:
        media_objects = [{
            "media_type": "VIDEO",
            "bucket": "stm-raw-videos",
            "object_key": "uploads/user/drive.mp4",
        }]
        broker = MagicMock()
        broker.set.return_value = True

        with (
            patch.object(
                ai_pipeline,
                "_load_queued_media",
                return_value={"submission-1": media_objects},
            ),
            patch.object(ai_pipeline, "_broker_client", return_value=broker),
            patch.object(ai_pipeline.task_process_submission_pipeline, "apply_async") as apply_async,
        ):
            result = ai_pipeline.task_dispatch_queued_submissions.run()

        self.assertEqual(result, {"queued": 1, "dispatched": 1})
        apply_async.assert_called_once_with(
            kwargs={"submission_id": "submission-1", "media_objects": media_objects},
            queue="ai_pipeline",
        )

    def test_inference_engine_receives_json_key_payload(self) -> None:
        response = MagicMock()
        response.json.return_value = {
            "submission_id": "submission-1",
            "media_type": "VIDEO",
            "total_frames": 5,
            "signs": [],
        }
        client = MagicMock()
        client.__enter__.return_value.post.return_value = response
        media_objects = [{
            "media_type": "VIDEO",
            "bucket": "stm-raw-videos",
            "object_key": "uploads/user/drive.mp4",
        }]

        with patch.object(ai_pipeline.httpx, "Client", return_value=client):
            result = ai_pipeline._call_inference_engine("submission-1", media_objects)

        client.__enter__.return_value.post.assert_called_once_with(
            "http://localhost:8001/api/v1/inference/submissions/submission-1",
            json={"media_objects": media_objects},
            headers={"X-Internal-Token": "stm_internal_secret_dev"},
        )
        self.assertEqual(result["signs"], [])

    def test_claim_submission_transitions_queued_row(self) -> None:
        db = MagicMock()
        db.execute.return_value.mappings.return_value.first.return_value = {"status": "QUEUED"}

        with patch.object(ai_pipeline, "get_sync_db") as get_sync_db:
            get_sync_db.return_value.__enter__.return_value = db
            status = ai_pipeline._claim_submission("submission-1")

        self.assertEqual(status, "QUEUED")
        db.commit.assert_called_once()

    def test_claim_submission_leaves_already_claimed_row(self) -> None:
        db = MagicMock()
        db.execute.return_value.mappings.return_value.first.return_value = {"status": "SYNCHRONIZING"}

        with patch.object(ai_pipeline, "get_sync_db") as get_sync_db:
            get_sync_db.return_value.__enter__.return_value = db
            status = ai_pipeline._claim_submission("submission-1")

        self.assertEqual(status, "SYNCHRONIZING")
        db.commit.assert_not_called()

    def test_pipeline_skips_duplicate_delivery(self) -> None:
        task = ai_pipeline.task_process_submission_pipeline

        with (
            patch.object(ai_pipeline, "_claim_submission", return_value="SYNCHRONIZING"),
            patch.object(ai_pipeline, "_call_inference_engine") as call_engine,
        ):
            result = task.apply(args=["submission-1", []]).get()

        self.assertEqual(result, {"submission_id": "submission-1", "skipped": True, "reason": "SYNCHRONIZING"})
        call_engine.assert_not_called()

    def test_pipeline_processes_claimed_submission(self) -> None:
        task = ai_pipeline.task_process_submission_pipeline

        with (
            patch.object(ai_pipeline, "_claim_submission", return_value="QUEUED"),
            patch.object(ai_pipeline, "_set_status") as set_status,
            patch.object(
                ai_pipeline,
                "_call_inference_engine",
                return_value={"submission_id": "submission-1", "signs": []},
            ),
            patch.object(ai_pipeline, "_persist_candidates", return_value=(0, 0)),
            patch.object(ai_pipeline, "_clear_dispatch_lock"),
        ):
            result = task.apply(args=["submission-1", []]).get()

        self.assertEqual(
            result,
            {
                "submission_id": "submission-1",
                "status": "NO_SIGN_DETECTED",
                "total_candidates": 0,
                "unmapped_labels": 0,
            },
        )
        set_status.assert_any_call("submission-1", "DETECTING", "Inference engine is processing submission media.")
        set_status.assert_any_call("submission-1", "NO_SIGN_DETECTED", "Inference completed without traffic sign detections.")

    def test_pipeline_skips_rejected_terminal_submission(self) -> None:
        task = ai_pipeline.task_process_submission_pipeline

        with (
            patch.object(ai_pipeline, "_claim_submission", return_value="REJECTED"),
            patch.object(ai_pipeline, "_clear_dispatch_lock") as clear_lock,
            patch.object(ai_pipeline, "_call_inference_engine") as call_engine,
        ):
            result = task.apply(args=["submission-1", []]).get()

        self.assertEqual(result, {"submission_id": "submission-1", "skipped": True, "reason": "REJECTED"})
        clear_lock.assert_called_once_with("submission-1")
        call_engine.assert_not_called()

