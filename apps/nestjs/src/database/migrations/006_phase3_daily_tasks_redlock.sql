-- Phase 3: Daily Task Center Engine & Redis Redlock Schema

-- 1. Extend daily_tasks with target_count, activity_type, timestamps
ALTER TABLE daily_tasks ADD COLUMN IF NOT EXISTS target_count INT NOT NULL DEFAULT 1;
ALTER TABLE daily_tasks ADD COLUMN IF NOT EXISTS activity_type VARCHAR(50) NOT NULL DEFAULT 'SURVEY';
ALTER TABLE daily_tasks ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE daily_tasks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_daily_tasks_activity ON daily_tasks(activity_type, is_active);

-- 2. Extend daily_task_completions with progress, is_completed, timestamps
ALTER TABLE daily_task_completions ADD COLUMN IF NOT EXISTS progress INT NOT NULL DEFAULT 0;
ALTER TABLE daily_task_completions ADD COLUMN IF NOT EXISTS is_completed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE daily_task_completions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE daily_task_completions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_task_completions_user_task_date 
ON daily_task_completions(user_id, daily_task_id, completion_date);

-- 3. Seed / upsert standard daily task challenges
INSERT INTO daily_tasks (task_code, name, description, target_count, reward_credits, activity_type, is_active)
VALUES
    ('SURVEY_3', 'Survey 3 Signs', 'Contribute and upload 3 traffic sign recordings or photos', 3, 30, 'SURVEY', TRUE),
    ('REVIEW_5', 'Verify 5 Candidates', 'Participate in peer consensus by reviewing 5 sign candidates', 5, 25, 'REVIEW', TRUE),
    ('HAZARD_1', 'Report Road Hazard', 'Alert the community to a temporary roadside hazard', 1, 15, 'HAZARD', TRUE),
    ('REVALIDATE_2', 'Revalidate 2 Signs', 'Complete revalidation evidence on 2 aging signs', 2, 20, 'REVALIDATE', TRUE)
ON CONFLICT (task_code) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    target_count = EXCLUDED.target_count,
    reward_credits = EXCLUDED.reward_credits,
    activity_type = EXCLUDED.activity_type,
    is_active = EXCLUDED.is_active,
    updated_at = NOW();
