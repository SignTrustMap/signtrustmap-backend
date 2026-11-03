-- =============================================================================
-- 038_remove_mock_traffic_sign_category.sql
-- Remove legacy MOCK_TRAFFIC_SIGNS category from database
-- =============================================================================

BEGIN;

-- 1. Reassign foreign keys in new_sign_type_reports
UPDATE "new_sign_type_reports"
SET "proposed_category_id" = NULL
WHERE "proposed_category_id" IN (SELECT "id" FROM "sign_categories" WHERE "code" IN ('MOCK_TRAFFIC_SIGNS', 'MOCK'));

-- 2. Remove any freshness_rules referencing mock categories
DELETE FROM "freshness_rules"
WHERE "sign_category_id" IN (SELECT "id" FROM "sign_categories" WHERE "code" IN ('MOCK_TRAFFIC_SIGNS', 'MOCK'));

-- 3. Reassign any traffic sign types to standard PROHIBITORY / PROHIBITION if any reference it
UPDATE "traffic_sign_types"
SET "category_id" = COALESCE(
  (SELECT "id" FROM "sign_categories" WHERE "code" IN ('PROHIBITORY', 'PROHIBITION') LIMIT 1),
  "category_id"
)
WHERE "category_id" IN (SELECT "id" FROM "sign_categories" WHERE "code" IN ('MOCK_TRAFFIC_SIGNS', 'MOCK'));

-- 4. Delete the MOCK_TRAFFIC_SIGNS category
DELETE FROM "sign_categories" WHERE "code" IN ('MOCK_TRAFFIC_SIGNS', 'MOCK');

COMMIT;
