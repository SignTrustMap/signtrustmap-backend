-- seed-admin.sql — idempotent admin seed for SignTrustMap
-- Email: admin@stm.dev / Password: Admin@123 (bcrypt hash below)
-- Run: psql -U stm_user -d signtrustmap -f seed-admin.sql
-- Or: docker exec -i stm-postgres psql -U stm_user -d signtrustmap -f /tmp/seed-admin.sql

-- ---------------------------------------------------------------------------
-- Seed the application roles FIRST (schema.postgres.sql only creates the table,
-- it does NOT populate it). Idempotent: ON CONFLICT keeps existing rows.
-- These codes are referenced by @Roles(...) guards and by register() default role.
-- ---------------------------------------------------------------------------
INSERT INTO "roles" ("code", "name_vi", "name_en", "description") VALUES
  ('SURVEYOR',  'Người khảo sát',  'Surveyor',   'Gửi ảnh/video/đường đi để đóng góp biển báo'),
  ('DRIVER',    'Tài xế',          'Driver',     'Tài xế thu thập dữ liệu trong quá trình di chuyển'),
  ('REVIEWER',  'Người duyệt',     'Reviewer',   'Phê duyệt / từ chối candidate signs'),
  ('MODERATOR', 'Điều phối viên',  'Moderator',  'Xử lý tranh chấp và escalated moderation'),
  ('STAFF',     'Nhân viên',       'Staff',      'Nhân viên vận hành, finalize revalidation'),
  ('ADMIN',     'Quản trị viên',   'Administrator', 'Quản trị toàn hệ thống')
ON CONFLICT ("code") DO NOTHING;

DO $$
DECLARE
  admin_id uuid;
  admin_role_id smallint;
BEGIN
  SELECT id INTO admin_role_id FROM roles WHERE code = 'ADMIN';
  IF admin_role_id IS NULL THEN
    RAISE EXCEPTION 'Role ADMIN not found — check schema.postgres.sql seed for roles';
  END IF;

  -- Upsert user (ON CONFLICT updates password/full_name, keeps id)
  INSERT INTO users (email, password_hash, full_name, status)
  VALUES (
    'admin@stm.dev',
    '$2a$10$Q6akvXznblgel4lxmg4ZB.pzviz.slAY8birOzDp43xZxzewBYpbW',
    'STM Admin',
    'ACTIVE'
  )
  ON CONFLICT (email) DO UPDATE
    SET password_hash = EXCLUDED.password_hash,
        full_name     = EXCLUDED.full_name,
        status        = 'ACTIVE',
        updated_at    = now()
  RETURNING id INTO admin_id;

  IF admin_id IS NULL THEN
    SELECT id INTO admin_id FROM users WHERE email = 'admin@stm.dev';
  END IF;

  -- Ensure ACTIVE role assignment
  IF NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = admin_id AND role_id = admin_role_id) THEN
    INSERT INTO user_roles (user_id, role_id, is_active, assigned_by)
    VALUES (admin_id, admin_role_id, true, admin_id);
  ELSE
    UPDATE user_roles SET is_active = true WHERE user_id = admin_id AND role_id = admin_role_id;
  END IF;

  -- Ensure wallet (required by app logic, balance = 0)
  IF NOT EXISTS (SELECT 1 FROM wallets WHERE user_id = admin_id) THEN
    INSERT INTO wallets (user_id, balance) VALUES (admin_id, 0);
  END IF;

  -- Ensure admin_profiles row (optional but matches schema)
  IF NOT EXISTS (SELECT 1 FROM admin_profiles WHERE user_id = admin_id) THEN
    INSERT INTO admin_profiles (user_id, admin_level) VALUES (admin_id, 1);
  END IF;

  RAISE NOTICE 'Admin ready: % (id=%) role=ADMIN', 'admin@stm.dev', admin_id;
END $$;

-- Verification query (shows result of seed)
SELECT u.id, u.email, u.full_name, u.status, w.balance,
       array_agg(r.code) FILTER (WHERE r.code IS NOT NULL) AS roles
FROM users u
LEFT JOIN wallets w ON w.user_id = u.id
LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.is_active = true
LEFT JOIN roles r ON r.id = ur.role_id
WHERE u.email = 'admin@stm.dev'
GROUP BY u.id, w.balance;
