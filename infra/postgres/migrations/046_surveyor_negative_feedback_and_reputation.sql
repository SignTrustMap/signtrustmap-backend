-- =============================================================================
-- Migration 046: Surveyor Negative Feedback Loop & Reputation Governance
-- =============================================================================

BEGIN;

-- 1. Extend moderation_type ENUM with MANUAL_SURVEY_ANNOTATION
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'moderation_type' AND e.enumlabel = 'MANUAL_SURVEY_ANNOTATION'
  ) THEN
    ALTER TYPE moderation_type ADD VALUE 'MANUAL_SURVEY_ANNOTATION';
  END IF;
END $$;

-- 2. Upgrade surveyor_profiles table with Reliability & Annotation Governance
ALTER TABLE surveyor_profiles
  ADD COLUMN IF NOT EXISTS reliability_score DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS total_manual_annotations INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS approved_manual_annotations INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rejected_manual_annotations INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS consecutive_annotation_errors INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_annotation_suspended BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS suspended_until TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS suspension_reason TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_surveyor_profiles_reliability
  ON surveyor_profiles (reliability_score)
  WHERE is_annotation_suspended = FALSE;

-- 3. Upgrade unverified_sign_candidates with Manual Annotation fields
ALTER TABLE unverified_sign_candidates
  ADD COLUMN IF NOT EXISTS is_manual_annotation BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS manual_annotation_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manual_bounding_box JSONB NULL,
  ADD COLUMN IF NOT EXISTS manual_annotation_notes TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_candidates_manual_annotation
  ON unverified_sign_candidates (is_manual_annotation, status)
  WHERE is_manual_annotation = TRUE;

-- 4. Upgrade survey_submissions with Negative Feedback Tracking
ALTER TABLE survey_submissions
  ADD COLUMN IF NOT EXISTS has_manual_annotation BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS manual_annotation_status VARCHAR(32) NULL;

-- 5. Create surveyor_reputation_history table for immutable auditability
CREATE TABLE IF NOT EXISTS surveyor_reputation_history (
  id BIGSERIAL PRIMARY KEY,
  surveyor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  previous_score DOUBLE PRECISION NOT NULL,
  new_score DOUBLE PRECISION NOT NULL,
  delta DOUBLE PRECISION NOT NULL,
  change_reason VARCHAR(255) NOT NULL,
  reference_entity_type VARCHAR(50) NULL,
  reference_entity_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_surveyor_rep_history_user
  ON surveyor_reputation_history (surveyor_id, created_at DESC);

-- 6. Seed Dynamic System Parameters for Surveyor Negative Governance
INSERT INTO system_parameters (key, value, description, category, data_type, validation_rules) VALUES
  ('survey.manual_annotation_enabled', 'true', 'Enable surveyor manual bounding box annotation on false-negative submissions', 'INGESTION', 'BOOLEAN', '{"allowedValues": [true, false]}'),
  ('survey.manual_annotation_reward_credits', '35', 'Bonus credits rewarded to surveyor when staff approves a manual sign annotation', 'INGESTION', 'INTEGER', '{"min": 10, "max": 200, "step": 5}'),
  ('survey.manual_annotation_penalty_credits', '20', 'Penalty credits deducted from surveyor when staff rejects a bogus manual annotation', 'INGESTION', 'INTEGER', '{"min": 0, "max": 100, "step": 5}'),
  ('survey.manual_annotation_reward_reputation_boost', '0.05', 'Surveyor reliability score increase on staff approved manual annotation', 'INGESTION', 'NUMBER', '{"min": 0.01, "max": 0.2, "step": 0.01}'),
  ('survey.manual_annotation_penalty_reputation_drop', '0.15', 'Surveyor reliability score deduction on staff rejected manual annotation', 'INGESTION', 'NUMBER', '{"min": 0.05, "max": 0.5, "step": 0.01}'),
  ('survey.manual_annotation_consecutive_error_limit', '3', 'Maximum consecutive bogus annotations before temporary annotation lockout', 'INGESTION', 'INTEGER', '{"min": 1, "max": 10, "step": 1}'),
  ('survey.manual_annotation_suspension_cooldown_days', '7', 'Lockout cooldown in days when consecutive annotation error limit is exceeded', 'INGESTION', 'INTEGER', '{"min": 1, "max": 30, "step": 1}'),
  ('survey.manual_annotation_min_reliability_threshold', '0.4', 'Minimum reliability score required to participate in manual sign annotations', 'INGESTION', 'NUMBER', '{"min": 0.1, "max": 0.9, "step": 0.05}'),
  ('survey.reward_scaling_enabled', 'true', 'Scale base surveyor contribution rewards proportionally to surveyor reliability score', 'INGESTION', 'BOOLEAN', '{"allowedValues": [true, false]}'),
  ('survey.reward_scaling_floor_pct', '10.0', 'Minimum percentage floor for scaled surveyor rewards to prevent zero payouts', 'INGESTION', 'NUMBER', '{"min": 0.0, "max": 50.0, "step": 5.0}'),
  ('survey.negative_review_window_hours', '72', 'Time window in hours after NO_SIGN_DETECTED during which annotations are accepted', 'INGESTION', 'INTEGER', '{"min": 1, "max": 168, "step": 1}')
ON CONFLICT (key) DO UPDATE
  SET description = EXCLUDED.description,
      category = EXCLUDED.category,
      data_type = EXCLUDED.data_type,
      validation_rules = EXCLUDED.validation_rules;

-- 7. Ensure active_learning_selections sequence is aligned with existing data
SELECT setval('active_learning_selections_id_seq', (SELECT COALESCE(MAX(id), 1) FROM active_learning_selections));

COMMIT;
