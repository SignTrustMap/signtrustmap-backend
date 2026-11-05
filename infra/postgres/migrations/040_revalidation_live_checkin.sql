-- 040_revalidation_live_checkin.sql
-- Add on-site live capture and GPS accuracy metadata to revalidation_evidences

ALTER TABLE "revalidation_evidences"
  ADD COLUMN IF NOT EXISTS "is_live_capture" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "accuracy_meters" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "heading_degrees" DOUBLE PRECISION;

CREATE INDEX IF NOT EXISTS "idx_revalidation_evidences_live_capture"
  ON "revalidation_evidences" ("is_live_capture");
