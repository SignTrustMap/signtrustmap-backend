-- Upgrade SignTrustMap database for:
--   Scenario #3 (Flow 8): Revalidating an Outdated Traffic Sign
--   Scenario #4 (Flow 10): Handling a New Traffic Sign Type (Missing Type)
--
-- Run:
--   psql "$DATABASE_URL" -f infra/postgres/migrations/005_revalidation_and_missing_type.sql

-- ---------------------------------------------------------------------------
-- 1. Revalidation: allow a task to be escalated to staff moderation on ties
-- ---------------------------------------------------------------------------
ALTER TYPE task_status ADD VALUE IF NOT EXISTS 'ESCALATED_MODERATION';

-- ---------------------------------------------------------------------------
-- 2. Freshness rules: GPS proximity guardrail + daily evidence submission limit
-- ---------------------------------------------------------------------------
ALTER TABLE freshness_rules
  ADD COLUMN IF NOT EXISTS max_proximity_meters integer NOT NULL DEFAULT 50;
ALTER TABLE freshness_rules
  ADD COLUMN IF NOT EXISTS daily_submission_limit integer NOT NULL DEFAULT 3;

-- ---------------------------------------------------------------------------
-- 3. Revalidation decisions: suggested sign type for CHANGED verdicts
-- ---------------------------------------------------------------------------
ALTER TABLE revalidation_decisions
  ADD COLUMN IF NOT EXISTS suggested_sign_type_id integer REFERENCES traffic_sign_types(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 4. PostGIS spatial index backing on-site evidence proximity checks
--    (index is referenced by the scenario #3 evidence submission guardrail)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_reval_evidences_geom
  ON revalidation_evidences USING GIST (location);

-- ---------------------------------------------------------------------------
-- 5. Helper function: distance (metres) between an evidence point and a sign
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION stm_revalidation_proximity_m(
  evidence_lon double precision,
  evidence_lat double precision,
  sign_location geometry
) RETURNS double precision AS $$
  SELECT ST_DistanceSphere(
    ST_SetSRID(ST_MakePoint(evidence_lon, evidence_lat), 4326),
    sign_location
  );
$$ LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE;

-- ---------------------------------------------------------------------------
-- 6. Missing-type reports: evidence descriptors captured by the reviewer
-- ---------------------------------------------------------------------------
ALTER TABLE missing_sign_type_reports
  ADD COLUMN IF NOT EXISTS suggested_shape varchar(30);
ALTER TABLE missing_sign_type_reports
  ADD COLUMN IF NOT EXISTS suggested_color_scheme varchar(30);

-- ---------------------------------------------------------------------------
-- 7. Candidate FK: SET NULL so a report may outlive a deleted candidate
-- ---------------------------------------------------------------------------
ALTER TABLE missing_sign_type_reports
  DROP CONSTRAINT IF EXISTS missing_sign_type_reports_candidate_id_fkey;
ALTER TABLE missing_sign_type_reports
  DROP CONSTRAINT IF EXISTS fk_missing_reports_candidate;
ALTER TABLE missing_sign_type_reports
  ADD CONSTRAINT fk_missing_reports_candidate
    FOREIGN KEY (candidate_id) REFERENCES unverified_sign_candidates(id) ON DELETE SET NULL;