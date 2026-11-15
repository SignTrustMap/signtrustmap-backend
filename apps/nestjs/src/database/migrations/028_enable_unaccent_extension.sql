-- =============================================================================
-- Migration 028: Enable PostgreSQL unaccent extension for accent-insensitive search
-- Supports Vietnamese search with/without accents across catalog & moderation modules
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS unaccent;
