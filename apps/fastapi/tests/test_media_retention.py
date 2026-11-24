from __future__ import annotations

from contextlib import contextmanager
from unittest.mock import MagicMock, patch

from app.tasks import media_retention


def _fake_db_ctx(db):
    @contextmanager
    def _ctx():
        yield db

    return _ctx


def test_cleanup_deletes_expired_raw_media_and_expires_upload_sessions():
    db = MagicMock()

    param_res = MagicMock()
    param_res.first.return_value = ("14",)

    rows_res = MagicMock()
    rows_res.mappings.return_value.all.return_value = [
        {
            "id": "m-1",
            "submission_id": "s-1",
            "media_type": "VIDEO",
            "storage_bucket": "stm-raw-videos",
            "storage_key": "raw/s-1/dashcam.mp4",
        },
        {
            "id": "m-2",
            "submission_id": "s-1",
            "media_type": "GPX",
            "storage_bucket": "stm-gpx-logs",
            "storage_key": "raw/s-1/track.gpx",
        },
        {
            # Should NEVER be deleted even if returned
            "id": "m-3",
            "submission_id": "s-1",
            "media_type": "IMAGE",
            "storage_bucket": "stm-sign-crops",
            "storage_key": "crops/s-1/sign.jpg",
        },
    ]

    expire_res = MagicMock()
    expire_res.rowcount = 3

    def execute_side_effect(sql, params=None):
        sql_text = str(sql)
        if "FROM system_parameters" in sql_text:
            return param_res
        if "FROM submission_media_files" in sql_text:
            return rows_res
        if "UPDATE upload_sessions" in sql_text:
            return expire_res
        return MagicMock()

    db.execute.side_effect = execute_side_effect

    minio_client = MagicMock()

    with (
        patch.object(media_retention, "get_sync_db", _fake_db_ctx(db)),
        patch.object(media_retention, "_get_minio_client", return_value=minio_client),
    ):
        summary = media_retention.task_cleanup_expired_raw_media.run(batch_limit=100)

    assert summary["retention_days"] == 14
    assert summary["deleted_objects"] == 2
    assert summary["already_missing"] == 0
    assert summary["failed_objects"] == 0
    assert summary["expired_upload_sessions"] == 3
    minio_client.remove_object.assert_any_call("stm-raw-videos", "raw/s-1/dashcam.mp4")
    minio_client.remove_object.assert_any_call("stm-gpx-logs", "raw/s-1/track.gpx")
    assert minio_client.remove_object.call_count == 2
    db.commit.assert_called_once()


def test_cleanup_handles_missing_minio_object_idempotently():
    db = MagicMock()

    param_res = MagicMock()
    param_res.first.return_value = None  # fall back to settings.RAW_MEDIA_RETENTION_DAYS

    rows_res = MagicMock()
    rows_res.mappings.return_value.all.return_value = [
        {
            "id": "m-404",
            "submission_id": "s-2",
            "media_type": "VIDEO",
            "storage_bucket": "stm-raw-videos",
            "storage_key": "raw/s-2/already-deleted.mp4",
        }
    ]

    expire_res = MagicMock()
    expire_res.rowcount = 0

    def execute_side_effect(sql, params=None):
        sql_text = str(sql)
        if "FROM system_parameters" in sql_text:
            return param_res
        if "FROM submission_media_files" in sql_text:
            return rows_res
        if "UPDATE upload_sessions" in sql_text:
            return expire_res
        return MagicMock()

    db.execute.side_effect = execute_side_effect

    minio_client = MagicMock()
    minio_client.remove_object.side_effect = RuntimeError("S3Error: NoSuchKey")

    with (
        patch.object(media_retention, "get_sync_db", _fake_db_ctx(db)),
        patch.object(media_retention, "_get_minio_client", return_value=minio_client),
    ):
        summary = media_retention.task_cleanup_expired_raw_media.run()

    assert summary["retention_days"] == 30
    assert summary["deleted_objects"] == 0
    assert summary["already_missing"] == 1
    assert summary["failed_objects"] == 0
