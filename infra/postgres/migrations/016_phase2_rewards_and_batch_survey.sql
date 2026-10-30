-- Phase 2: Dynamic Reward Engine & Batch Survey Ingestion Schema

-- 1. Create reward_rules table
CREATE TABLE IF NOT EXISTS reward_rules (
    id SERIAL PRIMARY KEY,
    activity_type VARCHAR(64) NOT NULL UNIQUE,
    base_amount INT NOT NULL CHECK (base_amount >= 0),
    daily_limit INT NOT NULL DEFAULT 10,
    multiplier_config JSONB DEFAULT '{"reputation_bonus": true}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    effective_to TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reward_rules_activity ON reward_rules(activity_type);

-- 2. Seed initial reward rules
INSERT INTO reward_rules (activity_type, base_amount, daily_limit, multiplier_config, is_active)
VALUES
    ('SURVEY_REWARD', 15, 20, '{"candidate_multiplier": true, "bonus_per_candidate": 5}'::jsonb, TRUE),
    ('REVIEW_REWARD', 5, 50, '{"reputation_bonus": true}'::jsonb, TRUE),
    ('REVALIDATION_REWARD', 20, 20, '{"urgency_bonus": true}'::jsonb, TRUE),
    ('SIGN_DECOMMISSION_REWARD', 30, 10, '{}'::jsonb, TRUE),
    ('HAZARD_REPORT_REWARD', 10, 15, '{}'::jsonb, TRUE),
    ('HAZARD_CONFIRM_REWARD', 2, 30, '{}'::jsonb, TRUE),
    ('DAILY_TASK_REWARD', 25, 5, '{}'::jsonb, TRUE)
ON CONFLICT (activity_type) DO NOTHING;

-- 3. Create batch_submissions table
CREATE TABLE IF NOT EXISTS batch_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255),
    total_images INT NOT NULL DEFAULT 0,
    processed_images INT NOT NULL DEFAULT 0,
    extracted_candidates INT NOT NULL DEFAULT 0,
    reward_status VARCHAR(32) NOT NULL DEFAULT 'PENDING' CHECK (reward_status IN ('NONE', 'PENDING', 'APPROVED', 'PAID', 'WITHHELD', 'REJECTED', 'REVERSED')),
    reward_amount INT NOT NULL DEFAULT 0,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_batch_submissions_user ON batch_submissions(user_id, created_at DESC);

-- 4. Extend survey_submissions with candidate-gated reward fields
ALTER TABLE survey_submissions ADD COLUMN IF NOT EXISTS reward_status VARCHAR(32) DEFAULT 'NONE';
ALTER TABLE survey_submissions ADD COLUMN IF NOT EXISTS reward_amount INT DEFAULT 0;
