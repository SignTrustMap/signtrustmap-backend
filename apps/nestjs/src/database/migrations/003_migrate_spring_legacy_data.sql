\set ON_ERROR_STOP on

BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('signtrustmap:spring-data-migration', 0));

DO $validate$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM spring_legacy.app_user source_user
    JOIN users target_user ON target_user.id = source_user.id
    WHERE lower(target_user.email) <> lower(source_user.email)
  ) THEN
    RAISE EXCEPTION 'A Spring user UUID conflicts with a different target user';
  END IF;

  IF EXISTS (
    SELECT lower(target_user.email)
    FROM users target_user
    JOIN spring_legacy.app_user source_user
      ON lower(source_user.email) = lower(target_user.email)
    GROUP BY lower(target_user.email)
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'A Spring email matches multiple target users';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM spring_legacy.user_role source_role
    LEFT JOIN roles target_role ON target_role.code = source_role.role
    WHERE target_role.id IS NULL
  ) THEN
    RAISE EXCEPTION 'A Spring role has no matching seeded target role';
  END IF;
END
$validate$;

DELETE FROM spring_legacy.user_id_map id_map
WHERE NOT EXISTS (SELECT 1 FROM users WHERE users.id = id_map.nest_id);

DO $validate_user_mappings$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM spring_legacy.user_id_map id_map
    JOIN spring_legacy.app_user source_user ON source_user.id = id_map.spring_id
    JOIN users email_match ON lower(email_match.email) = lower(source_user.email)
    WHERE email_match.id <> id_map.nest_id
  ) THEN
    RAISE EXCEPTION 'A persisted Spring user mapping conflicts with a target email';
  END IF;
END
$validate_user_mappings$;

INSERT INTO spring_legacy.user_id_map (spring_id, nest_id)
SELECT source_user.id, target_user.id
FROM spring_legacy.app_user source_user
JOIN users target_user
  ON target_user.id = source_user.id
  OR lower(target_user.email) = lower(source_user.email)
ON CONFLICT (spring_id) DO NOTHING;

INSERT INTO users (
  id, email, password_hash, full_name, status, created_at, updated_at
)
SELECT
  source_user.id,
  source_user.email,
  NULL,
  source_user.display_name,
  CASE source_user.status
    WHEN 'DISABLED' THEN 'SUSPENDED'
    ELSE source_user.status
  END::user_status,
  source_user.created_at,
  source_user.updated_at
FROM spring_legacy.app_user source_user
LEFT JOIN spring_legacy.user_id_map id_map ON id_map.spring_id = source_user.id
WHERE id_map.spring_id IS NULL;

INSERT INTO spring_legacy.user_id_map (spring_id, nest_id)
SELECT source_user.id, source_user.id
FROM spring_legacy.app_user source_user
ON CONFLICT (spring_id) DO NOTHING;

UPDATE users target_user
SET email = source_user.email,
    full_name = source_user.display_name,
    status = CASE source_user.status
      WHEN 'DISABLED' THEN 'SUSPENDED'
      ELSE source_user.status
    END::user_status,
    updated_at = source_user.updated_at
FROM spring_legacy.app_user source_user
JOIN spring_legacy.user_id_map id_map ON id_map.spring_id = source_user.id
WHERE target_user.id = id_map.nest_id;

INSERT INTO user_roles (user_id, role_id, is_active, assigned_at)
SELECT id_map.nest_id, target_role.id, true, now()
FROM spring_legacy.user_role source_role
JOIN spring_legacy.user_id_map id_map ON id_map.spring_id = source_role.user_id
JOIN roles target_role ON target_role.code = source_role.role
ON CONFLICT (user_id, role_id) DO UPDATE SET is_active = true;

