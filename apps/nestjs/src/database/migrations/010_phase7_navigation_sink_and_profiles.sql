-- ---------------------------------------------------------------------------
-- Migration 010: Phase 7 Navigation Sink Gate, Webhook Security & Admin APIs
-- ---------------------------------------------------------------------------

-- 1. Create custom_alert_profiles table (Credit Sink: CUSTOM_PROFILE_SPEND)
CREATE TABLE IF NOT EXISTS "custom_alert_profiles" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" VARCHAR(64) NOT NULL,
  "description" TEXT,
  "filter_rules" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_custom_alert_profiles_user"
  ON "custom_alert_profiles" ("user_id");

-- 2. Ensure navigation_sessions table has proper structure and indexes
CREATE TABLE IF NOT EXISTS "navigation_sessions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "driver_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "origin" GEOMETRY(Point, 4326) NOT NULL,
  "destination" GEOMETRY(Point, 4326) NOT NULL,
  "credits_deducted" INT NOT NULL DEFAULT 0,
  "status" VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "ended_at" TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS "idx_navigation_sessions_driver"
  ON "navigation_sessions" ("driver_id");

CREATE INDEX IF NOT EXISTS "idx_navigation_sessions_status"
  ON "navigation_sessions" ("status");

-- 3. Ensure reward rules has entry for NAVIGATION_FEE and CUSTOM_PROFILE_SPEND rules if needed
INSERT INTO "reward_rules" ("activity_type", "base_amount", "daily_limit", "multiplier_config", "is_active")
VALUES
  ('NAVIGATION_FEE', 5, 100, '{}'::jsonb, TRUE),
  ('CUSTOM_PROFILE_SPEND', 20, 10, '{}'::jsonb, TRUE)
ON CONFLICT ("activity_type") DO NOTHING;
