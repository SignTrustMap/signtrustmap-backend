-- 034_mlops_model_promotion_gate_params.sql
-- Seed configurable AI model promotion gate thresholds (Issue #9) in system_parameters.

BEGIN;

INSERT INTO "system_parameters" ("key", "value", "description", "category", "data_type", "validation_rules") VALUES
  (
    'ai.model.min_map50',
    '0.75',
    'Minimum mAP50 evaluation score required before promoting a candidate AI model version to production',
    'AIOPS',
    'NUMBER',
    '{"min": 0.1, "max": 0.99, "step": 0.01}'::jsonb
  ),
  (
    'ai.model.max_metric_regression',
    '0.02',
    'Maximum allowed mAP50 drop relative to the currently active model version before blocking promotion',
    'AIOPS',
    'NUMBER',
    '{"min": 0.0, "max": 0.25, "step": 0.01}'::jsonb
  )
ON CONFLICT ("key") DO UPDATE
  SET "category" = EXCLUDED."category",
      "data_type" = EXCLUDED."data_type",
      "validation_rules" = EXCLUDED."validation_rules",
      "description" = EXCLUDED."description";

COMMIT;
