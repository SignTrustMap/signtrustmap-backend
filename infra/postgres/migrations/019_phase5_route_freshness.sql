-- ---------------------------------------------------------------------------
-- Migration 008: Phase 5 Route-Aware Freshness & PostGIS Decay Worker
-- ---------------------------------------------------------------------------

-- 1. Create route_classifications table
CREATE TABLE IF NOT EXISTS "route_classifications" (
  "id" SERIAL PRIMARY KEY,
  "name" VARCHAR(64) NOT NULL UNIQUE,
  "road_type" VARCHAR(32) NOT NULL,
  "default_lifetime_days" INT NOT NULL,
  "revalidation_threshold_days" INT NOT NULL,
  "spatial_buffer_meters" INT NOT NULL DEFAULT 20,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed standard route classification hierarchy
INSERT INTO "route_classifications" ("name", "road_type", "default_lifetime_days", "revalidation_threshold_days", "spatial_buffer_meters")
VALUES
  ('Urban Corridors / Construction', 'URBAN', 30, 7, 15),
  ('Provincial Roads & Mountain Passes', 'PROVINCIAL', 90, 21, 25),
  ('National Expressways & Highways', 'HIGHWAY', 180, 30, 30),
  ('Temporary / Seasonal Speed Alerts', 'TEMPORARY', 14, 3, 20)
ON CONFLICT ("name") DO UPDATE SET
  "road_type" = EXCLUDED."road_type",
  "default_lifetime_days" = EXCLUDED."default_lifetime_days",
  "revalidation_threshold_days" = EXCLUDED."revalidation_threshold_days",
  "spatial_buffer_meters" = EXCLUDED."spatial_buffer_meters";

-- 2. Extend sign_lifecycle_status enum with Phase 5/6 statuses
DO $$
BEGIN
  BEGIN
    ALTER TYPE "sign_lifecycle_status" ADD VALUE IF NOT EXISTS 'REVALIDATION_REQUIRED';
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TYPE "sign_lifecycle_status" ADD VALUE IF NOT EXISTS 'INACTIVE';
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TYPE "sign_lifecycle_status" ADD VALUE IF NOT EXISTS 'DECOMMISSIONED';
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- 3. Enhance verified_traffic_signs with route_classification_id
ALTER TABLE "verified_traffic_signs"
  ADD COLUMN IF NOT EXISTS "route_classification_id" INT REFERENCES "route_classifications"("id");

CREATE INDEX IF NOT EXISTS "idx_verified_signs_route_class"
  ON "verified_traffic_signs"("route_classification_id");

-- 4. Enhance revalidation_tasks with urgency, route_classification_id, and bounty metadata
ALTER TABLE "revalidation_tasks"
  ADD COLUMN IF NOT EXISTS "urgency" FLOAT NOT NULL DEFAULT 0.0,
  ADD COLUMN IF NOT EXISTS "route_classification_id" INT REFERENCES "route_classifications"("id");

CREATE INDEX IF NOT EXISTS "idx_reval_tasks_urgency"
  ON "revalidation_tasks"("urgency" DESC);
