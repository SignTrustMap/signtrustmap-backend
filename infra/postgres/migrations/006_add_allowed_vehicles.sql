-- =============================================================================
-- 006_add_allowed_vehicles.sql
-- Adds the per-vehicle eligibility column to traffic_sign_types.
-- Idempotent: safe to re-run (docker-compose applies /migrations/*.sql on
-- every `postgres-migrate` run).
--
-- Semantics enforced by the application:
--   empty array  -> sign is strictly prohibited for every vehicle
--   NULL         -> legacy rows with no restriction (kept as-is)
--   default      -> all six vehicle types are allowed
-- =============================================================================
ALTER TABLE "traffic_sign_types"
  ADD COLUMN IF NOT EXISTS "allowed_vehicles" text[]
    NOT NULL DEFAULT ARRAY['CAR','MOTORCYCLE','TRUCK','BUS','BICYCLE','PEDESTRIAN']::text[];