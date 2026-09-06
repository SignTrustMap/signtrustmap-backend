\set ON_ERROR_STOP on

DO $preflight$
DECLARE
  missing_tables text[];
  missing_roles text[];
BEGIN
  SELECT array_agg(table_name ORDER BY table_name)
    INTO missing_tables
  FROM unnest(ARRAY[
    'users',
    'roles',
    'user_roles',
    'wallets',
    'sign_categories',
    'traffic_sign_types',
    'sign_type_images',
    'sign_type_ai_prompts',
    'sign_type_osm_mappings',
    'survey_submissions',
    'unverified_sign_candidates',
    'verified_traffic_signs'
  ]) AS required(table_name)
  WHERE to_regclass('public.' || table_name) IS NULL;

  IF missing_tables IS NOT NULL THEN
    RAISE EXCEPTION 'NestJS target is missing required tables: %', missing_tables;
  END IF;

  SELECT array_agg(required.role_code ORDER BY required.role_code)
    INTO missing_roles
  FROM unnest(ARRAY['DRIVER', 'SURVEYOR', 'REVIEWER', 'STAFF', 'ADMIN'])
    AS required(role_code)
  LEFT JOIN roles ON roles.code = required.role_code
  WHERE roles.id IS NULL;

  IF missing_roles IS NOT NULL THEN
    RAISE EXCEPTION 'NestJS target is missing seeded roles: %', missing_roles;
  END IF;
END
$preflight$;

SELECT 'users' AS target_table, count(*) AS target_rows FROM users
UNION ALL SELECT 'sign_categories', count(*) FROM sign_categories
UNION ALL SELECT 'traffic_sign_types', count(*) FROM traffic_sign_types
UNION ALL SELECT 'verified_traffic_signs', count(*) FROM verified_traffic_signs
ORDER BY target_table;
