-- Seed core sign category and sample traffic sign types for AI pipeline & review mapping
INSERT INTO sign_categories (id, code, name_vi, name_en, sort_order)
VALUES (1, 'PROHIBITION', 'Biển báo cấm', 'Prohibitory signs', 1)
ON CONFLICT (code) DO NOTHING;

INSERT INTO traffic_sign_types (id, category_id, sign_code, name_vi, name_en, is_active)
VALUES 
  (1, 1, 'P.102', 'Cấm đi ngược chiều', 'No Entry', true),
  (2, 1, 'P.127', 'Tốc độ tối đa cho phép', 'Maximum Speed Limit', true)
ON CONFLICT (sign_code) DO NOTHING;