INSERT INTO wallets (user_id, balance)
SELECT nest_id, 0 FROM spring_legacy.user_id_map
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO reviewer_profiles (user_id)
SELECT DISTINCT id_map.nest_id
FROM spring_legacy.user_role source_role
JOIN spring_legacy.user_id_map id_map ON id_map.spring_id = source_role.user_id
WHERE source_role.role = 'REVIEWER'
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO surveyor_profiles (user_id)
SELECT DISTINCT id_map.nest_id
FROM spring_legacy.user_role source_role
JOIN spring_legacy.user_id_map id_map ON id_map.spring_id = source_role.user_id
WHERE source_role.role = 'SURVEYOR'
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO driver_profiles (user_id)
SELECT DISTINCT id_map.nest_id
FROM spring_legacy.user_role source_role
JOIN spring_legacy.user_id_map id_map ON id_map.spring_id = source_role.user_id
WHERE source_role.role = 'DRIVER'
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO staff_profiles (user_id)
SELECT DISTINCT id_map.nest_id
FROM spring_legacy.user_role source_role
JOIN spring_legacy.user_id_map id_map ON id_map.spring_id = source_role.user_id
WHERE source_role.role = 'STAFF'
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO admin_profiles (user_id)
SELECT DISTINCT id_map.nest_id
FROM spring_legacy.user_role source_role
JOIN spring_legacy.user_id_map id_map ON id_map.spring_id = source_role.user_id
WHERE source_role.role = 'ADMIN'
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO spring_legacy.migration_state (key, value)
SELECT
  'system_user_id',
  COALESCE(
    (SELECT id::text FROM users WHERE email = 'spring-migration@signtrustmap.local'),
    gen_random_uuid()::text
  )
WHERE EXISTS (SELECT 1 FROM spring_legacy.verified_sign)
ON CONFLICT (key) DO NOTHING;

UPDATE spring_legacy.migration_state state
SET value = existing_user.id::text
FROM users existing_user
WHERE state.key = 'system_user_id'
  AND existing_user.email = 'spring-migration@signtrustmap.local';

INSERT INTO users (id, email, full_name, status)
SELECT
  value::uuid,
  'spring-migration@signtrustmap.local',
  'Spring data migration',
  'ACTIVE'
FROM spring_legacy.migration_state
WHERE key = 'system_user_id'
ON CONFLICT (email) DO NOTHING;

INSERT INTO wallets (user_id, balance)
SELECT value::uuid, 0
FROM spring_legacy.migration_state
WHERE key = 'system_user_id'
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO sign_categories (code, name_vi, name_en, description)
SELECT source_category.code, source_category.name, source_category.name,
       source_category.description
FROM spring_legacy.sign_category source_category
LEFT JOIN sign_categories target_category
  ON target_category.code = source_category.code
WHERE target_category.id IS NULL;

INSERT INTO spring_legacy.category_id_map (spring_id, nest_id)
SELECT source_category.id, target_category.id
FROM spring_legacy.sign_category source_category
JOIN sign_categories target_category ON target_category.code = source_category.code
ON CONFLICT (spring_id) DO UPDATE SET nest_id = EXCLUDED.nest_id;

INSERT INTO traffic_sign_types (
  category_id, sign_code, name_vi, name_en, description,
  labeling_guidelines, is_active, created_at, updated_at
)
SELECT
  category_map.nest_id,
  source_type.code,
  source_type.name,
  source_type.name,
  source_type.description,
  source_type.labeling_guidelines,
  source_type.active,
  source_type.created_at,
  source_type.updated_at
FROM spring_legacy.sign_type source_type
JOIN spring_legacy.category_id_map category_map
  ON category_map.spring_id = source_type.category_id
LEFT JOIN traffic_sign_types target_type
  ON target_type.sign_code = source_type.code
WHERE target_type.id IS NULL;

INSERT INTO spring_legacy.sign_type_id_map (spring_id, nest_id)
SELECT source_type.id, target_type.id
FROM spring_legacy.sign_type source_type
JOIN traffic_sign_types target_type ON target_type.sign_code = source_type.code
ON CONFLICT (spring_id) DO UPDATE SET nest_id = EXCLUDED.nest_id;

