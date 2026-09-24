# Hướng dẫn test Phase 4 — Celery Tasks

Có 3 tầng kiểm tra: **smoke test** (worker khởi động đúng), **manual trigger** (kích hoạt task thủ công qua Celery shell), **functional test** (seed DB → chạy task → verify dữ liệu thay đổi).

---

## Tầng 1 — Smoke Test: Worker & Beat khởi động đúng

```bash
# Bước 1: khởi infrastructure (không cần api service)
docker compose up -d postgres redis

# Bước 2: bật worker, quan sát log
docker compose up celery-worker
```

Log phải chứa (thứ tự không quan trọng):
```
[tasks]
  . app.tasks.ai_pipeline.task_dispatch_queued_submissions
  . app.tasks.ai_pipeline.task_process_submission_pipeline
  . app.tasks.freshness.task_check_freshness_and_spawn_revalidations
  . app.tasks.leaderboard.task_refresh_community_leaderboard
```

```bash
# Bước 3: bật beat, kiểm tra schedule đăng ký đúng
docker compose up celery-beat
```

Beat log phải có:
```
beat: Starting...
Scheduler: Sending due task freshness-monitor-every-30min
Scheduler: Sending due task refresh-leaderboard-every-15min
Scheduler: Sending due task dispatch-queued-ai-submissions
```

---

## Tầng 2 — Manual Trigger qua Celery shell

Mở shell vào container worker:

```bash
docker compose exec celery-worker bash
cd /app
python -c "
from app.celery_app import celery_app

# Kiểm tra task đã registered
names = sorted(celery_app.tasks.keys())
for n in names:
    print(n)
"
```

Kích hoạt từng task thủ công:

```bash
# Freshness monitor (Flow 8)
python -c "
from app.tasks.freshness import task_check_freshness_and_spawn_revalidations
result = task_check_freshness_and_spawn_revalidations.apply()
print('Result:', result.get())
"

# Leaderboard refresh (Flow 11)
python -c "
from app.tasks.leaderboard import task_refresh_community_leaderboard
result = task_refresh_community_leaderboard.apply()
print('Result:', result.get())
"
```

`.apply()` chạy đồng bộ trong process hiện tại — không cần broker, kết quả ngay lập tức.

---

## Tầng 3 — Functional Test: Seed DB → Chạy Task → Verify

### 3a. Test `task_check_freshness_and_spawn_revalidations` (Flow 8)

**Seed dữ liệu tối thiểu** — chạy trong `psql` hoặc `docker compose exec postgres psql -U stm_user signtrustmap`:

```sql
-- 1. sign_categories (bảng lookup)
INSERT INTO sign_categories (id, name, code)
VALUES (1, 'Test Category', 'TEST')
ON CONFLICT DO NOTHING;

-- 2. traffic_sign_types
INSERT INTO traffic_sign_types (id, name, code, category_id)
VALUES (
    gen_random_uuid(),
    'Speed Limit 50',
    'W.235.1',
    1
)
RETURNING id;
-- Ghi lại <type_id> để dùng ở bước 3

-- 3. freshness_rules cho category này (period = 30 ngày, priority MEDIUM)
INSERT INTO freshness_rules (sign_category_id, freshness_period_days, default_priority, is_active)
VALUES (1, 30, 'MEDIUM', TRUE)
ON CONFLICT DO NOTHING;

-- 4. users (required FK cho verified_traffic_signs)
INSERT INTO users (id, email, full_name, status)
VALUES (gen_random_uuid(), 'testuser@stm.dev', 'Test User', 'ACTIVE')
RETURNING id;
-- Ghi lại <user_id>

-- 5. verified_traffic_signs: backdated 45 ngày => overdue 15 ngày với period=30
INSERT INTO verified_traffic_signs (
    id, sign_type_id, location, status, freshness_score,
    last_verified_at, verified_by, created_at, updated_at
)
VALUES (
    gen_random_uuid(),
    '<type_id>',
    ST_SetSRID(ST_MakePoint(106.6297, 10.8231), 4326),  -- TP.HCM
    'ACTIVE',
    0.9,
    NOW() - INTERVAL '45 days',
    '<user_id>',
    NOW() - INTERVAL '45 days',
    NOW() - INTERVAL '45 days'
)
RETURNING id;
-- Ghi lại <sign_id>
```

**Chạy task và verify:**

```bash
docker compose exec celery-worker python -c "
from app.tasks.freshness import task_check_freshness_and_spawn_revalidations
r = task_check_freshness_and_spawn_revalidations.apply()
print(r.get())
# Mong đợi: {'run_at': '...', 'spawned': 1, 'errors': 0}
"
```

**Kiểm tra trong DB:**

