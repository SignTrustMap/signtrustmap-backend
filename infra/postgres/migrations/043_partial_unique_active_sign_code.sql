-- 043_partial_unique_active_sign_code.sql
-- Allow duplicate sign_code for inactive signs, while enforcing uniqueness for active signs.

BEGIN;

-- 1. Drop existing global unique constraints/indexes on sign_code
ALTER TABLE "traffic_sign_types" DROP CONSTRAINT IF EXISTS "traffic_sign_types_sign_code_key";
ALTER TABLE "traffic_sign_types" DROP CONSTRAINT IF EXISTS "UQ_traffic_sign_types_sign_code";
ALTER TABLE "traffic_sign_types" DROP CONSTRAINT IF EXISTS "uq_traffic_sign_types_sign_code";

DROP INDEX IF EXISTS "traffic_sign_types_sign_code_key";
DROP INDEX IF EXISTS "UQ_traffic_sign_types_sign_code";
DROP INDEX IF EXISTS "uq_traffic_sign_types_sign_code";
DROP INDEX IF EXISTS "uq_traffic_sign_types_active_sign_code";

-- 2. Create partial unique index: only active signs must have unique sign_code (case-insensitive)
CREATE UNIQUE INDEX "uq_traffic_sign_types_active_sign_code"
  ON "traffic_sign_types" (LOWER("sign_code"))
  WHERE "is_active" = true;

COMMIT;
