-- Migration: Support multi-round candidate voting & bounty reset on new-sign release
BEGIN;

ALTER TABLE "unverified_sign_candidates"
  ADD COLUMN IF NOT EXISTS "review_round" integer NOT NULL DEFAULT 1;

ALTER TABLE "candidate_reviews"
  ADD COLUMN IF NOT EXISTS "review_round" integer NOT NULL DEFAULT 1;

-- Drop any legacy unique constraint or index covering only (candidate_id, reviewer_id)
DO $$
DECLARE
  idx_record RECORD;
  con_record RECORD;
BEGIN
  FOR con_record IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'candidate_reviews'
      AND c.contype = 'u'
      AND (
        SELECT array_agg(a.attname::text ORDER BY u.ord)
        FROM unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = u.attnum
      ) = ARRAY['candidate_id', 'reviewer_id']
  LOOP
    EXECUTE format('ALTER TABLE "candidate_reviews" DROP CONSTRAINT IF EXISTS %I', con_record.conname);
  END LOOP;

  FOR idx_record IN
    SELECT i.relname AS index_name
    FROM pg_index ix
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_class t ON t.oid = ix.indrelid
    WHERE t.relname = 'candidate_reviews'
      AND ix.indisunique = true
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint c WHERE c.conindid = ix.indexrelid
      )
      AND (
        SELECT array_agg(a.attname::text ORDER BY u.ord)
        FROM unnest(ix.indkey) WITH ORDINALITY AS u(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = u.attnum
      ) = ARRAY['candidate_id', 'reviewer_id']
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %I', idx_record.index_name);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_candidate_reviews_candidate_reviewer_round"
  ON "candidate_reviews" ("candidate_id", "reviewer_id", "review_round");

CREATE INDEX IF NOT EXISTS "idx_candidate_reviews_candidate_round"
  ON "candidate_reviews" ("candidate_id", "review_round");

COMMIT;
