-- =============================================================================
-- Migration 034: Ensure auth_otp_tokens, reviewer_skipped_candidates,
-- and sign_confirmations tables exist.
-- Eliminates runtime DDL executions from application service layers.
-- =============================================================================

CREATE TABLE IF NOT EXISTS "auth_otp_tokens" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" VARCHAR(255) NOT NULL,
  "otp" VARCHAR(10) NOT NULL,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "used" BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_auth_otp_email" 
  ON "auth_otp_tokens" ("email", "used", "expires_at");

CREATE TABLE IF NOT EXISTS "reviewer_skipped_candidates" (
  "reviewer_id" UUID NOT NULL,
  "candidate_id" UUID NOT NULL,
  "skipped_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("reviewer_id", "candidate_id")
);

CREATE TABLE IF NOT EXISTS "sign_confirmations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "sign_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "is_present" BOOLEAN NOT NULL,
  "credits_awarded" INT NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_sign_confirmations_sign_user" 
  ON "sign_confirmations" ("sign_id", "user_id", "created_at" DESC);

ALTER TABLE "verified_traffic_signs" 
  ADD COLUMN IF NOT EXISTS "confirmation_count" INT NOT NULL DEFAULT 0;
