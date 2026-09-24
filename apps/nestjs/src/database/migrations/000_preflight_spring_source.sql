\set ON_ERROR_STOP on

DO $preflight$
DECLARE
  missing_tables text[];
  missing_columns text[];
BEGIN
  SELECT array_agg(table_name ORDER BY table_name)
    INTO missing_tables
  FROM unnest(ARRAY[
    'app_user',
    'user_role',
    'sign_category',
    'sign_type',
    'verified_sign'
  ]) AS required(table_name)
  WHERE to_regclass('public.' || table_name) IS NULL;

  IF missing_tables IS NOT NULL THEN
    RAISE EXCEPTION 'Spring source is missing required tables: %', missing_tables;
  END IF;

  SELECT array_agg(required.table_name || '.' || required.column_name
                   ORDER BY required.table_name, required.column_name)
    INTO missing_columns
  FROM (VALUES
    ('app_user', 'id'), ('app_user', 'email'),
    ('app_user', 'display_name'), ('app_user', 'status'),
    ('app_user', 'created_at'), ('app_user', 'updated_at'),
    ('app_user', 'version'),
    ('user_role', 'user_id'), ('user_role', 'role'),
    ('sign_category', 'id'), ('sign_category', 'code'),
    ('sign_category', 'name'), ('sign_category', 'description'),
    ('sign_category', 'active'), ('sign_category', 'created_at'),
    ('sign_category', 'updated_at'), ('sign_category', 'version'),
    ('sign_type', 'id'), ('sign_type', 'code'), ('sign_type', 'name'),
    ('sign_type', 'category_id'), ('sign_type', 'description'),
    ('sign_type', 'labeling_guidelines'), ('sign_type', 'ai_label_prompt'),
    ('sign_type', 'osm_mapping'), ('sign_type', 'representative_image_key'),
    ('sign_type', 'active'), ('sign_type', 'created_at'),
    ('sign_type', 'updated_at'), ('sign_type', 'version'),
    ('verified_sign', 'id'), ('verified_sign', 'sign_type_id'),
    ('verified_sign', 'location'), ('verified_sign', 'heading_degrees'),
    ('verified_sign', 'traffic_direction'),
    ('verified_sign', 'image_object_key'),
    ('verified_sign', 'last_verified_at'), ('verified_sign', 'status'),
    ('verified_sign', 'created_at'), ('verified_sign', 'updated_at'),
    ('verified_sign', 'version')
  ) AS required(table_name, column_name)
  LEFT JOIN information_schema.columns actual
    ON actual.table_schema = 'public'
   AND actual.table_name = required.table_name
   AND actual.column_name = required.column_name
  WHERE actual.column_name IS NULL;

  IF missing_columns IS NOT NULL THEN
    RAISE EXCEPTION 'Spring source is missing required columns: %', missing_columns;
  END IF;
END
$preflight$;

SELECT 'app_user' AS source_table, count(*) AS source_rows FROM app_user
UNION ALL SELECT 'user_role', count(*) FROM user_role
UNION ALL SELECT 'sign_category', count(*) FROM sign_category
UNION ALL SELECT 'sign_type', count(*) FROM sign_type
UNION ALL SELECT 'verified_sign', count(*) FROM verified_sign
ORDER BY source_table;
