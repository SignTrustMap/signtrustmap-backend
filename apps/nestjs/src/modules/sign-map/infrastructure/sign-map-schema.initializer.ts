import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class SignMapSchemaInitializer implements OnModuleInit {
  private readonly logger = new Logger(SignMapSchemaInitializer.name);

  constructor(private readonly dataSource: DataSource) {}

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

        -- Auto backfill signs with missing addresses
        UPDATE "verified_traffic_signs" v
        SET
          commune_code = sub.commune_code,
          road_name = COALESCE(v.road_name, sub.road_name),
          display_address = CASE
            WHEN sub.road_name IS NOT NULL THEN sub.road_name || ', ' || sub.commune_name || ', ' || sub.province_name
            ELSE sub.commune_name || ', ' || sub.province_name
          END
        FROM (
          SELECT
            v2.id as sign_id,
            c.code as commune_code,
            c.name as commune_name,
            p.name as province_name,
            (
              SELECT r.name
              FROM osm_roads r
              WHERE r.name IS NOT NULL
              ORDER BY r.geometry <-> v2.location
              LIMIT 1
            ) as road_name
          FROM verified_traffic_signs v2
          JOIN admin_communes c ON ST_Intersects(c.geometry, v2.location)
          JOIN admin_provinces p ON c.province_code = p.code
        ) sub
        WHERE v.id = sub.sign_id AND v.commune_code IS NULL;
      `);
      this.logger.log('SignMap schema preflight verified (admin_boundaries, osm_roads, verified_traffic_signs columns).');
    } catch (error: any) {
      this.logger.warn(`SignMap schema preflight check warning: ${error?.message || error}`);
    }
  }
}
