CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE app_user (
    id UUID PRIMARY KEY,
    email VARCHAR(320) NOT NULL,
    display_name VARCHAR(120) NOT NULL,
    status VARCHAR(20) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT ck_app_user_status
        CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DISABLED'))
);

CREATE UNIQUE INDEX uq_app_user_email_lower ON app_user (LOWER(email));

CREATE TABLE user_role (
    user_id UUID NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
    role VARCHAR(30) NOT NULL,
    PRIMARY KEY (user_id, role),
    CONSTRAINT ck_user_role
        CHECK (role IN ('DRIVER', 'SURVEYOR', 'REVIEWER', 'STAFF', 'ADMIN'))
);

CREATE TABLE sign_category (
    id UUID PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(120) NOT NULL,
    description VARCHAR(1000),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    version BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE sign_type (
    id UUID PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(160) NOT NULL,
    category_id UUID NOT NULL REFERENCES sign_category (id),
    description VARCHAR(2000),
    labeling_guidelines VARCHAR(4000),
    ai_label_prompt VARCHAR(1000),
    osm_mapping VARCHAR(1000),
    representative_image_key VARCHAR(500),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    version BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX ix_sign_type_category ON sign_type (category_id);
CREATE INDEX ix_sign_type_active_name ON sign_type (active, name);

CREATE TABLE verified_sign (
    id UUID PRIMARY KEY,
    sign_type_id UUID NOT NULL REFERENCES sign_type (id),
    location geometry(Point, 4326) NOT NULL,
    heading_degrees DOUBLE PRECISION,
    traffic_direction VARCHAR(20) NOT NULL,
    image_object_key VARCHAR(500),
    last_verified_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(20) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT ck_verified_sign_heading
        CHECK (heading_degrees IS NULL OR (heading_degrees >= 0 AND heading_degrees < 360)),
    CONSTRAINT ck_verified_sign_direction
        CHECK (traffic_direction IN ('FORWARD', 'REVERSE', 'BOTH', 'UNKNOWN')),
    CONSTRAINT ck_verified_sign_status
        CHECK (status IN ('ACTIVE', 'DISPUTED', 'RETIRED'))
);

CREATE INDEX ix_verified_sign_location ON verified_sign USING GIST (location);
CREATE INDEX ix_verified_sign_type_status ON verified_sign (sign_type_id, status);
CREATE INDEX ix_verified_sign_last_verified ON verified_sign (last_verified_at);
