-- Migration 018: Ensure every active SURVEYOR role has its profile row.

INSERT INTO "surveyor_profiles" ("user_id")
SELECT DISTINCT ur."user_id"
FROM "user_roles" ur
JOIN "roles" r ON r."id" = ur."role_id"
WHERE r."code" = 'SURVEYOR'
  AND ur."is_active" = TRUE
ON CONFLICT ("user_id") DO NOTHING;
