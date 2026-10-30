-- ---------------------------------------------------------------------------
-- Migration 015: Candidate & Evidence Recapture Requests
-- ---------------------------------------------------------------------------

ALTER TYPE candidate_status ADD VALUE IF NOT EXISTS 'RECAPTURE_REQUESTED';

CREATE TABLE IF NOT EXISTS "candidate_recapture_requests" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "candidate_id" UUID NOT NULL REFERENCES "unverified_sign_candidates"("id") ON DELETE CASCADE,
  "reviewer_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "surveyor_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
  "reason" VARCHAR(100) NOT NULL,
  "note" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_candidate_recapture_requests_candidate"
  ON "candidate_recapture_requests" ("candidate_id");

CREATE INDEX IF NOT EXISTS "idx_candidate_recapture_requests_surveyor"
  ON "candidate_recapture_requests" ("surveyor_id");
