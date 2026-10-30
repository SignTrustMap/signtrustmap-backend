-- ---------------------------------------------------------------------------
-- Migration 028: Add possible_signs column for AI top 5 candidate predictions
-- ---------------------------------------------------------------------------

ALTER TABLE "unverified_sign_candidates"
  ADD COLUMN IF NOT EXISTS "possible_signs" JSONB;
