-- Migration: 023_migrate_missing_to_new_sign_type.sql
-- Description: Standardize domain from "missing sign type" to "new sign type"

-- 1. Enum candidate_status: add NEW_TYPE_HOLD
ALTER TYPE candidate_status ADD VALUE IF NOT EXISTS 'NEW_TYPE_HOLD';

-- 2. Enum review_flag_reason: add NEW_SIGN_TYPE
ALTER TYPE review_flag_reason ADD VALUE IF NOT EXISTS 'NEW_SIGN_TYPE';

-- 3. Rename table missing_sign_type_reports -> new_sign_type_reports
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'missing_sign_type_reports')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'new_sign_type_reports') THEN
    ALTER TABLE missing_sign_type_reports RENAME TO new_sign_type_reports;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'missing_sign_type_report_evidences')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'new_sign_type_report_evidences') THEN
    ALTER TABLE missing_sign_type_report_evidences RENAME TO new_sign_type_report_evidences;
  END IF;
END $$;

-- 4. In candidate_recapture_requests, rename or add new_sign_type_report_id
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'candidate_recapture_requests' AND column_name = 'missing_type_report_id')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'candidate_recapture_requests' AND column_name = 'new_sign_type_report_id') THEN
    ALTER TABLE candidate_recapture_requests RENAME COLUMN missing_type_report_id TO new_sign_type_report_id;
  END IF;
END $$;

-- 5. Backward-compatibility view for missing_sign_type_reports
CREATE OR REPLACE VIEW missing_sign_type_reports AS SELECT * FROM new_sign_type_reports;

-- 6. Migrate existing rows
UPDATE unverified_sign_candidates SET status = 'NEW_TYPE_HOLD' WHERE status = 'MISSING_TYPE_HOLD';
UPDATE review_flags SET reason = 'NEW_SIGN_TYPE' WHERE reason = 'MISSING_TYPE';

