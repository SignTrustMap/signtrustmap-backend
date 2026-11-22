-- 029_provisional_autoban_thresholds.sql
-- Add independent provisional (new account) reliability/error thresholds and autoban toggle to consensus_configs

BEGIN;

ALTER TABLE consensus_configs
  ADD COLUMN IF NOT EXISTS provisional_min_reliability_threshold float NOT NULL DEFAULT 40.0,
  ADD COLUMN IF NOT EXISTS provisional_consecutive_error_limit int NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS provisional_auto_ban_enabled boolean NOT NULL DEFAULT true;

COMMIT;
