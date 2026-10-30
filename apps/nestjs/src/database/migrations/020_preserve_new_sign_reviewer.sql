ALTER TABLE "missing_sign_type_reports"
  ADD COLUMN IF NOT EXISTS "original_reporter_id" uuid;

UPDATE "missing_sign_type_reports"
SET "original_reporter_id" = "reporter_id"
WHERE "original_reporter_id" IS NULL;

ALTER TABLE "missing_sign_type_reports"
  ALTER COLUMN "original_reporter_id" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_missing_sign_type_reports_original_reporter'
  ) THEN
    ALTER TABLE "missing_sign_type_reports"
      ADD CONSTRAINT fk_missing_sign_type_reports_original_reporter
      FOREIGN KEY ("original_reporter_id") REFERENCES "users" ("id")
      DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END
$$;
