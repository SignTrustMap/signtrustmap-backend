-- 048_revalidation_governance_params.sql
-- Seed dynamic system parameters for Revalidation reward attribution, Driver reporter reward, and evidence upload limits.

BEGIN;

INSERT INTO "system_parameters" ("key", "value", "description", "category", "data_type", "validation_rules") VALUES
  (
    'revalidation.reward_policy',
    'ALIGNED_ONLY',
    'Reward attribution policy when multiple surveyors submit revalidation evidence: ALIGNED_ONLY (all aligned submitters), FIRST_VALID (earliest aligned submitter only), or SPLIT_EQUAL (split task bounty equally among aligned submitters)',
    'REVALIDATION',
    'STRING',
    '{"allowedValues": ["ALIGNED_ONLY", "FIRST_VALID", "SPLIT_EQUAL"]}'::jsonb
  ),
  (
    'revalidation.reporter_reward_credits',
    '10',
    'Credit reward granted to the driver who initially reported a missing/outdated sign once revalidation consensus confirms REMOVED or CHANGED',
    'REVALIDATION',
    'INTEGER',
    '{"min": 0, "max": 200, "step": 5}'::jsonb
  ),
  (
    'revalidation.max_evidence_size_mb',
    '20',
    'Maximum image file size in megabytes accepted for revalidation evidence uploads',
    'REVALIDATION',
    'INTEGER',
    '{"min": 1, "max": 50, "step": 1}'::jsonb
  )
ON CONFLICT ("key") DO UPDATE
  SET "category" = EXCLUDED."category",
      "data_type" = EXCLUDED."data_type",
      "validation_rules" = EXCLUDED."validation_rules",
      "description" = EXCLUDED."description";

COMMIT;