INSERT INTO sign_type_ai_prompts (
  sign_type_id, prompt_text, target_model, version, is_active, created_at
)
SELECT type_map.nest_id, source_type.ai_label_prompt, 'CLIP', 1, true,
       source_type.created_at
FROM spring_legacy.sign_type source_type
JOIN spring_legacy.sign_type_id_map type_map ON type_map.spring_id = source_type.id
WHERE nullif(btrim(source_type.ai_label_prompt), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sign_type_ai_prompts prompt
    WHERE prompt.sign_type_id = type_map.nest_id
      AND prompt.prompt_text = source_type.ai_label_prompt
  );

INSERT INTO sign_type_images (
  sign_type_id, image_url, image_type, is_primary, uploaded_at
)
SELECT type_map.nest_id, source_type.representative_image_key,
       'REPRESENTATIVE', true, source_type.created_at
FROM spring_legacy.sign_type source_type
JOIN spring_legacy.sign_type_id_map type_map ON type_map.spring_id = source_type.id
WHERE nullif(btrim(source_type.representative_image_key), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sign_type_images image
    WHERE image.sign_type_id = type_map.nest_id
      AND image.image_url = source_type.representative_image_key
  );

INSERT INTO sign_type_osm_mappings (sign_type_id, osm_key, osm_value)
SELECT
  type_map.nest_id,
  btrim(split_part(source_type.osm_mapping, '=', 1)),
  btrim(substr(source_type.osm_mapping, strpos(source_type.osm_mapping, '=') + 1))
FROM spring_legacy.sign_type source_type
JOIN spring_legacy.sign_type_id_map type_map ON type_map.spring_id = source_type.id
WHERE source_type.osm_mapping ~ '^[^=]{1,100}=[^=]{1,100}$'
  AND nullif(btrim(split_part(source_type.osm_mapping, '=', 1)), '') IS NOT NULL
  AND nullif(btrim(substr(source_type.osm_mapping, strpos(source_type.osm_mapping, '=') + 1)), '') IS NOT NULL
ON CONFLICT (sign_type_id, osm_key) DO NOTHING;

INSERT INTO spring_legacy.migration_state (key, value)
SELECT 'submission_id', gen_random_uuid()::text
WHERE EXISTS (SELECT 1 FROM spring_legacy.verified_sign)
ON CONFLICT (key) DO NOTHING;

INSERT INTO survey_submissions (
  id, surveyor_id, submission_type, status, captured_at, coordinate_source,
  note, total_candidates_extracted
)
SELECT
  submission_state.value::uuid,
  user_state.value::uuid,
  'SINGLE_IMAGE',
  'COMPLETED',
  now(),
  'MANUAL',
  'Synthetic submission created by the Spring data migration',
  (SELECT count(*) FROM spring_legacy.verified_sign)
FROM spring_legacy.migration_state submission_state
CROSS JOIN spring_legacy.migration_state user_state
WHERE submission_state.key = 'submission_id'
  AND user_state.key = 'system_user_id'
ON CONFLICT (id) DO UPDATE SET
  total_candidates_extracted = EXCLUDED.total_candidates_extracted,
  updated_at = now();

INSERT INTO spring_legacy.verified_sign_id_map (spring_id, nest_id, candidate_id)
SELECT
  source_sign.id,
  CASE
    WHEN target_sign.id IS NULL THEN source_sign.id
    ELSE md5('spring-sign:' || source_sign.id::text)::uuid
  END,
  md5('spring-candidate:' || source_sign.id::text)::uuid
FROM spring_legacy.verified_sign source_sign
LEFT JOIN verified_traffic_signs target_sign ON target_sign.id = source_sign.id
LEFT JOIN spring_legacy.verified_sign_id_map existing_map
  ON existing_map.spring_id = source_sign.id
