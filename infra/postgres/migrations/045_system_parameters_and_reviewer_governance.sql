-- =============================================================================
-- Migration 045: System Parameters Consolidation & Reviewer Governance
-- =============================================================================
BEGIN;

-- 1. Create Parameter Category and Type Enums
DO $$ BEGIN
  CREATE TYPE "parameter_category" AS ENUM (
    'CONSENSUS',
    'REVIEWER',
    'REVALIDATION',
    'HAZARDS',
    'NAVIGATION',
    'ECONOMY',
    'INGESTION',
    'AIOPS',
    'SECURITY',
    'INFRASTRUCTURE'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "parameter_data_type" AS ENUM (
    'NUMBER',
    'INTEGER',
    'STRING',
    'BOOLEAN',
    'JSON',
    'PERCENTAGE',
    'DURATION'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Upgrade system_parameters table
ALTER TABLE "system_parameters"
  ADD COLUMN IF NOT EXISTS "category" parameter_category NOT NULL DEFAULT 'INFRASTRUCTURE',
  ADD COLUMN IF NOT EXISTS "data_type" parameter_data_type NOT NULL DEFAULT 'STRING',
  ADD COLUMN IF NOT EXISTS "validation_rules" JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "requires_restart" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS "idx_system_parameters_category" ON "system_parameters"("category");

-- 3. Create parameter_audit_logs table
CREATE TABLE IF NOT EXISTS "parameter_audit_logs" (
  "id" BIGSERIAL PRIMARY KEY,
  "parameter_key" VARCHAR(100) NOT NULL REFERENCES "system_parameters"("key") ON DELETE CASCADE,
  "old_value" TEXT,
  "new_value" TEXT NOT NULL,
  "change_reason" TEXT NOT NULL,
  "changed_by" UUID NOT NULL REFERENCES "users"("id"),
  "ip_address" VARCHAR(45),
  "user_agent" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_param_audit_key_date" ON "parameter_audit_logs"("parameter_key", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_param_audit_user" ON "parameter_audit_logs"("changed_by");

-- 4. Reviewer Quest System Enums & Table
DO $$ BEGIN
  CREATE TYPE "quest_target_type" AS ENUM ('CANDIDATE_VALIDATION', 'REVALIDATION_TASK');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "quest_claim_status" AS ENUM ('CLAIMED', 'COMPLETED', 'EXPIRED', 'ABANDONED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "reviewer_quest_claims" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "reviewer_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "target_type" quest_target_type NOT NULL,
  "target_id" UUID NOT NULL,
  "status" quest_claim_status NOT NULL DEFAULT 'CLAIMED',
  "time_limit_minutes" INT NOT NULL DEFAULT 120,
  "claimed_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "expires_at" TIMESTAMPTZ NOT NULL,
  "completed_at" TIMESTAMPTZ,
  "base_reward_credits" INT NOT NULL DEFAULT 10,
  "escalated_bonus_credits" INT NOT NULL DEFAULT 0,
  "penalty_applied" BOOLEAN NOT NULL DEFAULT FALSE,
  "penalty_notes" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_quest_claims_reviewer_status" ON "reviewer_quest_claims"("reviewer_id", "status");
CREATE INDEX IF NOT EXISTS "idx_quest_claims_target" ON "reviewer_quest_claims"("target_id", "target_type");
CREATE INDEX IF NOT EXISTS "idx_quest_claims_expired_scan" ON "reviewer_quest_claims"("status", "expires_at") WHERE status = 'CLAIMED';

-- 5. Extend Existing Verification & Audit Entities
ALTER TABLE "candidate_reviews"
  ADD COLUMN IF NOT EXISTS "reviewer_location" geometry(Point, 4326),
  ADD COLUMN IF NOT EXISTS "accuracy_meters" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "quest_claim_id" UUID REFERENCES "reviewer_quest_claims"("id");

ALTER TABLE "revalidation_decisions"
  ADD COLUMN IF NOT EXISTS "reviewer_location" geometry(Point, 4326),
  ADD COLUMN IF NOT EXISTS "accuracy_meters" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "quest_claim_id" UUID REFERENCES "reviewer_quest_claims"("id");

ALTER TABLE "unverified_sign_candidates"
  ADD COLUMN IF NOT EXISTS "bounty_credits" INT NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS "is_promoted" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "promoted_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "votes_count" INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "first_voted_at" TIMESTAMPTZ;

ALTER TABLE "revalidation_tasks"
  ADD COLUMN IF NOT EXISTS "is_promoted" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "promoted_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "votes_count" INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "first_voted_at" TIMESTAMPTZ;

ALTER TABLE "verified_traffic_signs"
  ADD COLUMN IF NOT EXISTS "lifetime_multiplier" FLOAT NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS "effective_lifetime_days" INT,
  ADD COLUMN IF NOT EXISTS "degraded_consensus_ratio" FLOAT;

ALTER TABLE "navigation_sessions"
  ADD COLUMN IF NOT EXISTS "is_reviewer_free_route" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "target_sign_id" UUID,
  ADD COLUMN IF NOT EXISTS "waiver_reason" VARCHAR(64);

-- 6. Seed Complete Registry of System Parameters
INSERT INTO "system_parameters" ("key", "value", "description", "category", "data_type", "validation_rules")
VALUES
  -- Consensus
  ('consensus.approval_threshold', '0.5', 'Consensus score threshold required to approve a sign candidate', 'CONSENSUS', 'NUMBER', '{"min": 0.1, "max": 1.0, "step": 0.05}'),
  ('consensus.rejection_threshold', '-0.5', 'Consensus score threshold required to reject a sign candidate', 'CONSENSUS', 'NUMBER', '{"min": -1.0, "max": -0.1, "step": 0.05}'),
  ('consensus.min_votes_required', '3', 'Minimum votes required to reach valid consensus', 'CONSENSUS', 'INTEGER', '{"min": 1, "max": 20, "step": 1}'),
  ('consensus.max_votes_limit', '9', 'Maximum total votes collected per candidate before forced decision', 'CONSENSUS', 'INTEGER', '{"min": 3, "max": 50, "step": 1}'),
  ('consensus.alpha_smoothing_factor', '0.1', 'Smoothing factor alpha for reviewer reliability score updates', 'CONSENSUS', 'NUMBER', '{"min": 0.01, "max": 0.5, "step": 0.01}'),
  ('consensus.weight_correct', '1.0', 'Multiplier weight added on correct voting alignment', 'CONSENSUS', 'NUMBER', '{"min": 0.1, "max": 5.0, "step": 0.1}'),
  ('consensus.penalty_false', '2.0', 'Penalty weight subtracted on incorrect voting alignment', 'CONSENSUS', 'NUMBER', '{"min": 0.5, "max": 10.0, "step": 0.5}'),
  ('consensus.min_sample_baseline', '5', 'Minimum reviews before a reviewer is considered seasoned', 'CONSENSUS', 'INTEGER', '{"min": 1, "max": 50, "step": 1}'),
  ('consensus.min_reliability_threshold', '50.0', 'Minimum reliability percentage before voting suspension kicks in', 'CONSENSUS', 'NUMBER', '{"min": 10.0, "max": 90.0, "step": 5.0}'),
  ('consensus.consecutive_error_limit', '3', 'Consecutive wrong votes allowed before automatic temporary suspension', 'CONSENSUS', 'INTEGER', '{"min": 1, "max": 10, "step": 1}'),
  ('consensus.suspension_cooldown_days', '7', 'Cooldown period in days when reviewer is suspended for poor accuracy', 'CONSENSUS', 'INTEGER', '{"min": 1, "max": 90, "step": 1}'),
  ('consensus.provisional_vote_weight', '0.5', 'Fixed vote weight assigned to provisional reviewers', 'CONSENSUS', 'NUMBER', '{"min": 0.1, "max": 1.0, "step": 0.1}'),
  ('consensus.degraded_consensus_enabled', 'true', 'Enable accepting degraded consensus with decayed sign lifetime on timeout', 'CONSENSUS', 'BOOLEAN', '{"allowedValues": [true, false]}'),
  ('consensus.degraded_timeout_hours', '48', 'Hours after first vote before degraded consensus can be finalized', 'CONSENSUS', 'INTEGER', '{"min": 6, "max": 168, "step": 6}'),
  ('consensus.degraded_min_votes', '1', 'Minimum votes needed to qualify for degraded consensus acceptance', 'CONSENSUS', 'INTEGER', '{"min": 1, "max": 5, "step": 1}'),

  -- Reviewer Features
  ('reviewer.gps_geofence_radius_meters', '50.0', 'Max physical distance in meters allowed between reviewer and sign location', 'REVIEWER', 'NUMBER', '{"min": 10.0, "max": 500.0, "step": 5.0}'),
  ('reviewer.gps_enforcement_enabled', 'true', 'Enforce strict GPS proximity check during on-site vote submission', 'REVIEWER', 'BOOLEAN', '{"allowedValues": [true, false]}'),
  ('reviewer.quest_time_limit_minutes', '120', 'Time limit in minutes to complete a claimed on-site verification quest', 'REVIEWER', 'INTEGER', '{"min": 15, "max": 480, "step": 15}'),
  ('reviewer.max_active_claims_per_user', '3', 'Maximum concurrent active quest claims allowed per reviewer', 'REVIEWER', 'INTEGER', '{"min": 1, "max": 10, "step": 1}'),
  ('reviewer.quest_timeout_penalty_score', '5.0', 'Reputation score deduction applied when claimed quest expires without completion', 'REVIEWER', 'NUMBER', '{"min": 0.0, "max": 25.0, "step": 0.5}'),
  ('reviewer.allow_vote_update', 'true', 'Allow reviewers to update their vote before consensus is reached', 'REVIEWER', 'BOOLEAN', '{"allowedValues": [true, false]}'),
  ('reviewer.vote_update_window_minutes', '60', 'Time window in minutes after initial vote during which updates are permitted', 'REVIEWER', 'INTEGER', '{"min": 5, "max": 240, "step": 5}'),
  ('reviewer.bounty_escalation_enabled', 'true', 'Enable bounty reward escalation for candidates with stalled votes', 'REVIEWER', 'BOOLEAN', '{"allowedValues": [true, false]}'),
  ('reviewer.bounty_escalation_multiplier', '0.5', 'Multiplier applied per vote for escalating bounty: Bonus = n * multiplier * Base', 'REVIEWER', 'NUMBER', '{"min": 0.1, "max": 2.0, "step": 0.1}'),
  ('reviewer.promotion_nearby_radius_km', '10.0', 'Radius in kilometers to search and notify nearby reviewers for promoted quests', 'REVIEWER', 'NUMBER', '{"min": 1.0, "max": 50.0, "step": 1.0}'),
  ('reviewer.reward_scaling_enabled', 'true', 'Scale reviewer reward payout by reliability percentage: Reward = Base * (Rel / 100)', 'REVIEWER', 'BOOLEAN', '{"allowedValues": [true, false]}'),
  ('reviewer.reward_scaling_floor_pct', '10.0', 'Minimum percentage floor for scaled rewards to prevent zero payouts', 'REVIEWER', 'NUMBER', '{"min": 0.0, "max": 50.0, "step": 5.0}'),

  -- Hazards
  ('hazards.initial_ttl_minutes', '45', 'Initial lifespan in minutes for a newly reported road hazard', 'HAZARDS', 'INTEGER', '{"min": 5, "max": 240, "step": 5}'),
  ('hazards.extension_ttl_minutes', '15', 'Lifespan extension in minutes on each subsequent user confirmation', 'HAZARDS', 'INTEGER', '{"min": 5, "max": 120, "step": 5}'),
  ('hazards.max_ttl_minutes', '120', 'Maximum absolute lifespan limit in minutes for any road hazard', 'HAZARDS', 'INTEGER', '{"min": 30, "max": 1440, "step": 30}'),
  ('hazards.deduplication_radius_meters', '300.0', 'Spatial deduplication radius in meters for merging nearby hazard reports', 'HAZARDS', 'NUMBER', '{"min": 20.0, "max": 1000.0, "step": 20.0}'),
  ('hazards.consensus_threshold_k', '3', 'Confirmations required to transition a hazard to CONFIRMED status', 'HAZARDS', 'INTEGER', '{"min": 1, "max": 10, "step": 1}'),
  ('hazards.default_report_reward', '10', 'Credits rewarded for creating an initial valid road hazard report', 'HAZARDS', 'INTEGER', '{"min": 0, "max": 100, "step": 5}'),
  ('hazards.default_confirm_reward', '2', 'Credits rewarded for confirming an existing active road hazard', 'HAZARDS', 'INTEGER', '{"min": 0, "max": 50, "step": 1}'),

  -- Navigation
  ('navigation.session_fee', '5', 'Standard credit fee charged for initiating turn-by-turn navigation', 'NAVIGATION', 'INTEGER', '{"min": 0, "max": 100, "step": 1}'),
  ('navigation.custom_profile_fee', '20', 'Credit fee charged for creating custom alert profiles', 'NAVIGATION', 'INTEGER', '{"min": 0, "max": 200, "step": 5}'),
  ('navigation.search_radius_m', '50', 'Spatial search radius in meters for prefetching upcoming road signs', 'NAVIGATION', 'INTEGER', '{"min": 10, "max": 500, "step": 10}'),
  ('navigation.heading_threshold_deg', '30.0', 'Heading match half-angle tolerance in degrees (cone of +-deg)', 'NAVIGATION', 'NUMBER', '{"min": 5.0, "max": 90.0, "step": 2.5}'),
  ('navigation.reviewer_free_route_enabled', 'true', 'Waive navigation credit fee when traveling to verify a claimed quest sign', 'NAVIGATION', 'BOOLEAN', '{"allowedValues": [true, false]}'),
  ('navigation.reviewer_free_route_radius_km', '5.0', 'Maximum distance in km from sign origin eligible for navigation fee waiver', 'NAVIGATION', 'NUMBER', '{"min": 0.5, "max": 25.0, "step": 0.5}'),

  -- Missions & Economy
  ('missions.verify_three_signs_reward', '15', 'Reward credits for completing daily mission: Verify 3 Traffic Signs', 'ECONOMY', 'INTEGER', '{"min": 0, "max": 200, "step": 5}'),
  ('missions.approved_anomaly_reward', '20', 'Reward credits for completing daily mission: Have 1 Anomaly Report Approved', 'ECONOMY', 'INTEGER', '{"min": 0, "max": 200, "step": 5}'),
  ('missions.weekly_five_reward', '50', 'Reward credits for completing weekly challenge: Complete 5 Daily Missions', 'ECONOMY', 'INTEGER', '{"min": 0, "max": 500, "step": 10}'),
  ('MISSIONS_STREAK_BONUS_CREDITS', '0', 'Bonus credits granted at consecutive seven-day streak milestones', 'ECONOMY', 'INTEGER', '{"min": 0, "max": 1000, "step": 10}'),

  -- Ingestion & Uploads
  ('survey.max_image_size_mb', '50', 'Maximum single image file upload size in megabytes', 'INGESTION', 'INTEGER', '{"min": 1, "max": 100, "step": 5}'),
  ('survey.max_video_size_mb', '2048', 'Maximum raw video file upload size in megabytes', 'INGESTION', 'INTEGER', '{"min": 100, "max": 10240, "step": 256}'),
  ('survey.max_chunk_size_mb', '50', 'Maximum chunk size in megabytes for resumable video upload sessions', 'INGESTION', 'INTEGER', '{"min": 5, "max": 100, "step": 5}'),

  -- AI & Computer Vision
  ('ai.detector.conf_thresh', '0.6', 'Confidence threshold for YOLO12 traffic sign detector', 'AIOPS', 'NUMBER', '{"min": 0.1, "max": 0.99, "step": 0.05}'),
  ('ai.classifier.conf_thresh', '0.6', 'Confidence threshold for CLIP zero-shot traffic sign classifier', 'AIOPS', 'NUMBER', '{"min": 0.1, "max": 0.99, "step": 0.05}'),
  ('ai.classifier.temperature', '2.5', 'Softmax temperature scaling factor for CLIP classification logits', 'AIOPS', 'NUMBER', '{"min": 0.1, "max": 10.0, "step": 0.1}'),
  ('ai.timo.alpha', '250.0', 'Pinhole projection focal length scale factor alpha', 'AIOPS', 'NUMBER', '{"min": 10.0, "max": 1000.0, "step": 10.0}'),
  ('ai.timo.beta', '0.8', 'Pinhole projection ground elevation calibration parameter beta', 'AIOPS', 'NUMBER', '{"min": 0.1, "max": 2.0, "step": 0.05}'),
  ('ai.active_learning.query_budget', '50', 'Batch size of uncertain candidates selected for human reviewer validation', 'AIOPS', 'INTEGER', '{"min": 1, "max": 500, "step": 5}'),
  ('ai.active_learning.strategy', 'r3_cec', 'Active learning selection strategy: r3_cec, entropy, or margin', 'AIOPS', 'STRING', '{"allowedValues": ["r3_cec", "entropy", "margin"]}'),

  -- Security
  ('security.jwt_access_ttl', '7d', 'Standard lifespan duration for user JWT access tokens', 'SECURITY', 'STRING', '{"pattern": "^[0-9]+[smhd]$"}'),
  ('security.max_login_attempts', '5', 'Failed login attempts before temporary account lockout', 'SECURITY', 'INTEGER', '{"min": 3, "max": 20, "step": 1}'),
  ('security.lockout_duration_mins', '15', 'Lockout duration in minutes after exceeding failed login attempts', 'SECURITY', 'INTEGER', '{"min": 1, "max": 1440, "step": 5}')
ON CONFLICT ("key") DO UPDATE
  SET "category" = EXCLUDED."category",
      "data_type" = EXCLUDED."data_type",
      "validation_rules" = EXCLUDED."validation_rules",
      "description" = EXCLUDED."description";

COMMIT;
