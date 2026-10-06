-- =============================================================================
-- 013_fix_database_sign_mismatches.sql
-- Fix database mismatches:
-- 1. Reclassify non-speed signs misclassified as SPEED_LIMIT (I.425, I.442, I.441a, I.441b) to INFORMATION (category_id = 7)
-- 2. Rescue standard regulation signs trapped in MOCK_TRAFFIC_SIGNS (P.102, W.224, W.227, P.106c, P.114, P.105, I.423a)
-- 3. Fix W.210 (Railway crossing with gates) miscoded as MANDATORY -> WARNING (category_id = 2)
-- 4. Fix description mismatch on W.220 (Steep ascent 5%)
-- 5. Align sign_type_ai_prompts CLIP prompts for IDs 1-6
-- =============================================================================

BEGIN;

-- 1. Non-speed signs misclassified as SPEED_LIMIT (category_id = 4) -> INFORMATION (category_id = 7)
UPDATE "traffic_sign_types"
SET "category_id" = 7,
    "shape" = 'RECTANGLE',
    "color_scheme" = 'BLUE_WHITE',
    "updated_at" = now()
WHERE "sign_code" IN ('I.425', 'I.442', 'I.441a', 'I.441b');

-- 2. Standard regulation signs trapped in MOCK_TRAFFIC_SIGNS (category_id = 1)
UPDATE "traffic_sign_types"
SET "category_id" = 6,
    "shape" = 'ROUND',
    "color_scheme" = 'RED_WHITE',
    "description" = 'Biển báo Đường cấm / Cấm đi ngược chiều theo quy chuẩn QCVN 41:2019/BGTVT',
    "updated_at" = now()
WHERE "sign_code" = 'P.102';

UPDATE "traffic_sign_types"
SET "category_id" = 2,
    "shape" = 'TRIANGLE',
    "color_scheme" = 'RED_YELLOW',
    "description" = 'Biển báo Đoạn đường người đi bộ cắt ngang theo quy chuẩn QCVN 41:2019/BGTVT',
    "updated_at" = now()
WHERE "sign_code" = 'W.224';

UPDATE "traffic_sign_types"
SET "category_id" = 2,
    "shape" = 'TRIANGLE',
    "color_scheme" = 'RED_YELLOW',
    "description" = 'Biển báo Công trường đang thi công theo quy chuẩn QCVN 41:2019/BGTVT',
    "updated_at" = now()
WHERE "sign_code" = 'W.227';

UPDATE "traffic_sign_types"
SET "category_id" = 6,
    "shape" = 'ROUND',
    "color_scheme" = 'RED_WHITE',
    "description" = 'Biển báo Cấm xe chở hàng nguy hiểm theo quy chuẩn QCVN 41:2019/BGTVT',
    "updated_at" = now()
WHERE "sign_code" = 'P.106c';

UPDATE "traffic_sign_types"
SET "category_id" = 6,
    "shape" = 'ROUND',
    "color_scheme" = 'RED_WHITE',
    "description" = 'Biển báo Cấm xe súc vật kéo / xe thô sơ theo quy chuẩn QCVN 41:2019/BGTVT',
    "updated_at" = now()
WHERE "sign_code" = 'P.114';

UPDATE "traffic_sign_types"
SET "category_id" = 6,
    "shape" = 'ROUND',
    "color_scheme" = 'RED_WHITE',
    "description" = 'Biển báo Cấm xe ô tô và xe mô tô theo quy chuẩn QCVN 41:2019/BGTVT',
    "updated_at" = now()
WHERE "sign_code" = 'P.105';

UPDATE "traffic_sign_types"
SET "category_id" = 7,
    "shape" = 'RECTANGLE',
    "color_scheme" = 'BLUE_WHITE',
    "description" = 'Biển báo Vị trí người đi bộ sang đường theo quy chuẩn QCVN 41:2019/BGTVT',
    "updated_at" = now()
WHERE "sign_code" = 'I.423a' AND "category_id" = 1;

-- 3. Warning sign coded as Mandatory: W.210 -> WARNING (category_id = 2)
UPDATE "traffic_sign_types"
SET "category_id" = 2,
    "shape" = 'TRIANGLE',
    "color_scheme" = 'RED_YELLOW',
    "description" = 'Biển báo Giao nhau với đường sắt có rào chắn theo quy chuẩn QCVN 41:2019/BGTVT',
    "updated_at" = now()
WHERE "sign_code" = 'W.210';

-- 4. Description mismatch on W.220 -> Steep ascent 5%
UPDATE "traffic_sign_types"
SET "description" = 'Biển báo Dốc lên nguy hiểm 5% theo quy chuẩn QCVN 41:2019/BGTVT',
    "shape" = 'TRIANGLE',
    "color_scheme" = 'RED_YELLOW',
    "updated_at" = now()
WHERE "sign_code" = 'W.220';

-- 5. Fix CLIP prompts for IDs 1 to 6
UPDATE "sign_type_ai_prompts"
SET "prompt_text" = 'A Vietnamese traffic sign ''W.224'' meaning Pedestrian crossing ahead.'
WHERE "sign_type_id" = 1 AND "target_model" = 'CLIP';

UPDATE "sign_type_ai_prompts"
SET "prompt_text" = 'A Vietnamese traffic sign ''W.227'' meaning Road works.'
WHERE "sign_type_id" = 2 AND "target_model" = 'CLIP';

UPDATE "sign_type_ai_prompts"
SET "prompt_text" = 'A Vietnamese traffic sign ''P.102'' meaning No entry.'
WHERE "sign_type_id" = 3 AND "target_model" = 'CLIP';

UPDATE "sign_type_ai_prompts"
SET "prompt_text" = 'A Vietnamese traffic sign ''I.423a'' meaning Pedestrian crossing zone.'
WHERE "sign_type_id" = 4 AND "target_model" = 'CLIP';

UPDATE "sign_type_ai_prompts"
SET "prompt_text" = 'A Vietnamese traffic sign ''W.220'' meaning Steep ascent 5 percent.'
WHERE "sign_type_id" = 5 AND "target_model" = 'CLIP';

UPDATE "sign_type_ai_prompts"
SET "prompt_text" = 'A Vietnamese traffic sign ''W.210'' meaning Railway crossing with gates.'
WHERE "sign_type_id" = 6 AND "target_model" = 'CLIP';

COMMIT;