WHERE existing_map.spring_id IS NULL;

INSERT INTO unverified_sign_candidates (
  id, submission_id, predicted_sign_type_id, confidence_score,
  best_frame_url, sign_crop_url, spatial_confidence,
  active_learning_priority, status, created_at
)
SELECT
  sign_map.candidate_id,
  submission_state.value::uuid,
  type_map.nest_id,
  1,
  COALESCE(nullif(source_sign.image_object_key, ''),
           'legacy://verified-sign/' || source_sign.id::text),
  COALESCE(nullif(source_sign.image_object_key, ''),
           'legacy://verified-sign/' || source_sign.id::text),
  'HIGH',
  0,
  'VERIFIED',
  source_sign.created_at
FROM spring_legacy.verified_sign source_sign
JOIN spring_legacy.verified_sign_id_map sign_map
  ON sign_map.spring_id = source_sign.id
JOIN spring_legacy.sign_type_id_map type_map
  ON type_map.spring_id = source_sign.sign_type_id
CROSS JOIN spring_legacy.migration_state submission_state
WHERE submission_state.key = 'submission_id'
ON CONFLICT (id) DO UPDATE SET
  predicted_sign_type_id = EXCLUDED.predicted_sign_type_id,
  best_frame_url = EXCLUDED.best_frame_url,
  sign_crop_url = EXCLUDED.sign_crop_url,
  status = 'VERIFIED';

INSERT INTO verified_traffic_signs (
  id, sign_type_id, origin_candidate_id, location, traffic_direction,
  sign_crop_url, status, freshness_score, last_verified_at,
  created_at, updated_at
)
SELECT
  sign_map.nest_id,
  type_map.nest_id,
  sign_map.candidate_id,
  source_sign.location,
  source_sign.heading_degrees,
  COALESCE(nullif(source_sign.image_object_key, ''),
           'legacy://verified-sign/' || source_sign.id::text),
  CASE source_sign.status
    WHEN 'DISPUTED' THEN 'STALE'
    ELSE source_sign.status
  END::sign_lifecycle_status,
  CASE source_sign.status
    WHEN 'RETIRED' THEN 0
    WHEN 'DISPUTED' THEN 0.5
    ELSE 1
  END,
  source_sign.last_verified_at,
  source_sign.created_at,
  source_sign.updated_at
FROM spring_legacy.verified_sign source_sign
JOIN spring_legacy.verified_sign_id_map sign_map
  ON sign_map.spring_id = source_sign.id
JOIN spring_legacy.sign_type_id_map type_map
  ON type_map.spring_id = source_sign.sign_type_id
ON CONFLICT (id) DO UPDATE SET
  sign_type_id = EXCLUDED.sign_type_id,
  origin_candidate_id = EXCLUDED.origin_candidate_id,
  location = EXCLUDED.location,
  traffic_direction = EXCLUDED.traffic_direction,
  sign_crop_url = EXCLUDED.sign_crop_url,
  status = EXCLUDED.status,
  freshness_score = EXCLUDED.freshness_score,
  last_verified_at = EXCLUDED.last_verified_at,
  updated_at = EXCLUDED.updated_at;

INSERT INTO spring_legacy.migration_audit (
  entity_type, source_id, target_id, warnings, source_snapshot, migrated_at
)
SELECT
  'user', source_user.id, id_map.nest_id::text,
  CASE WHEN source_user.status = 'DISABLED'
    THEN ARRAY['DISABLED mapped to SUSPENDED']::text[]
    ELSE ARRAY[]::text[]
  END,
  jsonb_build_object('email', source_user.email, 'status', source_user.status),
  now()
FROM spring_legacy.app_user source_user
JOIN spring_legacy.user_id_map id_map ON id_map.spring_id = source_user.id
ON CONFLICT (entity_type, source_id) DO UPDATE SET
  target_id = EXCLUDED.target_id,
  warnings = EXCLUDED.warnings,
  source_snapshot = EXCLUDED.source_snapshot,
  migrated_at = EXCLUDED.migrated_at;

