-- Migration 004: Camera calibration profiles & frame sequence ingestion

ALTER TYPE media_file_type ADD VALUE IF NOT EXISTS 'FRAME_SEQUENCE';
ALTER TYPE submission_type ADD VALUE IF NOT EXISTS 'FRAME_BATCH';

CREATE TABLE IF NOT EXISTS "camera_calibration_profiles" (
  "id" uuid PRIMARY KEY DEFAULT (gen_random_uuid()),
  "user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "device_model" varchar(100) NOT NULL,
  "camera_height_meters" float NOT NULL DEFAULT 1.35,
  "pitch_angle_degrees" float NOT NULL DEFAULT 0.0,
  "yaw_offset_degrees" float NOT NULL DEFAULT 0.0,
  "hfov_degrees" float NOT NULL DEFAULT 60.0,
  "focal_length_px" float,
  "is_default" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT (now()),
  "updated_at" timestamptz NOT NULL DEFAULT (now())
);

CREATE INDEX IF NOT EXISTS "idx_camera_calibration_user" ON "camera_calibration_profiles"("user_id");

ALTER TABLE "survey_submissions" ADD COLUMN IF NOT EXISTS "camera_profile_id" uuid REFERENCES "camera_calibration_profiles" ("id") ON DELETE SET NULL;
