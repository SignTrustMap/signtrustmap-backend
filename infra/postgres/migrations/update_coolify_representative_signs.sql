-- =============================================================================
-- update_coolify_representative_signs.sql
-- Run this in Coolify PostgreSQL terminal to sync representative sign types
-- =============================================================================

BEGIN;

-- 1. Cập nhật Bệnh viện (I.425 thay vì I.428)
UPDATE "traffic_sign_types"
SET "sign_code" = 'I.425',
    "name_vi" = 'Bệnh viện',
    "name_en" = 'Hospital',
    "category_id" = 4,
    "shape" = 'RECTANGLE',
    "color_scheme" = 'BLUE_WHITE',
    "updated_at" = now()
WHERE "sign_code" = 'I.428' OR "name_en" = 'Hospital';

-- 2. Cập nhật Chợ (I.442 thay vì W.234)
UPDATE "traffic_sign_types"
SET "sign_code" = 'I.442',
    "name_vi" = 'Chợ',
    "name_en" = 'Market',
    "category_id" = 4,
    "shape" = 'RECTANGLE',
    "color_scheme" = 'BLUE_WHITE',
    "updated_at" = now()
WHERE "sign_code" = 'W.234' OR "name_en" = 'Market';

-- 3. Cập nhật Cấm xe súc vật kéo (P.114 thay vì P.113)
UPDATE "traffic_sign_types"
SET "sign_code" = 'P.114',
    "name_vi" = 'Cấm xe súc vật kéo / xe thô sơ',
    "name_en" = 'No slow moving vehicles',
    "category_id" = 1,
    "shape" = 'ROUND',
    "color_scheme" = 'RED_WHITE',
    "updated_at" = now()
WHERE "sign_code" = 'P.113' OR "name_en" = 'No slow moving vehicles';

-- 4. Cập nhật Đường hầm (I.441a thay vì W.240)
UPDATE "traffic_sign_types"
SET "sign_code" = 'I.441a',
    "name_vi" = 'Đường hầm',
    "name_en" = 'Tunnel',
    "category_id" = 4,
    "shape" = 'RECTANGLE',
    "color_scheme" = 'BLUE_WHITE',
    "updated_at" = now()
WHERE ("sign_code" = 'W.240' AND "name_en" = 'Tunnel') OR "name_en" = 'Tunnel';

-- 5. Cập nhật Kè vực sâu phía trước (W.215a thay vì W.216a)
UPDATE "traffic_sign_types"
SET "sign_code" = 'W.215a',
    "name_vi" = 'Vách núi / Kè vực sâu nguy hiểm',
    "name_en" = 'Cliff ahead',
    "category_id" = 2,
    "shape" = 'TRIANGLE',
    "color_scheme" = 'RED_WHITE',
    "updated_at" = now()
WHERE "sign_code" = 'W.216a' OR "name_en" = 'Cliff ahead';

-- 6. Cập nhật Cấm xe ô tô và xe mô tô (P.105)
UPDATE "traffic_sign_types"
SET "sign_code" = 'P.105',
    "name_vi" = 'Cấm xe ô tô và xe mô tô',
    "name_en" = 'No cars and motorcycles',
    "category_id" = 1,
    "shape" = 'ROUND',
    "color_scheme" = 'RED_WHITE',
    "updated_at" = now()
WHERE "sign_code" = 'P.105' OR "name_en" = 'No motorcycles and slow vehicles';

-- 7. Cập nhật Hết đường hầm (I.441b thay vì I.441a)
UPDATE "traffic_sign_types"
SET "sign_code" = 'I.441b',
    "name_vi" = 'Hết đường hầm',
    "name_en" = 'End tunnel',
    "category_id" = 4,
    "shape" = 'RECTANGLE',
    "color_scheme" = 'BLUE_WHITE',
    "updated_at" = now()
WHERE ("sign_code" = 'I.441a' AND "name_en" = 'End tunnel') OR "name_en" = 'End tunnel';

-- 8. Cập nhật Cấm xe chở hàng nguy hiểm (P.106c thay vì P.109)
UPDATE "traffic_sign_types"
SET "sign_code" = 'P.106c',
    "name_vi" = 'Cấm xe chở hàng nguy hiểm',
    "name_en" = 'No vehicles carrying dangerous goods',
    "category_id" = 1,
    "shape" = 'ROUND',
    "color_scheme" = 'RED_WHITE',
    "updated_at" = now()
WHERE "sign_code" = 'P.109' OR "name_en" = 'No vehicles carrying dangerous goods';

-- 9. Cập nhật Đường hầm / Hầm chui xe chạy (W.240 thay vì I.424b)
UPDATE "traffic_sign_types"
SET "sign_code" = 'W.240',
    "name_vi" = 'Đường hầm / Hầm chui',
    "name_en" = 'Underpass',
    "category_id" = 2,
    "shape" = 'TRIANGLE',
    "color_scheme" = 'RED_YELLOW',
    "updated_at" = now()
WHERE "sign_code" = 'I.424b' OR "name_en" = 'Underpass';

-- 10. Đồng bộ URL ảnh đại diện trong sign_type_images (nếu có bản ghi)
UPDATE "sign_type_images" sti
SET "image_url" = 'https://s3.signmap.site/stm-sign-crops/representative/' || UPPER(REPLACE(REPLACE(tst.name_en, ' ', '_'), '-', '_')) || '.png'
FROM "traffic_sign_types" tst
WHERE sti."sign_type_id" = tst."id" AND sti."image_type" = 'REPRESENTATIVE';

COMMIT;

-- Kiểm tra lại sau khi cập nhật:
SELECT id, category_id, sign_code, name_vi, name_en, shape, color_scheme
FROM "traffic_sign_types"
WHERE name_en IN ('Hospital', 'Market', 'No slow moving vehicles', 'Tunnel', 'Cliff ahead', 'No cars and motorcycles', 'End tunnel', 'No vehicles carrying dangerous goods', 'Underpass')
ORDER BY id;
