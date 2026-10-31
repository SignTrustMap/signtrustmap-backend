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
    ('SURVEY_3', 'Khảo sát 3 biển báo', 'Đóng góp và tải lên 3 bản ghi hoặc hình ảnh biển báo giao thông', 3, 30, 'SURVEY', TRUE),
    ('REVIEW_5', 'Xác minh 5 biển báo ứng viên', 'Tham gia đồng thuận cộng đồng bằng cách duyệt 5 biển báo ứng viên', 5, 25, 'REVIEW', TRUE),
    ('HAZARD_1', 'Báo cáo sự cố đường bộ', 'Cảnh báo cộng đồng về mối nguy hiểm hoặc sự cố tạm thời ven đường', 1, 15, 'HAZARD', TRUE),
    ('REVALIDATE_2', 'Tái xác thực 2 biển báo', 'Hoàn thành minh chứng tái xác thực cho 2 biển báo sắp hết hạn', 2, 20, 'REVALIDATE', TRUE)
ON CONFLICT (task_code) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    target_count = EXCLUDED.target_count,
    reward_credits = EXCLUDED.reward_credits,
    activity_type = EXCLUDED.activity_type,
    is_active = EXCLUDED.is_active,
    updated_at = NOW();
