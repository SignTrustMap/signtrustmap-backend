-- 014_add_support_shot_management_fields.sql
-- Adds role, is_pinned, and sharpness fields to sign_type_images for few-shot support management

ALTER TABLE "sign_type_images"
  ADD COLUMN IF NOT EXISTS "role" varchar(50) DEFAULT 'MEDOID',
  ADD COLUMN IF NOT EXISTS "is_pinned" boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS "sharpness" double precision;
