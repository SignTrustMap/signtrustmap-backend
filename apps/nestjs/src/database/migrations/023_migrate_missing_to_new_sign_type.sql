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

-- 4. In candidate_recapture_requests, support both new_sign_type_report_id and missing_type_report_id
ALTER TABLE candidate_recapture_requests ADD COLUMN IF NOT EXISTS new_sign_type_report_id UUID;
ALTER TABLE candidate_recapture_requests ADD COLUMN IF NOT EXISTS missing_type_report_id UUID;

UPDATE candidate_recapture_requests
SET new_sign_type_report_id = COALESCE(new_sign_type_report_id, missing_type_report_id),
    missing_type_report_id = COALESCE(missing_type_report_id, new_sign_type_report_id);

CREATE OR REPLACE FUNCTION sync_candidate_recapture_report_ids()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.new_sign_type_report_id IS NULL AND NEW.missing_type_report_id IS NOT NULL THEN
    NEW.new_sign_type_report_id := NEW.missing_type_report_id;
  ELSIF NEW.missing_type_report_id IS NULL AND NEW.new_sign_type_report_id IS NOT NULL THEN
    NEW.missing_type_report_id := NEW.new_sign_type_report_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_candidate_recapture_report_ids ON candidate_recapture_requests;
CREATE TRIGGER trg_sync_candidate_recapture_report_ids
BEFORE INSERT OR UPDATE ON candidate_recapture_requests
FOR EACH ROW EXECUTE FUNCTION sync_candidate_recapture_report_ids();

-- 5. Backward-compatibility view for missing_sign_type_reports
CREATE OR REPLACE VIEW missing_sign_type_reports AS SELECT * FROM new_sign_type_reports;

-- 6. Migrate existing rows
UPDATE unverified_sign_candidates SET status = 'NEW_TYPE_HOLD' WHERE status = 'MISSING_TYPE_HOLD';
UPDATE review_flags SET flag_reason = 'NEW_SIGN_TYPE' WHERE flag_reason = 'MISSING_TYPE';

