import json
from datetime import datetime, timezone
from unittest import TestCase
from unittest.mock import MagicMock, patch

from app.tasks import ai_pipeline
from app.tasks.gpx_sync import (
    calculate_bearing,
    estimate_sign_coordinates,
    interpolate_gpx_position,
    parse_gpx_content,
)


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
            patch.object(ai_pipeline, "_persist_candidates") as persist_candidates,
            patch.object(ai_pipeline, "get_sync_db") as get_sync_db,
            patch.object(ai_pipeline, "_clear_dispatch_lock"),
        ):
            get_sync_db.return_value.__enter__.return_value = MagicMock()
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
        persist_candidates.assert_not_called()
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

    def test_gpx_parsing_and_bearing_calculation(self) -> None:
        gpx_xml = (
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<gpx version="1.1" creator="STM" xmlns="http://www.topografix.com/GPX/1/1">'
            '  <trk><trkseg>'
            '    <trkpt lat="21.02850" lon="105.83420"><ele>12.0</ele><time>2026-09-08T10:00:00Z</time></trkpt>'
            '    <trkpt lat="21.02950" lon="105.83420"><ele>12.5</ele><time>2026-09-08T10:00:10Z</time></trkpt>'
            '  </trkseg></trk>'
            '</gpx>'
        )
        points = parse_gpx_content(gpx_xml)
        self.assertEqual(len(points), 2)
        self.assertAlmostEqual(points[0].lat, 21.02850)
        self.assertAlmostEqual(points[1].lat, 21.02950)

        # Moving due North
        bearing = calculate_bearing(points[0].lat, points[0].lon, points[1].lat, points[1].lon)
        self.assertAlmostEqual(bearing, 0.0, places=1)

    def test_gpx_timestamp_interpolation(self) -> None:
        gpx_xml = (
            '<gpx version="1.1">'
            '  <trk><trkseg>'
            '    <trkpt lat="21.000" lon="105.000"><time>2026-09-08T10:00:00Z</time></trkpt>'
            '    <trkpt lat="21.010" lon="105.020"><time>2026-09-08T10:00:20Z</time></trkpt>'
            '  </trkseg></trk>'
            '</gpx>'
        )
        points = parse_gpx_content(gpx_xml)
        target_t = datetime(2026, 9, 8, 10, 0, 10, tzinfo=timezone.utc)
        lat, lon, bearing = interpolate_gpx_position(points, target_t)
        self.assertAlmostEqual(lat, 21.005, places=3)
        self.assertAlmostEqual(lon, 105.010, places=3)
        self.assertGreater(bearing, 0.0)

    def test_estimate_sign_coordinates_spherical_trig(self) -> None:
        veh_lat, veh_lon, veh_bearing = 21.0285, 105.8342, 90.0  # Heading East
        box = [960.0, 500.0, 1060.0, 600.0]  # Right of center
        geo = estimate_sign_coordinates(veh_lat, veh_lon, veh_bearing, box)

        self.assertEqual(geo["vehicle_lat"], 21.0285)
        self.assertEqual(geo["vehicle_lon"], 105.8342)
        self.assertIn("sign_lat", geo)
        self.assertIn("sign_lon", geo)
        self.assertGreater(geo["estimated_distance"], 0.0)
        self.assertEqual(geo["bearing_angle"], 90.0)
        self.assertEqual(geo["traffic_direction"], 90.0)
        self.assertEqual(geo["projection_method"], "spherical_trig")
        self.assertIn(geo["spatial_confidence"], ("HIGH", "LOW"))

    def test_pipeline_progresses_all_stages_and_persists_candidates(self) -> None:
        task = ai_pipeline.task_process_submission_pipeline
        dummy_signs = [{
            "track_id": 1,
            "class_id": 102,
            "class_name": "P.102",
            "confidence": 0.95,
            "box_xyxy": [100.0, 200.0, 300.0, 400.0],
            "best_frame_key": "stm-sign-crops/submissions/sub-1/best.jpg",
            "sign_crop_key": "stm-sign-crops/submissions/sub-1/crop.jpg",
            "frame_index": 12,
            "timestamp_seconds": 1.5,
        }]

        with (
            patch.object(ai_pipeline, "_claim_submission", return_value="QUEUED"),
            patch.object(ai_pipeline, "_load_submission_metadata", return_value={"captured_at": datetime.now(timezone.utc)}),
            patch.object(ai_pipeline, "_download_gpx_track", return_value=[]),
            patch.object(ai_pipeline, "_set_status") as set_status,
            patch.object(ai_pipeline, "_call_inference_engine", return_value={"submission_id": "submission-1", "signs": dummy_signs}),
            patch.object(ai_pipeline, "_persist_candidates", return_value=(1, 0)),
            patch.object(ai_pipeline, "_complete_submission") as complete_sub,
            patch.object(ai_pipeline, "_clear_dispatch_lock") as clear_lock,
        ):
            result = task.apply(args=["submission-1", []]).get()

        self.assertEqual(
            result,
            {
                "submission_id": "submission-1",
                "status": "COMPLETED",
                "total_candidates": 1,
                "unmapped_labels": 0,
            },
        )
        set_status.assert_any_call("submission-1", "SYNCHRONIZING", "Media references synchronized from MinIO.")
        set_status.assert_any_call("submission-1", "DETECTING", "Inference engine is processing submission media.")
        set_status.assert_any_call("submission-1", "TRACKING", "Multi-object tracking clustered 1 candidate sign track(s).")
        set_status.assert_any_call("submission-1", "ESTIMATING", "Calculating physical sign coordinates and traffic direction via spherical trigonometry.")
        set_status.assert_any_call("submission-1", "CLASSIFYING", "Inference returned; resolving catalog labels.")
        complete_sub.assert_called_once()
        clear_lock.assert_called_once_with("submission-1")

    def test_persist_candidates_populates_candidate_and_geo_estimations(self) -> None:
        db = MagicMock()
        db.execute.return_value.mappings.return_value.first.return_value = {"id": 1}
        db.execute.return_value.scalar_one.return_value = "cand-uuid-1"

        dummy_signs = [{
            "track_id": 42,
            "class_id": 102,
            "class_name": "P.102",
            "confidence": 0.92,
            "box_xyxy": [100.0, 100.0, 200.0, 200.0],
            "best_frame_key": "crops/sub/frame.jpg",
            "sign_crop_key": "crops/sub/crop.jpg",
            "frame_index": 5,
            "timestamp_seconds": 2.0,
        }]

        with patch.object(ai_pipeline, "get_sync_db") as get_sync_db:
            get_sync_db.return_value.__enter__.return_value = db
            inserted, unmapped = ai_pipeline._persist_candidates("sub-1", dummy_signs)

        self.assertEqual(inserted, 1)
        self.assertEqual(unmapped, 0)
        # Verify db.commit and execution of candidate + geo estimation insert
        self.assertGreater(db.execute.call_count, 4)
        db.commit.assert_called_once()

    def test_pipeline_marks_failed_on_exception_after_retries(self) -> None:
        task = ai_pipeline.task_process_submission_pipeline
        db = MagicMock()
        db.execute.return_value.mappings.return_value.first.return_value = {"status": "ESTIMATING"}

        with (
            patch.object(ai_pipeline, "get_sync_db") as get_sync_db,
            patch.object(ai_pipeline, "_load_submission_metadata", return_value=None),
            patch.object(ai_pipeline, "_download_gpx_track", return_value=[]),
            patch.object(ai_pipeline, "_set_status"),
            patch.object(ai_pipeline, "_call_inference_engine", side_effect=RuntimeError("AI server offline")),
            patch.object(ai_pipeline, "_mark_failed") as mark_failed,
            patch.object(ai_pipeline, "_clear_dispatch_lock") as clear_lock,
        ):
            get_sync_db.return_value.__enter__.return_value = db
            # Task max retries is 2; run with request retries = 2
            with self.assertRaises(RuntimeError):
                task.apply(args=["submission-err", []], retries=2).get()

        mark_failed.assert_called_once()
        self.assertIn("AI inference failed after retries", mark_failed.call_args[0][1])
        clear_lock.assert_called_once_with("submission-err")

    def test_estimate_sign_coordinates_with_camera_calibration(self) -> None:
        veh_lat, veh_lon, veh_bearing = 21.0285, 105.8342, 90.0
        box = [960.0, 500.0, 1060.0, 600.0]
        geo = estimate_sign_coordinates(
            vehicle_lat=veh_lat,
            vehicle_lon=veh_lon,
            vehicle_bearing=veh_bearing,
            box_xyxy=box,
            camera_height_m=1.8,
            pitch_deg=-3.0,
            yaw_offset_deg=5.0,
        )
        self.assertEqual(geo["camera_height_m"], 1.8)
        self.assertEqual(geo["pitch_deg"], -3.0)
        self.assertEqual(geo["yaw_offset_deg"], 5.0)
        self.assertIn("estimated_ground_height_m", geo)
        self.assertGreater(geo["estimated_ground_height_m"], 0.5)

    def test_download_gpx_track_from_frame_sequence(self) -> None:
        manifest = json.dumps({
            "fps": 5.0,
            "totalFrames": 2,
            "frames": [
                {"frameIndex": 0, "timestampMs": 1718000000000, "latitude": 21.03, "longitude": 105.84},
                {"frameIndex": 1, "timestampMs": 1718000000200, "latitude": 21.0301, "longitude": 105.8402},
            ],
        }).encode("utf-8")
        media_objects = [{"media_type": "FRAME_SEQUENCE", "bucket": "stm-raw-videos", "object_key": "manifest.json"}]
        with patch.object(ai_pipeline, "_download_minio_bytes", return_value=manifest):
            points = ai_pipeline._download_gpx_track(media_objects)
        self.assertEqual(len(points), 2)
        self.assertAlmostEqual(points[0].lat, 21.03)
        self.assertAlmostEqual(points[1].lat, 21.0301)

    def test_load_camera_profile_fallback(self) -> None:
        db = MagicMock()
        db.execute.return_value.mappings.return_value.first.return_value = None
        profile = ai_pipeline._load_camera_profile(db, "user-1", None)
        self.assertEqual(profile["camera_height_m"], 1.35)
        self.assertEqual(profile["pitch_deg"], 0.0)
        self.assertEqual(profile["yaw_offset_deg"], 0.0)

    def test_batch_dispatcher_dispatches_pending_batches(self) -> None:
        db = MagicMock()
        db.execute.return_value.mappings.return_value.all.return_value = [
            {"id": "batch-1"},
            {"id": "batch-2"},
        ]
        broker = MagicMock()
        broker.set.return_value = True

        with (
            patch.object(ai_pipeline, "get_sync_db") as get_sync_db,
            patch.object(ai_pipeline, "_broker_client", return_value=broker),
            patch.object(ai_pipeline.task_process_batch_survey, "apply_async") as apply_async,
        ):
            get_sync_db.return_value.__enter__.return_value = db
            result = ai_pipeline.task_dispatch_pending_batch_submissions.run()

        self.assertEqual(result, {"pending": 2, "dispatched": 2})
        self.assertEqual(apply_async.call_count, 2)
        apply_async.assert_any_call(
            kwargs={"batch_id": "batch-1"},
            queue="ai_pipeline",
        )
        apply_async.assert_any_call(
            kwargs={"batch_id": "batch-2"},
            queue="ai_pipeline",
        )

    def test_complete_batch_submission_posts_to_nestjs(self) -> None:
        client = MagicMock()
        response = MagicMock()
        client.__enter__.return_value.post.return_value = response

        with patch.object(ai_pipeline.httpx, "Client", return_value=client):
            ai_pipeline._complete_batch_submission(
                batch_id="batch-uuid-1",
                extracted_candidates=3,
                total_processed=5,
                note="Batch complete",
            )

        client.__enter__.return_value.post.assert_called_once_with(
            "http://localhost:3000/api/v1/submissions/internal/batch/batch-uuid-1/complete",
            json={
                "extractedCandidates": 3,
                "totalProcessed": 5,
                "note": "Batch complete",
            },
            headers={"X-Internal-Token": "stm_internal_secret_dev"},
        )

    def test_task_process_batch_survey_processes_images_and_notifies(self) -> None:
        task = ai_pipeline.task_process_batch_survey
        db = MagicMock()
        db.execute.return_value.mappings.return_value.first.return_value = {
            "id": "batch-uuid-1",
            "user_id": "user-uuid-1",
            "status": "PENDING",
            "total_images": 2,
            "metadata": {
                "images": [
                    {"storageKey": "stm-raw/batch1/img1.jpg", "mediaType": "IMAGE"},
                    {"storageKey": "stm-raw/batch1/img2.jpg", "mediaType": "IMAGE"},
                ]
            },
        }

        broker = MagicMock()

        with (
            patch.object(ai_pipeline, "get_sync_db") as get_sync_db,
            patch.object(ai_pipeline, "_broker_client", return_value=broker),
            patch.object(
                ai_pipeline,
                "_call_inference_engine",
                side_effect=[
                    {"signs": [{"class_name": "P.102", "confidence": 0.9}]},
                    {"signs": [{"class_name": "P.103", "confidence": 0.85}, {"class_name": "W.201", "confidence": 0.88}]},
                ],
            ) as call_engine,
            patch.object(ai_pipeline, "_complete_batch_submission") as complete_batch,
        ):
            get_sync_db.return_value.__enter__.return_value = db
            result = task.apply(args=["batch-uuid-1"]).get()

        self.assertEqual(
            result,
            {
                "batch_id": "batch-uuid-1",
                "status": "COMPLETED",
                "processed_images": 2,
                "extracted_candidates": 3,
            },
        )
        self.assertEqual(call_engine.call_count, 2)
        complete_batch.assert_called_once_with(
            batch_id="batch-uuid-1",
            extracted_candidates=3,
            total_processed=2,
            note="Batch processed 2 image(s); extracted 3 candidate(s).",
        )
        broker.delete.assert_called_once_with("stm:batch-dispatch:batch-uuid-1")

    def test_task_process_batch_survey_skips_already_completed(self) -> None:
        task = ai_pipeline.task_process_batch_survey
        db = MagicMock()
        db.execute.return_value.mappings.return_value.first.return_value = {
            "id": "batch-uuid-1",
            "status": "COMPLETED",
        }

        with patch.object(ai_pipeline, "get_sync_db") as get_sync_db:
            get_sync_db.return_value.__enter__.return_value = db
            result = task.apply(args=["batch-uuid-1"]).get()

        self.assertEqual(
            result,
            {"batch_id": "batch-uuid-1", "skipped": True, "reason": "already_completed"},
        )


