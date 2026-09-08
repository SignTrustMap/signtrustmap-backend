-- =============================================================================
-- schema.addendum.sql
-- Append this file to schema.postgres.sql  (psql -f schema.postgres.sql
--                                           -f schema.addendum.sql)
-- Covers:
--   1. Chunked media upload tracking  (Flow 1 resumable upload)
--   2. Survey trajectories – GPX LineString (Flow 3 spatio-temporal sync)
--   3. Materialized view – community leaderboard (FR 2.9 / Flow 11)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. ENUM: upload chunk status
-- ---------------------------------------------------------------------------
CREATE TYPE "upload_status" AS ENUM (
  'INITIATED',
  'UPLOADING',
  'ASSEMBLING',
  'COMPLETED',
  'FAILED',
  'EXPIRED'
);

-- ---------------------------------------------------------------------------
-- 2. TABLE: upload_sessions
-- ---------------------------------------------------------------------------
CREATE TABLE "upload_sessions" (
  "id"                uuid            PRIMARY KEY DEFAULT (gen_random_uuid()),
  "user_id"           uuid            NOT NULL,
  "original_filename" varchar(500)    NOT NULL,
  "media_type"        media_file_type NOT NULL,
  "total_size_bytes"  bigint          NOT NULL,
  "total_chunks"      int             NOT NULL,
  "received_chunks"   int             NOT NULL DEFAULT 0,
  "checksum_expected" varchar(128),
  "storage_key"       varchar(500),
  "status"            upload_status   NOT NULL DEFAULT 'INITIATED',
  "submission_id"     uuid            NOT NULL,
  "expires_at"        timestamptz     NOT NULL,
  "created_at"        timestamptz     NOT NULL DEFAULT (now()),
  "updated_at"        timestamptz     NOT NULL DEFAULT (now()),
  CONSTRAINT "chk_received_le_total" CHECK ("received_chunks" <= "total_chunks")
);

COMMENT ON TABLE "upload_sessions" IS
  'Quan ly mot phien upload phan manh (chunked/resumable). '
  'Moi session anh xa toi mot file logic (video, GPX, anh). '
  'Submission duoc tao truoc; moi session gan voi mot submission va mot media file logic.';

COMMENT ON COLUMN "upload_sessions"."storage_key" IS
  'MinIO object key cua file da ghep, dang: uploads/{user_id}/{submission_id}/{session_id}/original_filename.';

COMMENT ON COLUMN "upload_sessions"."checksum_expected" IS
  'SHA-256 do client tinh truoc; backend so sanh sau assembly de phat hien loi truyen.';

-- ---------------------------------------------------------------------------
-- 3. TABLE: upload_chunks
-- ---------------------------------------------------------------------------
CREATE TABLE "upload_chunks" (
  "id"          BIGSERIAL   PRIMARY KEY,
  "session_id"  uuid        NOT NULL,
  "chunk_index" int         NOT NULL,
  "size_bytes"  int         NOT NULL,
  "storage_key" varchar(500) NOT NULL,
  "checksum"    varchar(128),
  "uploaded_at" timestamptz NOT NULL DEFAULT (now()),
  CONSTRAINT "chk_chunk_index_positive" CHECK ("chunk_index" >= 0)
);

COMMENT ON TABLE "upload_chunks" IS
  'Luu tung phan (part) cua mot chunked upload session. '
  'Khi client resume, backend tra danh sach chunk_index da nhan.';

COMMENT ON COLUMN "upload_chunks"."chunk_index" IS
  '0-based; client chia file thanh N phan va danh so 0..N-1.';

CREATE UNIQUE INDEX ON "upload_chunks" ("session_id", "chunk_index");
CREATE INDEX ON "upload_sessions" ("user_id", "status");
CREATE INDEX ON "upload_sessions" ("submission_id");
CREATE INDEX ON "upload_sessions" ("expires_at")
  WHERE "status" NOT IN ('COMPLETED', 'FAILED', 'EXPIRED');

ALTER TABLE "upload_sessions"
  ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id") DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "upload_sessions"
  ADD FOREIGN KEY ("submission_id") REFERENCES "survey_submissions" ("id") DEFERRABLE INITIALLY IMMEDIATE;
CREATE UNIQUE INDEX "uq_submission_media_files_upload_session"
  ON "submission_media_files" ("upload_session_id")
  WHERE "upload_session_id" IS NOT NULL;
ALTER TABLE "submission_media_files"
  ADD FOREIGN KEY ("upload_session_id") REFERENCES "upload_sessions" ("id") DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "upload_chunks"
  ADD FOREIGN KEY ("session_id") REFERENCES "upload_sessions" ("id") ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
-- ---------------------------------------------------------------------------
-- 4. TABLE: survey_trajectories  (GPX → PostGIS LineString)
-- ---------------------------------------------------------------------------
CREATE TABLE "survey_trajectories" (
  "id"                uuid                        PRIMARY KEY DEFAULT (gen_random_uuid()),
  "submission_id"     uuid                        UNIQUE NOT NULL,
  "trajectory"        geometry(LineString, 4326)  NOT NULL,
  "total_distance_m"  float,
  "duration_seconds"  float,
  "start_time"        timestamptz,
  "end_time"          timestamptz,
  "avg_speed_kmh"     float,
  "point_count"       int                         NOT NULL DEFAULT 0,
  "gpx_media_file_id" uuid,
  "created_at"        timestamptz                 NOT NULL DEFAULT (now()),
  "updated_at"        timestamptz                 NOT NULL DEFAULT (now())
);

