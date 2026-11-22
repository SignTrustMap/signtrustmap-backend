-- 049_media_duration_and_retention_params.sql
-- Seed configurable video duration limit, GPX size limit, and raw media retention policy in system_parameters.

BEGIN;

INSERT INTO "system_parameters" ("key", "value", "description", "category", "data_type", "validation_rules") VALUES
  (
    'survey.max_video_duration_seconds',
    '900',
    'Maximum allowed raw video duration in seconds (default 900s = 15 minutes per SRS)',
    'INGESTION',
    'INTEGER',
    '{"min": 30, "max": 3600, "step": 30}'::jsonb
  ),
  (
    'survey.raw_media_retention_days',
    '30',
    'Number of days to retain raw uploaded videos and GPX logs on MinIO after submission completion before automated cleanup (cropped sign images are retained permanently)',
    'INGESTION',
    'INTEGER',
    '{"min": 1, "max": 365, "step": 1}'::jsonb
  ),
  (
    'survey.max_gpx_size_mb',
    '20',
    'Maximum GPX track file upload size in megabytes',
    'INGESTION',
    'INTEGER',
    '{"min": 1, "max": 100, "step": 1}'::jsonb
  )
ON CONFLICT ("key") DO UPDATE
  SET "category" = EXCLUDED."category",
      "data_type" = EXCLUDED."data_type",
      "validation_rules" = EXCLUDED."validation_rules",
      "description" = EXCLUDED."description";

COMMIT;
