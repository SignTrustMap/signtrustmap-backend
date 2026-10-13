-- Migration 026: Candidate recapture report association and consumption state.
-- This migration is intentionally idempotent. It refuses to proceed when
-- existing active duplicates would violate the new one-active-request rule.

ALTER TYPE "candidate_status" ADD VALUE IF NOT EXISTS 'RECAPTURE_REQUESTED';

CREATE TABLE IF NOT EXISTS "candidate_recapture_requests" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "candidate_id" UUID NOT NULL REFERENCES "unverified_sign_candidates"("id") ON DELETE CASCADE,
  "reviewer_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "surveyor_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "missing_type_report_id" UUID,
  "reason" VARCHAR(100) NOT NULL,
  "note" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "completed_at" TIMESTAMPTZ
);

ALTER TABLE "candidate_recapture_requests"
  ADD COLUMN IF NOT EXISTS "missing_type_report_id" UUID;
ALTER TABLE "candidate_recapture_requests"
  ADD COLUMN IF NOT EXISTS "completed_at" TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'candidate_recapture_requests'::regclass
      AND contype = 'f'
      AND confrelid = 'missing_sign_type_reports'::regclass
      AND pg_get_constraintdef(oid) LIKE '%(missing_type_report_id)%'
  ) THEN
    ALTER TABLE "candidate_recapture_requests"
      ADD CONSTRAINT "fk_candidate_recapture_requests_report"
      FOREIGN KEY ("missing_type_report_id")
      REFERENCES "missing_sign_type_reports"("id") ON DELETE SET NULL;
  END IF;
END $$;

DO $$
DECLARE duplicate_candidates TEXT;
BEGIN
  SELECT string_agg(candidate_id::text, ', ' ORDER BY candidate_id)
    INTO duplicate_candidates
  FROM (
    SELECT candidate_id
    FROM candidate_recapture_requests
    WHERE completed_at IS NULL
    GROUP BY candidate_id
    HAVING COUNT(*) > 1
  ) duplicates;

  IF duplicate_candidates IS NOT NULL THEN
    RAISE EXCEPTION
      'Migration 026 aborted: active duplicate recapture requests exist for candidate(s): %. Reconcile these records manually before rerunning migration 026.',
      duplicate_candidates;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_candidate_recapture_requests_candidate"
  ON "candidate_recapture_requests" ("candidate_id");
CREATE INDEX IF NOT EXISTS "idx_candidate_recapture_requests_surveyor"
  ON "candidate_recapture_requests" ("surveyor_id");
CREATE INDEX IF NOT EXISTS "idx_candidate_recapture_requests_report"
  ON "candidate_recapture_requests" ("missing_type_report_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_candidate_recapture_requests_one_active"
  ON "candidate_recapture_requests" ("candidate_id")
  WHERE "completed_at" IS NULL;
