#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATION_DIR="${SCRIPT_DIR}/../apps/nestjs/src/database/migrations"

if [[ -z "${SPRING_DATABASE_URL:-}" || -z "${DATABASE_URL:-}" ]]; then
  echo "SPRING_DATABASE_URL and DATABASE_URL are required." >&2
  exit 2
fi

for command_name in psql; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "${command_name} is required." >&2
    exit 2
  fi
done

echo "Checking the Spring source schema..."
psql -X --set ON_ERROR_STOP=1 "${SPRING_DATABASE_URL}" \
  --file "${MIGRATION_DIR}/000_preflight_spring_source.sql"

echo "Checking the NestJS target schema and role seeds..."
psql -X --set ON_ERROR_STOP=1 "${DATABASE_URL}" \
  --file "${MIGRATION_DIR}/001_preflight_nest_target.sql"

if [[ "${1:-}" == "--dry-run" ]]; then
  echo "Preflight passed; no data was changed."
  exit 0
fi

if [[ $# -gt 0 ]]; then
  echo "Usage: SPRING_DATABASE_URL=... DATABASE_URL=... $0 [--dry-run]" >&2
  exit 2
fi

echo "Preparing the isolated spring_legacy staging schema..."
psql -X --set ON_ERROR_STOP=1 "${DATABASE_URL}" \
  --file "${MIGRATION_DIR}/002_create_spring_legacy_staging.sql"
psql -X --set ON_ERROR_STOP=1 "${DATABASE_URL}" \
  --command "TRUNCATE spring_legacy.app_user, spring_legacy.user_role, spring_legacy.sign_category, spring_legacy.sign_type, spring_legacy.verified_sign"

copy_table() {
  local table_name="$1"
  local columns="$2"

  echo "Staging ${table_name}..."
  psql -X --set ON_ERROR_STOP=1 "${SPRING_DATABASE_URL}" \
    --command "\\copy (SELECT ${columns} FROM public.${table_name}) TO STDOUT WITH (FORMAT csv, NULL '\\N')" \
    | psql -X --set ON_ERROR_STOP=1 "${DATABASE_URL}" \
        --command "\\copy spring_legacy.${table_name} (${columns}) FROM STDIN WITH (FORMAT csv, NULL '\\N')"
}

copy_table app_user \
  "id,email,display_name,status,created_at,updated_at,version"
copy_table user_role \
  "user_id,role"
copy_table sign_category \
  "id,code,name,description,active,created_at,updated_at,version"
copy_table sign_type \
  "id,code,name,category_id,description,labeling_guidelines,ai_label_prompt,osm_mapping,representative_image_key,active,created_at,updated_at,version"
copy_table verified_sign \
  "id,sign_type_id,location,heading_degrees,traffic_direction,image_object_key,last_verified_at,status,created_at,updated_at,version"

echo "Transforming staged rows in one target transaction..."
psql -X --set ON_ERROR_STOP=1 "${DATABASE_URL}" \
  --file "${MIGRATION_DIR}/003_migrate_spring_legacy_data.sql"

echo "Spring data migration completed. Review spring_legacy.migration_audit for warnings."
