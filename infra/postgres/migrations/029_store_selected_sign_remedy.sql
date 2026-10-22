-- Migration 029: Persist reviewer selection from the AI top-five remedies.
-- The suggestion list remains in possible_signs; these columns record the selected result and audit context.

ALTER TABLE "unverified_sign_candidates"
  ADD COLUMN IF NOT EXISTS "selected_sign_type_id" INT REFERENCES "traffic_sign_types"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "selected_by" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "selected_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "selection_reason" VARCHAR(500);

CREATE INDEX IF NOT EXISTS "idx_unverified_sign_candidates_selected_sign_type"
  ON "unverified_sign_candidates" ("selected_sign_type_id");
