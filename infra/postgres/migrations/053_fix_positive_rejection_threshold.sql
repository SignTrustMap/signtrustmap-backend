-- Migration: Fix positive/non-negative rejection_threshold values in consensus_configs
-- Consensus scoring compares weighted vote sum (score <= rejection_threshold), so rejection_threshold must be <= -0.1.
BEGIN;

UPDATE "consensus_configs"
SET "rejection_threshold" = CASE
  WHEN "rejection_threshold" > 0 THEN -ABS("rejection_threshold")
  ELSE -0.5
END
WHERE "rejection_threshold" > -0.1;

COMMIT;
