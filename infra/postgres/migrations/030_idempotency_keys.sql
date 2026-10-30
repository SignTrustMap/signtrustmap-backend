-- Migration 030: Retry-safe keys for user-created workflows.
-- Keys are optional for backward compatibility and scoped to the owning aggregate.

ALTER TABLE "survey_submissions"
  ADD COLUMN IF NOT EXISTS "idempotency_key" VARCHAR(128);

ALTER TABLE "upload_sessions"
  ADD COLUMN IF NOT EXISTS "idempotency_key" VARCHAR(128);

ALTER TABLE "candidate_recapture_requests"
  ADD COLUMN IF NOT EXISTS "idempotency_key" VARCHAR(128),
  ADD COLUMN IF NOT EXISTS "submission_idempotency_key" VARCHAR(128);

ALTER TABLE "payment_orders"
  ADD COLUMN IF NOT EXISTS "idempotency_key" VARCHAR(128);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_survey_submissions_user_idempotency"
  ON "survey_submissions" ("surveyor_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_upload_sessions_user_idempotency"
  ON "upload_sessions" ("user_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_candidate_recapture_request_idempotency"
  ON "candidate_recapture_requests" ("reviewer_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_candidate_recapture_submission_idempotency"
  ON "candidate_recapture_requests" ("candidate_id", "submission_idempotency_key")
  WHERE "submission_idempotency_key" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_payment_orders_user_idempotency"
  ON "payment_orders" ("user_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_upload_chunks_session_chunk"
  ON "upload_chunks" ("session_id", "chunk_index");