INSERT INTO spring_legacy.migration_audit (
  entity_type, source_id, target_id, warnings, source_snapshot, migrated_at
)
SELECT
  'sign_category', source_category.id, category_map.nest_id::text,
  CASE WHEN NOT source_category.active
    THEN ARRAY['inactive flag has no target category field']::text[]
    ELSE ARRAY[]::text[]
  END,
  jsonb_build_object('code', source_category.code, 'active', source_category.active),
  now()
FROM spring_legacy.sign_category source_category
JOIN spring_legacy.category_id_map category_map
  ON category_map.spring_id = source_category.id
ON CONFLICT (entity_type, source_id) DO UPDATE SET
  target_id = EXCLUDED.target_id,
  warnings = EXCLUDED.warnings,
  source_snapshot = EXCLUDED.source_snapshot,
  migrated_at = EXCLUDED.migrated_at;

INSERT INTO spring_legacy.migration_audit (
  entity_type, source_id, target_id, warnings, source_snapshot, migrated_at
)
SELECT
  'sign_type', source_type.id, type_map.nest_id::text,
  array_remove(ARRAY[
    CASE
      WHEN nullif(btrim(source_type.osm_mapping), '') IS NOT NULL
       AND source_type.osm_mapping !~ '^[^=]{1,100}=[^=]{1,100}$'
      THEN 'osm_mapping retained in audit only; expected key=value with each part <= 100 chars'
    END
  ]::text[], NULL),
  jsonb_build_object(
    'code', source_type.code,
    'active', source_type.active,
    'osm_mapping', source_type.osm_mapping
  ),
  now()
FROM spring_legacy.sign_type source_type
JOIN spring_legacy.sign_type_id_map type_map ON type_map.spring_id = source_type.id
ON CONFLICT (entity_type, source_id) DO UPDATE SET
  target_id = EXCLUDED.target_id,
  warnings = EXCLUDED.warnings,
  source_snapshot = EXCLUDED.source_snapshot,
  migrated_at = EXCLUDED.migrated_at;

INSERT INTO spring_legacy.migration_audit (
  entity_type, source_id, target_id, warnings, source_snapshot, migrated_at
)
SELECT
  'verified_sign', source_sign.id, sign_map.nest_id::text,
  array_remove(ARRAY[
    CASE WHEN nullif(source_sign.image_object_key, '') IS NULL
      THEN 'missing image replaced with deterministic legacy:// fallback'
    END,
    CASE WHEN source_sign.status = 'DISPUTED'
      THEN 'DISPUTED mapped to STALE'
    END,
    'traffic_direction enum retained in audit; numeric heading migrated when present'
  ]::text[], NULL),
  jsonb_build_object(
    'traffic_direction', source_sign.traffic_direction,
    'heading_degrees', source_sign.heading_degrees,
    'status', source_sign.status,
    'image_object_key', source_sign.image_object_key,
    'synthetic_candidate_id', sign_map.candidate_id
  ),
  now()
FROM spring_legacy.verified_sign source_sign
JOIN spring_legacy.verified_sign_id_map sign_map
  ON sign_map.spring_id = source_sign.id
ON CONFLICT (entity_type, source_id) DO UPDATE SET
  target_id = EXCLUDED.target_id,
  warnings = EXCLUDED.warnings,
  source_snapshot = EXCLUDED.source_snapshot,
  migrated_at = EXCLUDED.migrated_at;

COMMIT;

SELECT
  entity_type,
  count(*) AS migrated_rows,
  count(*) FILTER (WHERE cardinality(warnings) > 0) AS rows_with_warnings
FROM spring_legacy.migration_audit
GROUP BY entity_type
ORDER BY entity_type;
