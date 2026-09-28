-- Phase 1: Double-Entry Wallet & Ledger Enhancements

-- 1. Extend transaction_type enum with new gamification events
ALTER TYPE "transaction_type" ADD VALUE IF NOT EXISTS 'SIGN_DECOMMISSION_REWARD';
ALTER TYPE "transaction_type" ADD VALUE IF NOT EXISTS 'HAZARD_REPORT_REWARD';
ALTER TYPE "transaction_type" ADD VALUE IF NOT EXISTS 'HAZARD_CONFIRM_REWARD';
ALTER TYPE "transaction_type" ADD VALUE IF NOT EXISTS 'CUSTOM_PROFILE_SPEND';
ALTER TYPE "transaction_type" ADD VALUE IF NOT EXISTS 'REWARD_WITHHELD';

-- 2. Add is_frozen flag to wallets table
ALTER TABLE "wallets" ADD COLUMN IF NOT EXISTS "is_frozen" BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. Enhance credit_transactions with double-entry audit fields
ALTER TABLE "credit_transactions" ADD COLUMN IF NOT EXISTS "balance_after" BIGINT;
ALTER TABLE "credit_transactions" ADD COLUMN IF NOT EXISTS "idempotency_key" VARCHAR(128);
ALTER TABLE "credit_transactions" ADD COLUMN IF NOT EXISTS "metadata" JSONB DEFAULT '{}'::jsonb;

-- 4. Unique index for idempotency replay protection
CREATE UNIQUE INDEX IF NOT EXISTS "idx_credit_transactions_idempotency_key"
    ON "credit_transactions" ("idempotency_key")
    WHERE "idempotency_key" IS NOT NULL;

-- 5. Additional index for wallet transaction query performance
CREATE INDEX IF NOT EXISTS "idx_credit_transactions_wallet_created"
    ON "credit_transactions" ("wallet_id", "created_at" DESC);
