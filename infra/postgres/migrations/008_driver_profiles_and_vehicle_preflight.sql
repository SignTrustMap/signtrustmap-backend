-- =============================================================================
-- 008_driver_profiles_and_vehicle_preflight.sql
-- Ensures driver_profiles has enabled_categories and traffic_sign_types has allowed_vehicles.
-- Idempotent: safe to re-run on every startup or migration run.
-- =============================================================================
ALTER TABLE "traffic_sign_types"
  ADD COLUMN IF NOT EXISTS "allowed_vehicles" text[]
    NOT NULL DEFAULT ARRAY['CAR','MOTORCYCLE','TRUCK','BUS','BICYCLE','PEDESTRIAN']::text[];

CREATE TABLE IF NOT EXISTS "driver_profiles" (
  user_id uuid PRIMARY KEY,
  default_vehicle_type varchar(30) DEFAULT 'CAR',
  enabled_categories text[] DEFAULT ARRAY['SPEED_LIMIT','WARNING','PROHIBITION','MANDATORY','INFORMATION'],
  total_nav_sessions int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "driver_profiles"
  ADD COLUMN IF NOT EXISTS "enabled_categories" text[]
    DEFAULT ARRAY['SPEED_LIMIT','WARNING','PROHIBITION','MANDATORY','INFORMATION'];
