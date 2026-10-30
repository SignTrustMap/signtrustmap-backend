-- Daily and weekly mission contribution history, badge grants, and ledger reward type.
ALTER TYPE "transaction_type" ADD VALUE IF NOT EXISTS 'MISSION_REWARD';

CREATE TABLE IF NOT EXISTS "mission_contribution_events" (
    "id" BIGSERIAL PRIMARY KEY,
    "user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
    "event_type" varchar(32) NOT NULL
        CHECK ("event_type" IN ('VERIFIED_SIGN', 'APPROVED_ANOMALY')),
    "source_id" uuid NOT NULL,
    "occurred_at" timestamptz NOT NULL DEFAULT NOW(),
    CONSTRAINT "uq_mission_contribution_user_event_source"
        UNIQUE ("user_id", "event_type", "source_id")
);

CREATE INDEX IF NOT EXISTS "idx_mission_contribution_user_occurred"
    ON "mission_contribution_events" ("user_id", "occurred_at");

CREATE TABLE IF NOT EXISTS "user_badges" (
    "user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
    "badge_code" varchar(64) NOT NULL,
    "earned_at" timestamptz NOT NULL DEFAULT NOW(),
    CONSTRAINT "pk_user_badges" PRIMARY KEY ("user_id", "badge_code")
);

INSERT INTO "system_parameters" ("key", "value", "description")
VALUES (
    'MISSIONS_STREAK_BONUS_CREDITS',
    '0',
    'Credits granted at each consecutive seven-day streak milestone; configure to a non-negative integer. The badge itself is granted once.'
)
ON CONFLICT ("key") DO NOTHING;
