-- ---------------------------------------------------------------------------
-- Migration 009: Phase 6 Dual-Outcome Revalidation Quests & Roadside Hazard Consensus
-- ---------------------------------------------------------------------------

-- 1. Extend revalidation_evidences with evidence_type (STILL_ACTIVE vs REMOVED)
ALTER TABLE "revalidation_evidences"
  ADD COLUMN IF NOT EXISTS "evidence_type" VARCHAR(32) NOT NULL DEFAULT 'STILL_ACTIVE';

CREATE INDEX IF NOT EXISTS "idx_revalidation_evidences_type"
  ON "revalidation_evidences" ("evidence_type");

-- 2. Create road_hazard_events table
CREATE TABLE IF NOT EXISTS "road_hazard_events" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "reported_by" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "hazard_type" VARCHAR(64) NOT NULL,
  "description" TEXT,
  "location" GEOMETRY(Point, 4326) NOT NULL,
  "status" VARCHAR(32) NOT NULL DEFAULT 'UNCONFIRMED',
  "confirmations_count" INT NOT NULL DEFAULT 1,
  "dismissals_count" INT NOT NULL DEFAULT 0,
  "reward_paid" BOOLEAN NOT NULL DEFAULT FALSE,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Spatial and query indexes for road_hazard_events
CREATE INDEX IF NOT EXISTS "idx_road_hazard_events_location"
  ON "road_hazard_events" USING GIST ("location");

CREATE INDEX IF NOT EXISTS "idx_road_hazard_events_location_geog"
  ON "road_hazard_events" USING GIST (("location"::geography));

CREATE INDEX IF NOT EXISTS "idx_road_hazard_events_status_expires"
  ON "road_hazard_events" ("status", "expires_at");

CREATE INDEX IF NOT EXISTS "idx_road_hazard_events_reporter"
  ON "road_hazard_events" ("reported_by");

-- 3. Create hazard_confirmations table
CREATE TABLE IF NOT EXISTS "hazard_confirmations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "hazard_id" UUID NOT NULL REFERENCES "road_hazard_events"("id") ON DELETE CASCADE,
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "vote_type" VARCHAR(16) NOT NULL,
  "location" GEOMETRY(Point, 4326),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "uq_hazard_user_confirmation" UNIQUE ("hazard_id", "user_id")
);

CREATE INDEX IF NOT EXISTS "idx_hazard_confirmations_hazard"
  ON "hazard_confirmations" ("hazard_id");

CREATE INDEX IF NOT EXISTS "idx_hazard_confirmations_user"
  ON "hazard_confirmations" ("user_id");

-- 4. Ensure reward rules are seeded for Phase 6 activity types
INSERT INTO "reward_rules" ("activity_type", "base_amount", "daily_limit", "multiplier_config", "is_active")
VALUES
  ('SIGN_DECOMMISSION_REWARD', 30, 10, '{}'::jsonb, TRUE),
  ('HAZARD_REPORT_REWARD', 10, 15, '{}'::jsonb, TRUE),
  ('HAZARD_CONFIRM_REWARD', 2, 30, '{}'::jsonb, TRUE)
ON CONFLICT ("activity_type") DO NOTHING;
