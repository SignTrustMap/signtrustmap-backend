-- =============================================================================
-- Migration 041: System Feature Flags & Dynamic Demo Switchboard
-- Enables runtime toggling of demo modes, consensus quorums, self-review checks,
-- geofencing bypasses, and test utility endpoints via authenticated Admin APIs.
-- =============================================================================

CREATE TABLE IF NOT EXISTS "system_feature_flags" (
  "key" VARCHAR(64) PRIMARY KEY,
  "name" VARCHAR(128) NOT NULL,
  "description" TEXT,
  "category" VARCHAR(32) NOT NULL DEFAULT 'DEMO',
  "is_enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "metadata" JSONB DEFAULT '{}'::jsonb,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_by" UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "idx_system_feature_flags_category"
  ON "system_feature_flags" ("category");

INSERT INTO "system_feature_flags" ("key", "name", "description", "category", "is_enabled", "metadata")
VALUES
  ('DEMO_MODE_ACTIVE', 'Master Demo Mode', 'Master switch that relaxes quorum and surveyor constraints for live presentations', 'DEMO', false, '{}'),
  ('ALLOW_SELF_REVIEW', 'Allow Surveyor Self-Review', 'Allows surveyors to review and vote on their own sign candidates and request recaptures', 'REVIEWS', false, '{}'),
  ('SINGLE_VOTE_CONSENSUS', 'Single-Vote Instant Consensus', 'Resolves candidate consensus immediately on the first vote cast', 'CONSENSUS', false, '{}'),
  ('BYPASS_RECAPTURE_GEOFENCE', 'Bypass Recapture GPS Geofencing', 'Allows discovering and submitting recapture quests without proximity constraints', 'REVIEWS', false, '{}'),
  ('AUTO_ASSIGN_RECAPTURE_EMAIL', 'Auto-Assign Recaptures to Specific Email', 'Routes new candidate recapture requests to a designated surveyor email address', 'MODERATION', false, '{"targetEmail": "demo@stm.dev"}'),
  ('ENABLE_TEST_UTILITY_ENDPOINTS', 'Enable Testing Utility Endpoints', 'Enables administrative test endpoints to inject reviews and direct candidate assignments', 'TESTING', false, '{}')
ON CONFLICT ("key") DO NOTHING;
