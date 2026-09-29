-- ---------------------------------------------------------------------------
-- Migration 007: Phase 4 Reviewer Reliability & Governance Engine
-- ---------------------------------------------------------------------------

-- 1. Enhance reviewer_profiles with reliability formula & governance fields
ALTER TABLE "reviewer_profiles"
  ADD COLUMN IF NOT EXISTS "total_correct_votes" INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "total_false_votes" INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "consecutive_errors" INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "is_provisional" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "is_review_suspended" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "suspended_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "suspended_until" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "suspension_reason" TEXT;

-- Backfill existing reviewer profile rows
UPDATE "reviewer_profiles"
SET 
  total_correct_votes = correct_reviews,
  total_false_votes = GREATEST(0, total_reviews - correct_reviews),
  is_provisional = CASE WHEN total_reviews < 5 THEN TRUE ELSE FALSE END,
  reliability_score = CASE 
    WHEN total_reviews = 0 THEN 100.00
    WHEN reliability_score <= 1.0 THEN ROUND((reliability_score * 100)::numeric, 2)
    ELSE ROUND(reliability_score::numeric, 2)
  END;

-- Partial index for active reviewer rankings
CREATE INDEX IF NOT EXISTS "idx_reviewer_reliability" 
  ON "reviewer_profiles"("reliability_score") 
  WHERE is_review_suspended = FALSE;

-- 2. Enhance consensus_configs with governance parameters
ALTER TABLE "consensus_configs"
  ADD COLUMN IF NOT EXISTS "weight_correct" FLOAT NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS "penalty_false" FLOAT NOT NULL DEFAULT 2.0,
  ADD COLUMN IF NOT EXISTS "min_sample_baseline" INT NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS "min_reliability_threshold" FLOAT NOT NULL DEFAULT 50.0,
  ADD COLUMN IF NOT EXISTS "consecutive_error_limit" INT NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS "suspension_cooldown_days" INT NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS "provisional_vote_weight" FLOAT NOT NULL DEFAULT 0.5;

-- Update default active consensus config with governance values if present
UPDATE "consensus_configs"
SET 
  weight_correct = 1.0,
  penalty_false = 2.0,
  min_sample_baseline = 5,
  min_reliability_threshold = 50.0,
  consecutive_error_limit = 3,
  suspension_cooldown_days = 7,
  provisional_vote_weight = 0.5
WHERE is_active = TRUE;
