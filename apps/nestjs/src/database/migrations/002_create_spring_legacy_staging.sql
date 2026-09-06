\set ON_ERROR_STOP on

CREATE SCHEMA IF NOT EXISTS spring_legacy;

CREATE TABLE IF NOT EXISTS spring_legacy.app_user (
  id uuid PRIMARY KEY,
  email varchar(320) NOT NULL,
  display_name varchar(120) NOT NULL,
  status varchar(20) NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS spring_legacy.user_role (
  user_id uuid NOT NULL,
  role varchar(30) NOT NULL,
  PRIMARY KEY (user_id, role)
);

CREATE TABLE IF NOT EXISTS spring_legacy.sign_category (
  id uuid PRIMARY KEY,
  code varchar(50) NOT NULL,
  name varchar(120) NOT NULL,
  description varchar(1000),
  active boolean NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS spring_legacy.sign_type (
  id uuid PRIMARY KEY,
  code varchar(50) NOT NULL,
  name varchar(160) NOT NULL,
  category_id uuid NOT NULL,
  description varchar(2000),
  labeling_guidelines varchar(4000),
  ai_label_prompt varchar(1000),
  osm_mapping varchar(1000),
  representative_image_key varchar(500),
  active boolean NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS spring_legacy.verified_sign (
  id uuid PRIMARY KEY,
  sign_type_id uuid NOT NULL,
  location geometry(Point, 4326) NOT NULL,
  heading_degrees double precision,
  traffic_direction varchar(20) NOT NULL,
  image_object_key varchar(500),
  last_verified_at timestamptz NOT NULL,
  status varchar(20) NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS spring_legacy.user_id_map (
  spring_id uuid PRIMARY KEY,
  nest_id uuid UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS spring_legacy.category_id_map (
  spring_id uuid PRIMARY KEY,
  nest_id int UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS spring_legacy.sign_type_id_map (
  spring_id uuid PRIMARY KEY,
  nest_id int UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS spring_legacy.verified_sign_id_map (
  spring_id uuid PRIMARY KEY,
  nest_id uuid UNIQUE NOT NULL,
  candidate_id uuid UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS spring_legacy.migration_state (
  key text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS spring_legacy.migration_audit (
  entity_type text NOT NULL,
  source_id uuid NOT NULL,
  target_id text NOT NULL,
  warnings text[] NOT NULL DEFAULT '{}',
  source_snapshot jsonb NOT NULL DEFAULT '{}',
  migrated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_type, source_id)
);