```sql
-- 1. revalidation_tasks phải có 1 row OPEN
SELECT id, status, priority, reward_credits
FROM revalidation_tasks
WHERE verified_sign_id = '<sign_id>';
-- Mong đợi: 1 row, status=OPEN, priority=MEDIUM
-- reward = min(50, 10 + int((45 - 30) * 2)) = min(50, 10+30) = 40

-- 2. verified_traffic_signs.status phải chuyển sang STALE
SELECT status, freshness_score
FROM verified_traffic_signs
WHERE id = '<sign_id>';
-- status=STALE
-- freshness_score = max(0, 1 - 45/(30*2)) = max(0, 1 - 0.75) = 0.25

-- 3. sign_lifecycle_events phải có audit row
SELECT event_type, note
FROM sign_lifecycle_events
WHERE verified_sign_id = '<sign_id>';
-- event_type=MARKED_STALE, note chứa "days_overdue=45.0"

-- 4. Idempotency: chạy lại task, spawned phải = 0 (NOT EXISTS guard)
```

**Test idempotency:**

```bash
docker compose exec celery-worker python -c "
from app.tasks.freshness import task_check_freshness_and_spawn_revalidations
r = task_check_freshness_and_spawn_revalidations.apply()
print(r.get())
# Mong đợi: {'spawned': 0, 'errors': 0} — không tạo duplicate
"
```

---

### 3b. Test AI Pipeline (`task_process_submission_pipeline`)

Create and submit a valid submission through the NestJS submission API first. The assembled
`submission_media_files.file_url` values must point at objects that exist in MinIO. Beat will find
the `QUEUED` row within ten seconds and pass this JSON-safe contract to the worker:

```json
{
  "submission_id": "<submission_id>",
  "media_objects": [
    {"media_type": "VIDEO", "bucket": "stm-raw-videos", "object_key": "uploads/.../drive.mp4"},
    {"media_type": "GPX", "bucket": "stm-gpx-logs", "object_key": "uploads/.../drive.gpx"}
  ]
}
```

For a manual dispatch, use the same object references:

```bash
docker compose exec celery-worker python -c "
from app.tasks.ai_pipeline import task_process_submission_pipeline
r = task_process_submission_pipeline.apply(kwargs={
  'submission_id': '<submission_id>',
  'media_objects': [
    {'media_type': 'VIDEO', 'bucket': 'stm-raw-videos', 'object_key': 'uploads/.../drive.mp4'},
    {'media_type': 'GPX', 'bucket': 'stm-gpx-logs', 'object_key': 'uploads/.../drive.gpx'},
  ],
})
print(r.get())
"
```

The AI service downloads the existing objects and responds synchronously. **Verify in DB:**

```sql
-- Final status is COMPLETED, PARTIALLY_PROCESSED, NO_SIGN_DETECTED, or FAILED.
SELECT status, total_candidates_extracted
FROM survey_submissions
WHERE id = '<submission_id>';
-- Candidate rows contain stable MinIO keys returned by the inference service.
SELECT predicted_sign_type_id, confidence_score, best_frame_url, sign_crop_url
FROM unverified_sign_candidates
WHERE submission_id = '<submission_id>';

SELECT old_status, new_status, note, changed_at
FROM submission_status_history
WHERE submission_id = '<submission_id>'
ORDER BY changed_at;
```

Expected successful status sequence:

| old_status | new_status |
|---|---|
| QUEUED | SYNCHRONIZING |
| SYNCHRONIZING | DETECTING |
| DETECTING | CLASSIFYING |
| CLASSIFYING | NO_SIGN_DETECTED |

**Test terminal guard (idempotency):**

```bash
docker compose exec celery-worker python -c "
# Dispatch thêm một lần, pipeline phải bị skip hoàn toàn
from app.tasks.ai_pipeline import task_process_submission_pipeline
r = task_process_submission_pipeline.apply(kwargs={
  'submission_id': '<submission_id>',
  'media_objects': [],
})
print(r.get())
# Mong đợi: {'skipped': True, ...}
"
```

---

### 3c. Test `task_refresh_community_leaderboard`

```bash
docker compose exec celery-worker python -c "
from app.tasks.leaderboard import task_refresh_community_leaderboard
r = task_refresh_community_leaderboard.apply()
result = r.get()
print(result)
# Mong đợi: {'refreshed_at': '...', 'elapsed_ms': <float>}
"
```

Verify view được refresh:

```sql
SELECT COUNT(*), MAX(last_refreshed_at)
FROM mv_community_leaderboard;
-- last_refreshed_at phải gần NOW()
```

---

## Lưu ý quan trọng

**`sign_lifecycle_events.event_type`** — freshness task insert `'MARKED_STALE'`. Trước khi chạy, kiểm tra schema của bảng này có chấp nhận giá trị đó không:

```sql
\d sign_lifecycle_events
-- hoặc
SELECT DISTINCT event_type FROM sign_lifecycle_events;
```

Nếu `event_type` là ENUM thì cần `event_type::` cast đúng; nếu là `text` thì không cần lo. Nếu ENUM không có `MARKED_STALE`, cần `ALTER TYPE` thêm vào — báo lại để fix trước khi test.

**Beat tự động** — sau khi `docker compose up celery-beat`, không cần trigger thủ công. Freshness chạy mỗi `:00` và `:30` phút, leaderboard chạy mỗi `:00`, `:15`, `:30`, `:45`. Monitor qua:

```bash
docker compose logs -f celery-worker
docker compose logs -f celery-beat
```
