-- Upgrade an existing SignTrustMap database to the submission-first media contract.
-- Run with: psql -X --set ON_ERROR_STOP=1 "$DATABASE_URL" -f infra/postgres/migrations/001_unify_submission_contract.sql

ALTER TYPE submission_status ADD VALUE IF NOT EXISTS 'DRAFT' BEFORE 'QUEUED';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'coordinate_source') THEN
    CREATE TYPE coordinate_source AS ENUM (
      'IMAGE_EXIF',
      'DEVICE_GPS',
      'MANUAL',
      'GPX_FILE',
      'LIVE_STREAM'
    );
  END IF;
END
$$;

ALTER TABLE survey_submissions
  ADD COLUMN IF NOT EXISTS captured_at timestamptz,
  ADD COLUMN IF NOT EXISTS coordinate_source coordinate_source,
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS correction_requirements jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE survey_submissions
SET captured_at = created_at
WHERE captured_at IS NULL;

UPDATE survey_submissions
SET coordinate_source = CASE submission_type
  WHEN 'SINGLE_IMAGE' THEN 'DEVICE_GPS'::coordinate_source
  WHEN 'VIDEO_GPX' THEN 'GPX_FILE'::coordinate_source
  WHEN 'LIVE_TRIP' THEN 'LIVE_STREAM'::coordinate_source
END
WHERE coordinate_source IS NULL;

ALTER TABLE survey_submissions
  ALTER COLUMN captured_at SET NOT NULL,
  ALTER COLUMN coordinate_source SET NOT NULL,
  ALTER COLUMN status SET DEFAULT 'DRAFT';

DO $$
DECLARE
  upload_row record;
  new_submission_id uuid;
BEGIN
  FOR upload_row IN
    SELECT id, user_id, media_type, created_at
    FROM upload_sessions
    WHERE submission_id IS NULL
    ORDER BY created_at, id
  LOOP
    INSERT INTO survey_submissions (
      surveyor_id,
      submission_type,
      status,
      captured_at,
      coordinate_source,
      note
    )
    VALUES (
      upload_row.user_id,
      CASE WHEN upload_row.media_type = 'IMAGE'
        THEN 'SINGLE_IMAGE'::submission_type
        ELSE 'VIDEO_GPX'::submission_type
      END,
      'DRAFT'::submission_status,
      upload_row.created_at,
      CASE WHEN upload_row.media_type = 'IMAGE'
        THEN 'DEVICE_GPS'::coordinate_source
        ELSE 'GPX_FILE'::coordinate_source
      END,
      'Created while upgrading a legacy upload session'
    )
    RETURNING id INTO new_submission_id;

    UPDATE upload_sessions
    SET submission_id = new_submission_id
    WHERE id = upload_row.id;
  END LOOP;
END
$$;

ALTER TABLE upload_sessions
  ALTER COLUMN submission_id SET NOT NULL;

ALTER TABLE submission_media_files
  ADD COLUMN IF NOT EXISTS upload_session_id uuid;

UPDATE submission_media_files media
SET upload_session_id = (
  SELECT session.id
  FROM upload_sessions session
  WHERE session.submission_id = media.submission_id
    AND session.storage_key = media.file_url
  ORDER BY session.created_at
  LIMIT 1
)
WHERE media.upload_session_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_submission_media_files_upload_session
  ON submission_media_files (upload_session_id)
  WHERE upload_session_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'submission_media_files'::regclass
      AND contype = 'f'
      AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (upload_session_id)%'
  ) THEN
    ALTER TABLE submission_media_files
      ADD CONSTRAINT fk_submission_media_files_upload_session
      FOREIGN KEY (upload_session_id) REFERENCES upload_sessions (id)
      DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END
$$;