COMMENT ON TABLE "survey_trajectories" IS
  'Luu quy dao GPS cua mot chuyen survey duoi dang LineString PostGIS (SRID 4326). '
  'Ghi boi FastAPI spatio-temporal synchronizer sau khi parse file GPX (FR 4.1, Flow 3). '
  'Dung de dong bo timestamp video frame <-> toa do GPS, tinh bearing, va xac dinh traffic_direction.';

COMMENT ON COLUMN "survey_trajectories"."trajectory" IS
  'LineString WGS-84 gom cac diem (lon, lat) theo thu tu thoi gian tu file GPX.';

COMMENT ON COLUMN "survey_trajectories"."total_distance_m" IS
  'Tong do dai quy dao (met) tinh theo Haversine / ST_Length(geography).';

CREATE INDEX ON "survey_trajectories" USING GIST ("trajectory");
CREATE INDEX ON "survey_trajectories" ("submission_id");
CREATE INDEX ON "survey_trajectories" ("created_at") WHERE "point_count" > 0;

ALTER TABLE "survey_trajectories"
  ADD FOREIGN KEY ("submission_id") REFERENCES "survey_submissions" ("id") DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "survey_trajectories"
  ADD FOREIGN KEY ("gpx_media_file_id") REFERENCES "submission_media_files" ("id") DEFERRABLE INITIALLY IMMEDIATE;

-- ---------------------------------------------------------------------------
-- 5. MATERIALIZED VIEW: mv_community_leaderboard (FR 2.9 / Flow 11)
--    Refreshed by Celery beat every 15 minutes.
--    Exposed via FastAPI GET /leaderboard (Redis cache on top).
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW "mv_community_leaderboard" AS
WITH reviewer_stats AS (
  SELECT
    u.id                          AS user_id,
    u.full_name,
    u.avatar_url,
    COALESCE(rp.total_reviews, 0)   AS total_reviews,
    COALESCE(rp.correct_reviews, 0) AS correct_reviews,
    COALESCE(rp.accuracy_rate, 0)   AS accuracy_rate,
    COALESCE(rp.reliability_score, 0) AS reliability_score,
    COALESCE(rp.current_streak, 0)  AS current_streak
  FROM "users"              u
  JOIN "reviewer_profiles" rp ON rp.user_id = u.id
),
surveyor_stats AS (
  SELECT
    sp.user_id,
    COALESCE(sp.total_submissions, 0)      AS total_submissions,
    COALESCE(sp.total_verified_signs, 0)   AS total_verified_signs,
    COALESCE(sp.total_credits_earned, 0)   AS total_credits_earned
  FROM "surveyor_profiles" sp
),
wallet_stats AS (
  SELECT
    w.user_id,
    COALESCE(w.balance, 0) AS current_balance,
    COALESCE(
      (SELECT SUM(ct.amount)
       FROM "credit_transactions" ct
       WHERE ct.wallet_id = w.id AND ct.amount > 0), 0
    ) AS lifetime_credits_earned
  FROM "wallets" w
)
SELECT
  rs.user_id,
  rs.full_name,
  rs.avatar_url,
  rs.total_reviews,
  rs.correct_reviews,
  rs.accuracy_rate,
  rs.reliability_score,
  rs.current_streak,
  COALESCE(ss.total_submissions, 0)    AS total_submissions,
  COALESCE(ss.total_verified_signs, 0) AS total_verified_signs,
  COALESCE(ws.current_balance, 0)      AS current_balance,
  COALESCE(ws.lifetime_credits_earned, 0) AS lifetime_credits_earned,
  ROUND(
    (
      0.40 * rs.reliability_score * 100
    + 0.30 * rs.accuracy_rate * 100
    + 0.20 * COALESCE(ss.total_verified_signs, 0)
    + 0.10 * rs.total_reviews
    )::numeric, 2
  ) AS composite_score,
  ROW_NUMBER() OVER (
    ORDER BY
      (0.40 * rs.reliability_score * 100
     + 0.30 * rs.accuracy_rate * 100
     + 0.20 * COALESCE(ss.total_verified_signs, 0)
     + 0.10 * rs.total_reviews) DESC
  ) AS rank,
  now() AS last_refreshed_at
FROM reviewer_stats rs
LEFT JOIN surveyor_stats ss ON ss.user_id = rs.user_id
LEFT JOIN wallet_stats  ws ON ws.user_id = rs.user_id
WITH DATA;

COMMENT ON MATERIALIZED VIEW "mv_community_leaderboard" IS
  'Bang xep hang cong dong: tong hop chi so reviewer & surveyor (FR 2.9, Flow 11). '
  'Duoc refresh dinh ky boi Celery beat (15 phut). '
  'composite_score = 40% reliability_score + 30% accuracy_rate + 20% verified_signs + 10% total_reviews.';

-- Required for REFRESH MATERIALIZED VIEW CONCURRENTLY
CREATE UNIQUE INDEX ON "mv_community_leaderboard" ("user_id");
CREATE INDEX ON "mv_community_leaderboard" ("composite_score" DESC);
CREATE INDEX ON "mv_community_leaderboard" ("rank");

-- Helper function (optional): concurrent refresh callable by Celery / pg_cron
CREATE OR REPLACE FUNCTION refresh_community_leaderboard()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY "mv_community_leaderboard";
END $$;
