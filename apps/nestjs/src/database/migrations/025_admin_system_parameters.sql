-- 025_admin_system_parameters.sql
-- Add max_votes_limit to consensus_configs and seed default freshness_rules for standard categories

BEGIN;

-- 1. Add max_votes_limit column to consensus_configs
ALTER TABLE consensus_configs
  ADD COLUMN IF NOT EXISTS max_votes_limit integer NOT NULL DEFAULT 9;

-- 2. Seed initial freshness rules for standard categories if none exist for them
INSERT INTO freshness_rules (sign_category_id, freshness_period_days, default_priority, max_proximity_meters, daily_submission_limit, is_active)
SELECT id, 30, 'MEDIUM'::task_priority, 50, 3, true
FROM sign_categories
WHERE code = 'WARNING'
  AND id NOT IN (SELECT sign_category_id FROM freshness_rules WHERE sign_category_id IS NOT NULL);

INSERT INTO freshness_rules (sign_category_id, freshness_period_days, default_priority, max_proximity_meters, daily_submission_limit, is_active)
SELECT id, 30, 'HIGH'::task_priority, 50, 3, true
FROM sign_categories
WHERE code = 'PROHIBITORY'
  AND id NOT IN (SELECT sign_category_id FROM freshness_rules WHERE sign_category_id IS NOT NULL);

INSERT INTO freshness_rules (sign_category_id, freshness_period_days, default_priority, max_proximity_meters, daily_submission_limit, is_active)
SELECT id, 60, 'MEDIUM'::task_priority, 50, 3, true
FROM sign_categories
WHERE code = 'MANDATORY'
  AND id NOT IN (SELECT sign_category_id FROM freshness_rules WHERE sign_category_id IS NOT NULL);

INSERT INTO freshness_rules (sign_category_id, freshness_period_days, default_priority, max_proximity_meters, daily_submission_limit, is_active)
SELECT id, 90, 'LOW'::task_priority, 50, 3, true
FROM sign_categories
WHERE code = 'INFORMATION'
  AND id NOT IN (SELECT sign_category_id FROM freshness_rules WHERE sign_category_id IS NOT NULL);

INSERT INTO freshness_rules (sign_category_id, freshness_period_days, default_priority, max_proximity_meters, daily_submission_limit, is_active)
SELECT id, 14, 'HIGH'::task_priority, 30, 5, true
FROM sign_categories
WHERE code = 'TEMPORARY'
  AND id NOT IN (SELECT sign_category_id FROM freshness_rules WHERE sign_category_id IS NOT NULL);

COMMIT;

