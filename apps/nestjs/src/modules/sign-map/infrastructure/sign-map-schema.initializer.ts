import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SpatialAdminBackfillService } from '../../spatial-admin/application/spatial-admin-backfill.service';

@Injectable()
export class SignMapSchemaInitializer implements OnModuleInit {
  private readonly logger = new Logger(SignMapSchemaInitializer.name);

  constructor(
    private readonly dataSource: DataSource,
    @Optional()
    private readonly backfillService?: SpatialAdminBackfillService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.dataSource.query(`
        ALTER TABLE "traffic_sign_types"
          ADD COLUMN IF NOT EXISTS "allowed_vehicles" text[]
            NOT NULL DEFAULT ARRAY['CAR','MOTORCYCLE','TRUCK','BUS','BICYCLE','PEDESTRIAN']::text[];
        CREATE TABLE IF NOT EXISTS "driver_profiles" (
          user_id uuid PRIMARY KEY,
          default_vehicle_type varchar(30) DEFAULT 'CAR',
          enabled_categories text[] DEFAULT ARRAY['SPEED_LIMIT','WARNING','PROHIBITION','MANDATORY','INFORMATION'],
          total_nav_sessions int NOT NULL DEFAULT 0,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        ALTER TABLE "driver_profiles"
          ADD COLUMN IF NOT EXISTS "enabled_categories" text[]
            DEFAULT ARRAY['SPEED_LIMIT','WARNING','PROHIBITION','MANDATORY','INFORMATION'];

        -- Ensure 2-tier administrative boundary tables and road network exist
        CREATE TABLE IF NOT EXISTS "admin_provinces" (
          "code" VARCHAR(2) PRIMARY KEY,
          "name" VARCHAR(100) NOT NULL,
          "type" VARCHAR(30) NOT NULL DEFAULT 'PROVINCE',
          "geometry" GEOMETRY(MultiPolygon, 4326),
          "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS "idx_admin_provinces_geom" ON "admin_provinces" USING GIST ("geometry");

        CREATE TABLE IF NOT EXISTS "admin_communes" (
          "code" VARCHAR(5) PRIMARY KEY,
          "province_code" VARCHAR(2) NOT NULL REFERENCES "admin_provinces"("code") ON DELETE CASCADE,
          "name" VARCHAR(120) NOT NULL,
          "type" VARCHAR(30) NOT NULL DEFAULT 'WARD',
          "geometry" GEOMETRY(MultiPolygon, 4326) NOT NULL,
          "legacy_district_name" VARCHAR(100),
          "legacy_ward_name" VARCHAR(100),
          "search_tsv" TSVECTOR,
          "valid_from" DATE DEFAULT '2025-07-01',
          "valid_to" DATE,
          "boundary_version" VARCHAR(20) DEFAULT '2025-07-01'
        );
        CREATE INDEX IF NOT EXISTS "idx_admin_communes_geom" ON "admin_communes" USING GIST ("geometry");
        CREATE INDEX IF NOT EXISTS "idx_admin_communes_search" ON "admin_communes" USING GIN ("search_tsv");

        CREATE TABLE IF NOT EXISTS "osm_roads" (
          "id" BIGSERIAL PRIMARY KEY,
          "osm_id" BIGINT,
          "name" VARCHAR(255) NOT NULL,
          "ref" VARCHAR(50),
          "highway" VARCHAR(50) DEFAULT 'residential',
          "geometry" GEOMETRY(LineString, 4326) NOT NULL
        );
        CREATE INDEX IF NOT EXISTS "idx_osm_roads_geom" ON "osm_roads" USING GIST ("geometry");

        -- Ensure columns on verified_traffic_signs
        ALTER TABLE "verified_traffic_signs"
          ADD COLUMN IF NOT EXISTS "commune_code" VARCHAR(5) REFERENCES "admin_communes"("code") ON DELETE SET NULL,
          ADD COLUMN IF NOT EXISTS "road_name" VARCHAR(255),
          ADD COLUMN IF NOT EXISTS "display_address" TEXT;
        CREATE INDEX IF NOT EXISTS "idx_verified_signs_commune" ON "verified_traffic_signs" ("commune_code");

        -- Seed initial administrative units if empty
        INSERT INTO "admin_provinces" ("code", "name", "type", "geometry")
        VALUES
          ('01', 'Thành phố Hà Nội', 'MUNICIPALITY', ST_Multi(ST_GeomFromText('POLYGON((105.7 20.9, 106.0 20.9, 106.0 21.2, 105.7 21.2, 105.7 20.9))', 4326))),
          ('79', 'Thành phố Hồ Chí Minh', 'MUNICIPALITY', ST_Multi(ST_GeomFromText('POLYGON((106.3 10.3, 107.0 10.3, 107.0 11.2, 106.3 11.2, 106.3 10.3))', 4326))),
          ('48', 'Thành phố Đà Nẵng', 'MUNICIPALITY', ST_Multi(ST_GeomFromText('POLYGON((107.9 15.9, 108.4 15.9, 108.4 16.3, 107.9 16.3, 107.9 15.9))', 4326)))
        ON CONFLICT ("code") DO NOTHING;

        INSERT INTO "admin_communes" ("code", "province_code", "name", "type", "geometry", "legacy_district_name", "legacy_ward_name")
        VALUES
          ('26801', '79', 'Phường Thủ Đức', 'WARD',
           ST_Multi(ST_GeomFromText('POLYGON((106.75 10.84, 106.78 10.84, 106.78 10.87, 106.75 10.87, 106.75 10.84))', 4326)),
           'Thành phố Thủ Đức', 'Phường Linh Chiểu'),
          ('26802', '79', 'Phường Linh Trung', 'WARD',
           ST_Multi(ST_GeomFromText('POLYGON((106.77 10.85, 106.80 10.85, 106.80 10.88, 106.77 10.88, 106.77 10.85))', 4326)),
           'Thành phố Thủ Đức', 'Phường Linh Trung'),
          ('26803', '79', 'Phường Hiệp Bình', 'WARD',
           ST_Multi(ST_GeomFromText('POLYGON((106.70 10.84, 106.75 10.84, 106.75 10.87, 106.70 10.87, 106.70 10.84))', 4326)),
           'Thành phố Thủ Đức', 'Phường Hiệp Bình Chánh'),
          ('26804', '79', 'Phường Long Thạnh Mỹ', 'WARD',
           ST_Multi(ST_GeomFromText('POLYGON((106.80 10.83, 106.86 10.83, 106.86 10.88, 106.80 10.88, 106.80 10.83))', 4326)),
           'Thành phố Thủ Đức', 'Quận 9'),
          ('26806', '79', 'Phường Bến Nghé', 'WARD',
           ST_Multi(ST_GeomFromText('POLYGON((106.69 10.77, 106.71 10.77, 106.71 10.79, 106.69 10.79, 106.69 10.77))', 4326)),
           'Quận 1', 'Phường Bến Nghé')
        ON CONFLICT ("code") DO NOTHING;

        -- Seed road lines
        INSERT INTO "osm_roads" ("name", "ref", "highway", "geometry")
        VALUES
          ('Đường Võ Văn Ngân', 'Đ. Võ Văn Ngân', 'primary',
           ST_GeomFromText('LINESTRING(106.7580 10.8500, 106.7720 10.8550, 106.7780 10.8570)', 4326)),
          ('Xa lộ Hà Nội', 'QL52', 'trunk',
           ST_GeomFromText('LINESTRING(106.7200 10.8000, 106.7600 10.8400, 106.8000 10.8600, 106.8400 10.8800)', 4326)),
          ('Đường Phạm Văn Đồng', 'Đ. Phạm Văn Đồng', 'primary',
           ST_GeomFromText('LINESTRING(106.6600 10.8200, 106.7100 10.8600, 106.7600 10.8600)', 4326)),
          ('Đường Nguyễn Huệ', 'Đ. Nguyễn Huệ', 'pedestrian',
           ST_GeomFromText('LINESTRING(106.7020 10.7720, 106.7060 10.7750)', 4326))
        ON CONFLICT DO NOTHING;

        -- Phase 1: Double-Entry Wallet & Ledger Schema
        DO $$
        BEGIN
          BEGIN ALTER TYPE "transaction_type" ADD VALUE IF NOT EXISTS 'SIGN_DECOMMISSION_REWARD'; EXCEPTION WHEN duplicate_object THEN NULL; END;
          BEGIN ALTER TYPE "transaction_type" ADD VALUE IF NOT EXISTS 'HAZARD_REPORT_REWARD'; EXCEPTION WHEN duplicate_object THEN NULL; END;
          BEGIN ALTER TYPE "transaction_type" ADD VALUE IF NOT EXISTS 'HAZARD_CONFIRM_REWARD'; EXCEPTION WHEN duplicate_object THEN NULL; END;
          BEGIN ALTER TYPE "transaction_type" ADD VALUE IF NOT EXISTS 'CUSTOM_PROFILE_SPEND'; EXCEPTION WHEN duplicate_object THEN NULL; END;
          BEGIN ALTER TYPE "transaction_type" ADD VALUE IF NOT EXISTS 'REWARD_WITHHELD'; EXCEPTION WHEN duplicate_object THEN NULL; END;
        END $$;
        ALTER TABLE "wallets" ADD COLUMN IF NOT EXISTS "is_frozen" BOOLEAN NOT NULL DEFAULT FALSE;
        ALTER TABLE "credit_transactions" ADD COLUMN IF NOT EXISTS "balance_after" BIGINT;
        ALTER TABLE "credit_transactions" ADD COLUMN IF NOT EXISTS "idempotency_key" VARCHAR(128);
        ALTER TABLE "credit_transactions" ADD COLUMN IF NOT EXISTS "metadata" JSONB DEFAULT '{}'::jsonb;
        CREATE UNIQUE INDEX IF NOT EXISTS "idx_credit_transactions_idempotency_key"
          ON "credit_transactions" ("idempotency_key") WHERE "idempotency_key" IS NOT NULL;
        CREATE INDEX IF NOT EXISTS "idx_credit_transactions_wallet_created"
          ON "credit_transactions" ("wallet_id", "created_at" DESC);

        -- Phase 2: Dynamic Reward Engine & Batch Survey Ingestion
        CREATE TABLE IF NOT EXISTS reward_rules (
          id SERIAL PRIMARY KEY,
          activity_type VARCHAR(64) NOT NULL UNIQUE,
          base_amount INT NOT NULL CHECK (base_amount >= 0),
          daily_limit INT NOT NULL DEFAULT 10,
          multiplier_config JSONB DEFAULT '{"reputation_bonus": true}'::jsonb,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          effective_to TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_reward_rules_activity ON reward_rules(activity_type);

        INSERT INTO reward_rules (activity_type, base_amount, daily_limit, multiplier_config, is_active)
        VALUES
          ('SURVEY_REWARD', 15, 20, '{"candidate_multiplier": true, "bonus_per_candidate": 5}'::jsonb, TRUE),
          ('REVIEW_REWARD', 5, 50, '{"reputation_bonus": true}'::jsonb, TRUE),
          ('REVALIDATION_REWARD', 20, 20, '{"urgency_bonus": true}'::jsonb, TRUE),
          ('SIGN_DECOMMISSION_REWARD', 30, 10, '{}'::jsonb, TRUE),
          ('HAZARD_REPORT_REWARD', 10, 15, '{}'::jsonb, TRUE),
          ('HAZARD_CONFIRM_REWARD', 2, 30, '{}'::jsonb, TRUE),
          ('DAILY_TASK_REWARD', 25, 5, '{}'::jsonb, TRUE),
          ('NAVIGATION_FEE', 5, 100, '{}'::jsonb, TRUE),
          ('CUSTOM_PROFILE_SPEND', 20, 10, '{}'::jsonb, TRUE)
        ON CONFLICT (activity_type) DO NOTHING;

        CREATE TABLE IF NOT EXISTS batch_submissions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title VARCHAR(255),
          total_images INT NOT NULL DEFAULT 0,
          processed_images INT NOT NULL DEFAULT 0,
          extracted_candidates INT NOT NULL DEFAULT 0,
          reward_status VARCHAR(32) NOT NULL DEFAULT 'PENDING' CHECK (reward_status IN ('NONE', 'PENDING', 'APPROVED', 'PAID', 'WITHHELD', 'REJECTED', 'REVERSED')),
          reward_amount INT NOT NULL DEFAULT 0,
          status VARCHAR(32) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
          metadata JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_batch_submissions_user ON batch_submissions(user_id, created_at DESC);

        ALTER TABLE survey_submissions ADD COLUMN IF NOT EXISTS reward_status VARCHAR(32) DEFAULT 'NONE';
        ALTER TABLE survey_submissions ADD COLUMN IF NOT EXISTS reward_amount INT DEFAULT 0;

        -- Phase 3: Daily Task Center Engine
        ALTER TABLE daily_tasks ADD COLUMN IF NOT EXISTS target_count INT NOT NULL DEFAULT 1;
        ALTER TABLE daily_tasks ADD COLUMN IF NOT EXISTS activity_type VARCHAR(50) NOT NULL DEFAULT 'SURVEY';
        ALTER TABLE daily_tasks ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
        ALTER TABLE daily_tasks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
        CREATE INDEX IF NOT EXISTS idx_daily_tasks_activity ON daily_tasks(activity_type, is_active);

        ALTER TABLE daily_task_completions ADD COLUMN IF NOT EXISTS progress INT NOT NULL DEFAULT 0;
        ALTER TABLE daily_task_completions ADD COLUMN IF NOT EXISTS is_completed BOOLEAN NOT NULL DEFAULT FALSE;
        ALTER TABLE daily_task_completions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
        ALTER TABLE daily_task_completions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

        CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_task_completions_user_task_date 
          ON daily_task_completions(user_id, daily_task_id, completion_date);

        INSERT INTO daily_tasks (task_code, name, description, target_count, reward_credits, activity_type, is_active)
        VALUES
          ('SURVEY_3', 'Survey 3 Signs', 'Contribute and upload 3 traffic sign recordings or photos', 3, 30, 'SURVEY', TRUE),
          ('REVIEW_5', 'Verify 5 Candidates', 'Participate in peer consensus by reviewing 5 sign candidates', 5, 25, 'REVIEW', TRUE),
          ('HAZARD_1', 'Report Road Hazard', 'Alert the community to a temporary roadside hazard', 1, 15, 'HAZARD', TRUE),
          ('REVALIDATE_2', 'Revalidate 2 Signs', 'Complete revalidation evidence on 2 aging signs', 2, 20, 'REVALIDATE', TRUE)
        ON CONFLICT (task_code) DO NOTHING;

        -- Phase 4: Reviewer Reliability & Governance
        ALTER TABLE "reviewer_profiles"
          ADD COLUMN IF NOT EXISTS "total_correct_votes" INT NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS "total_false_votes" INT NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS "consecutive_errors" INT NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS "is_provisional" BOOLEAN NOT NULL DEFAULT TRUE,
          ADD COLUMN IF NOT EXISTS "is_review_suspended" BOOLEAN NOT NULL DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "suspended_at" TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS "suspended_until" TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS "suspension_reason" TEXT;

        CREATE INDEX IF NOT EXISTS "idx_reviewer_reliability" 
          ON "reviewer_profiles"("reliability_score") 
          WHERE is_review_suspended = FALSE;

        ALTER TABLE "consensus_configs"
          ADD COLUMN IF NOT EXISTS "weight_correct" FLOAT NOT NULL DEFAULT 1.0,
          ADD COLUMN IF NOT EXISTS "penalty_false" FLOAT NOT NULL DEFAULT 2.0,
          ADD COLUMN IF NOT EXISTS "min_sample_baseline" INT NOT NULL DEFAULT 5,
          ADD COLUMN IF NOT EXISTS "min_reliability_threshold" FLOAT NOT NULL DEFAULT 50.0,
          ADD COLUMN IF NOT EXISTS "consecutive_error_limit" INT NOT NULL DEFAULT 3,
          ADD COLUMN IF NOT EXISTS "suspension_cooldown_days" INT NOT NULL DEFAULT 7,
          ADD COLUMN IF NOT EXISTS "provisional_vote_weight" FLOAT NOT NULL DEFAULT 0.5;

        UPDATE "consensus_configs"
        SET 
          weight_correct = 1.0,
          penalty_false = 2.0,
          min_sample_baseline = 5,
          min_reliability_threshold = 50.0,
          consecutive_error_limit = 3,
          suspension_cooldown_days = 7,
          provisional_vote_weight = 0.5
        WHERE is_active = TRUE AND weight_correct IS NULL;

        -- Phase 5: Route-Aware Freshness & PostGIS Decay
        CREATE TABLE IF NOT EXISTS "route_classifications" (
          "id" SERIAL PRIMARY KEY,
          "name" VARCHAR(64) NOT NULL UNIQUE,
          "road_type" VARCHAR(32) NOT NULL,
          "default_lifetime_days" INT NOT NULL,
          "revalidation_threshold_days" INT NOT NULL,
          "spatial_buffer_meters" INT NOT NULL DEFAULT 20,
          "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        INSERT INTO "route_classifications" ("name", "road_type", "default_lifetime_days", "revalidation_threshold_days", "spatial_buffer_meters")
        VALUES
          ('Urban Corridors / Construction', 'URBAN', 30, 7, 15),
          ('Provincial Roads & Mountain Passes', 'PROVINCIAL', 90, 21, 25),
          ('National Expressways & Highways', 'HIGHWAY', 180, 30, 30),
          ('Temporary / Seasonal Speed Alerts', 'TEMPORARY', 14, 3, 20)
        ON CONFLICT ("name") DO NOTHING;

        DO $$
        BEGIN
          BEGIN ALTER TYPE "sign_lifecycle_status" ADD VALUE IF NOT EXISTS 'REVALIDATION_REQUIRED'; EXCEPTION WHEN duplicate_object THEN NULL; END;
          BEGIN ALTER TYPE "sign_lifecycle_status" ADD VALUE IF NOT EXISTS 'INACTIVE'; EXCEPTION WHEN duplicate_object THEN NULL; END;
          BEGIN ALTER TYPE "sign_lifecycle_status" ADD VALUE IF NOT EXISTS 'DECOMMISSIONED'; EXCEPTION WHEN duplicate_object THEN NULL; END;
        END $$;

        ALTER TABLE "verified_traffic_signs"
          ADD COLUMN IF NOT EXISTS "route_classification_id" INT REFERENCES "route_classifications"("id");
        CREATE INDEX IF NOT EXISTS "idx_verified_signs_route_class"
          ON "verified_traffic_signs"("route_classification_id");

        ALTER TABLE "revalidation_tasks"
          ADD COLUMN IF NOT EXISTS "urgency" FLOAT NOT NULL DEFAULT 0.0,
          ADD COLUMN IF NOT EXISTS "route_classification_id" INT REFERENCES "route_classifications"("id");
        CREATE INDEX IF NOT EXISTS "idx_reval_tasks_urgency"
          ON "revalidation_tasks"("urgency" DESC);

        -- Phase 6: Dual-Outcome Revalidation Quests & Roadside Hazard Consensus
        DO $$
        BEGIN
          BEGIN ALTER TYPE "task_status" ADD VALUE IF NOT EXISTS 'ESCALATED_MODERATION'; EXCEPTION WHEN duplicate_object THEN NULL; END;
          BEGIN ALTER TYPE "reval_decision" ADD VALUE IF NOT EXISTS 'STILL_ACTIVE'; EXCEPTION WHEN duplicate_object THEN NULL; END;
          BEGIN ALTER TYPE "reval_decision" ADD VALUE IF NOT EXISTS 'REMOVED'; EXCEPTION WHEN duplicate_object THEN NULL; END;
        END $$;

        ALTER TABLE "freshness_rules"
          ADD COLUMN IF NOT EXISTS "max_proximity_meters" INT NOT NULL DEFAULT 50,
          ADD COLUMN IF NOT EXISTS "daily_submission_limit" INT NOT NULL DEFAULT 3;

        ALTER TABLE "revalidation_decisions"
          ADD COLUMN IF NOT EXISTS "suggested_sign_type_id" INT REFERENCES "traffic_sign_types"("id") ON DELETE SET NULL;

        CREATE INDEX IF NOT EXISTS "idx_reval_evidences_geom"
          ON "revalidation_evidences" USING GIST ("location");

        ALTER TABLE "missing_sign_type_reports"
          ADD COLUMN IF NOT EXISTS "suggested_shape" VARCHAR(30),
          ADD COLUMN IF NOT EXISTS "suggested_color_scheme" VARCHAR(30);
        ALTER TABLE "missing_sign_type_reports"
          ALTER COLUMN "proposed_name" DROP NOT NULL;

        ALTER TABLE "revalidation_evidences"
          ADD COLUMN IF NOT EXISTS "evidence_type" VARCHAR(32) NOT NULL DEFAULT 'STILL_ACTIVE';
        CREATE INDEX IF NOT EXISTS "idx_revalidation_evidences_type"
          ON "revalidation_evidences" ("evidence_type");

        CREATE TABLE IF NOT EXISTS "road_hazard_events" (
          "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          "reported_by" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
          "hazard_type" VARCHAR(64) NOT NULL,
          "description" TEXT,
          "location" GEOMETRY(Point, 4326) NOT NULL,
          "status" VARCHAR(32) NOT NULL DEFAULT 'UNCONFIRMED',
          "confirmations_count" INT NOT NULL DEFAULT 1,
          "dismissals_count" INT NOT NULL DEFAULT 0,
          "reward_paid" BOOLEAN NOT NULL DEFAULT FALSE,
          "expires_at" TIMESTAMPTZ NOT NULL,
          "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS "idx_road_hazard_events_location"
          ON "road_hazard_events" USING GIST ("location");
        CREATE INDEX IF NOT EXISTS "idx_road_hazard_events_status_expires"
          ON "road_hazard_events" ("status", "expires_at");
        CREATE INDEX IF NOT EXISTS "idx_road_hazard_events_reporter"
          ON "road_hazard_events" ("reported_by");

        CREATE TABLE IF NOT EXISTS "hazard_confirmations" (
          "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          "hazard_id" UUID NOT NULL REFERENCES "road_hazard_events"("id") ON DELETE CASCADE,
          "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
          "vote_type" VARCHAR(16) NOT NULL,
          "location" GEOMETRY(Point, 4326),
          "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT "uq_hazard_user_confirmation" UNIQUE ("hazard_id", "user_id")
        );
        CREATE INDEX IF NOT EXISTS "idx_hazard_confirmations_hazard"
          ON "hazard_confirmations" ("hazard_id");
        CREATE INDEX IF NOT EXISTS "idx_hazard_confirmations_user"
          ON "hazard_confirmations" ("user_id");

        -- Phase 7: Navigation Sink Gate & Alert Profiles
        CREATE TABLE IF NOT EXISTS "custom_alert_profiles" (
          "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
          "name" VARCHAR(64) NOT NULL,
          "description" TEXT,
          "filter_rules" JSONB NOT NULL DEFAULT '{}'::jsonb,
          "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
          "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS "idx_custom_alert_profiles_user"
          ON "custom_alert_profiles" ("user_id");

        CREATE TABLE IF NOT EXISTS "navigation_sessions" (
          "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          "driver_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
          "origin" GEOMETRY(Point, 4326) NOT NULL,
          "destination" GEOMETRY(Point, 4326) NOT NULL,
          "credits_deducted" INT NOT NULL DEFAULT 0,
          "status" VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
          "started_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "ended_at" TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS "idx_navigation_sessions_driver"
          ON "navigation_sessions" ("driver_id");
        CREATE INDEX IF NOT EXISTS "idx_navigation_sessions_status"
          ON "navigation_sessions" ("status");

        CREATE TABLE IF NOT EXISTS "saved_routes" (
          "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
          "title" VARCHAR(120) NOT NULL,
          "vehicle_mode" VARCHAR(20) NOT NULL DEFAULT 'MOTORCYCLE',
          "origin_name" VARCHAR(255) NOT NULL,
          "origin_latitude" DOUBLE PRECISION NOT NULL,
          "origin_longitude" DOUBLE PRECISION NOT NULL,
          "destination_name" VARCHAR(255) NOT NULL,
          "destination_latitude" DOUBLE PRECISION NOT NULL,
          "destination_longitude" DOUBLE PRECISION NOT NULL,
          "waypoints" JSONB NOT NULL DEFAULT '[]'::jsonb,
          "distance_meters" INT NOT NULL DEFAULT 0,
          "duration_seconds" INT NOT NULL DEFAULT 0,
          "encoded_polyline" TEXT NOT NULL DEFAULT '',
          "filter_rules" JSONB NOT NULL DEFAULT '{"onlyFixedSigns": true, "categories": ["P","W","R","I"]}'::jsonb,
          "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS "idx_saved_routes_user" ON "saved_routes" ("user_id");
        CREATE INDEX IF NOT EXISTS "idx_saved_routes_vehicle" ON "saved_routes" ("vehicle_mode");

        ALTER TABLE "sign_type_images"
          ADD COLUMN IF NOT EXISTS "role" varchar(50) DEFAULT 'MEDOID',
          ADD COLUMN IF NOT EXISTS "is_pinned" boolean DEFAULT false,
          ADD COLUMN IF NOT EXISTS "sharpness" double precision;
       `);
      this.logger.log('SignMap schema preflight verified (admin_boundaries, osm_roads, verified_traffic_signs columns, phases 1-7 gamification & governance tables).');

      if (this.backfillService) {
        this.backfillService
          .backfillMissingAddresses(200)
          .catch((err) => this.logger.warn(`Background address backfill warning: ${err?.message}`));
      }
    } catch (error: any) {
      this.logger.warn(`SignMap schema preflight check warning: ${error?.message || error}`);
    }
  }
}
