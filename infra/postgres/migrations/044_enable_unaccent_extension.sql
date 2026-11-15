-- 044_enable_unaccent_extension.sql
-- Enable PostgreSQL unaccent extension for accent-insensitive search

BEGIN;

CREATE EXTENSION IF NOT EXISTS unaccent;

COMMIT;

