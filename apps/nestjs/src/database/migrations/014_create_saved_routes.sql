-- ---------------------------------------------------------------------------
-- Migration 014: Saved Routes (Route Wishlist & Vehicle Mode Preferences)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "saved_routes" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "title" VARCHAR(120) NOT NULL,
  "vehicle_mode" VARCHAR(20) NOT NULL DEFAULT 'MOTORCYCLE',
  "origin_name" VARCHAR(255) NOT NULL,
  "origin_latitude" DOUBLE PRECISION NOT NULL,
  "origin_longitude" DOUBLE PRECISION NOT NULL,
  "destination_name" VARCHAR(255) NOT NULL,
  "destination_latitude" DOUBLE PRECISION NOT NULL,
  "destination_longitude" DOUBLE PRECISION NOT NULL,
  "waypoints" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "distance_meters" INT NOT NULL DEFAULT 0,
  "duration_seconds" INT NOT NULL DEFAULT 0,
  "encoded_polyline" TEXT NOT NULL DEFAULT '',
  "filter_rules" JSONB NOT NULL DEFAULT '{"onlyFixedSigns": true, "categories": ["P","W","R","I"]}'::jsonb,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_saved_routes_user"
  ON "saved_routes" ("user_id");

CREATE INDEX IF NOT EXISTS "idx_saved_routes_vehicle"
  ON "saved_routes" ("vehicle_mode");
