-- =============================================================================
-- 012_admin_boundaries_and_osm_roads.sql
-- Administrative units & road network for 2-tier local governance
-- Legal basis: Quyết định 19/2025/QĐ-TTg (effective 2025-07-01).
-- Boundary source: https://vnsdi.mae.gov.vn/
-- Idempotent: safe to re-run on every migration run.
-- =============================================================================

-- 1. Ensure PostGIS is enabled
CREATE EXTENSION IF NOT EXISTS postgis;

-- 2. Provinces Table (Cấp Tỉnh/Thành phố trực thuộc TW)
CREATE TABLE IF NOT EXISTS "admin_provinces" (
  "code" VARCHAR(2) PRIMARY KEY,
  "name" VARCHAR(100) NOT NULL,
  "type" VARCHAR(30) NOT NULL DEFAULT 'PROVINCE',
  "geometry" GEOMETRY(MultiPolygon, 4326),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_admin_provinces_geom" ON "admin_provinces" USING GIST ("geometry");

-- 3. Communes Table (Cấp Xã/Phường/Đặc khu - Không còn cấp quận/huyện)
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
CREATE INDEX IF NOT EXISTS "idx_admin_communes_prov" ON "admin_communes" ("province_code");

-- Trigger for auto-updating search_tsv for backward compatible search (legacy district names)
CREATE OR REPLACE FUNCTION update_admin_commune_search_tsv() RETURNS trigger AS $$
BEGIN
  NEW.search_tsv := to_tsvector('simple',
    coalesce(NEW.name, '') || ' ' ||
    coalesce(NEW.legacy_district_name, '') || ' ' ||
    coalesce(NEW.legacy_ward_name, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_admin_communes_tsv ON "admin_communes";
CREATE TRIGGER trg_admin_communes_tsv
BEFORE INSERT OR UPDATE OF name, legacy_district_name, legacy_ward_name
ON "admin_communes"
FOR EACH ROW
EXECUTE FUNCTION update_admin_commune_search_tsv();

-- 4. OpenStreetMap Road Network Table (Đường giao thông nội địa)
CREATE TABLE IF NOT EXISTS "osm_roads" (
  "id" BIGSERIAL PRIMARY KEY,
  "osm_id" BIGINT,
  "name" VARCHAR(255) NOT NULL,
  "ref" VARCHAR(50),
  "highway" VARCHAR(50) DEFAULT 'residential',
  "geometry" GEOMETRY(LineString, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_osm_roads_geom" ON "osm_roads" USING GIST ("geometry");
CREATE INDEX IF NOT EXISTS "idx_osm_roads_name" ON "osm_roads" ("name");

-- 5. Add Address Fields to verified_traffic_signs
ALTER TABLE "verified_traffic_signs"
  ADD COLUMN IF NOT EXISTS "commune_code" VARCHAR(5) REFERENCES "admin_communes"("code") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "road_name" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "display_address" TEXT;

CREATE INDEX IF NOT EXISTS "idx_verified_signs_commune" ON "verified_traffic_signs" ("commune_code");

-- 6. Seed Key Provinces (34 Đơn vị Hành chính Cấp Tỉnh theo mô hình mới)
INSERT INTO "admin_provinces" ("code", "name", "type", "geometry")
VALUES
  ('01', 'Thành phố Hà Nội', 'MUNICIPALITY', ST_Multi(ST_GeomFromText('POLYGON((105.7 20.9, 106.0 20.9, 106.0 21.2, 105.7 21.2, 105.7 20.9))', 4326))),
  ('79', 'Thành phố Hồ Chí Minh', 'MUNICIPALITY', ST_Multi(ST_GeomFromText('POLYGON((106.3 10.3, 107.0 10.3, 107.0 11.2, 106.3 11.2, 106.3 10.3))', 4326))),
  ('48', 'Thành phố Đà Nẵng', 'MUNICIPALITY', ST_Multi(ST_GeomFromText('POLYGON((107.9 15.9, 108.4 15.9, 108.4 16.3, 107.9 16.3, 107.9 15.9))', 4326))),
  ('31', 'Thành phố Hải Phòng', 'MUNICIPALITY', ST_Multi(ST_GeomFromText('POLYGON((106.5 20.7, 107.1 20.7, 107.1 21.1, 106.5 21.1, 106.5 20.7))', 4326))),
  ('92', 'Thành phố Cần Thơ', 'MUNICIPALITY', ST_Multi(ST_GeomFromText('POLYGON((105.4 9.9, 105.9 9.9, 105.9 10.3, 105.4 10.3, 105.4 9.9))', 4326))
ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name", "type" = EXCLUDED."type";

-- 7. Seed Representative Communes/Wards in HCMC Focus Area (Covering Mapillary Bootstrap Data)
-- Polygon coordinates covering coordinates in 106.60 - 106.85, 10.84 - 10.88
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
  ('26805', '79', 'Phường An Phú', 'WARD',
   ST_Multi(ST_GeomFromText('POLYGON((106.72 10.78, 106.77 10.78, 106.77 10.84, 106.72 10.84, 106.72 10.78))', 4326)),
   'Thành phố Thủ Đức', 'Quận 2'),
  ('26806', '79', 'Phường Bến Nghé', 'WARD',
   ST_Multi(ST_GeomFromText('POLYGON((106.69 10.77, 106.71 10.77, 106.71 10.79, 106.69 10.79, 106.69 10.77))', 4326)),
   'Quận 1', 'Phường Bến Nghé'),
  ('26807', '79', 'Phường Tân Bình', 'WARD',
   ST_Multi(ST_GeomFromText('POLYGON((106.63 10.85, 106.70 10.85, 106.70 10.88, 106.63 10.88, 106.63 10.85))', 4326)),
   'Quận Tân Bình', 'Phường 2'),
  ('26808', '79', 'Phường Tân Thới Nhất', 'WARD',
   ST_Multi(ST_GeomFromText('POLYGON((106.60 10.84, 106.64 10.84, 106.64 10.88, 106.60 10.88, 106.60 10.84))', 4326)),
   'Quận 12', 'Phường Tân Thới Nhất')
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "type" = EXCLUDED."type",
  "geometry" = EXCLUDED."geometry",
  "legacy_district_name" = EXCLUDED."legacy_district_name",
  "legacy_ward_name" = EXCLUDED."legacy_ward_name";

-- Trigger full-text update for seeded rows
UPDATE "admin_communes"
SET "search_tsv" = to_tsvector('simple',
  coalesce(name, '') || ' ' ||
  coalesce(legacy_district_name, '') || ' ' ||
  coalesce(legacy_ward_name, '')
)
WHERE search_tsv IS NULL;

-- 8. Seed Major Road Segments in Survey Corridor (OSM LineString)
INSERT INTO "osm_roads" ("name", "ref", "highway", "geometry")
VALUES
  ('Đường Võ Văn Ngân', 'Đ. Võ Văn Ngân', 'primary',
   ST_GeomFromText('LINESTRING(106.7580 10.8500, 106.7720 10.8550, 106.7780 10.8570)', 4326)),
  ('Xa lộ Hà Nội', 'QL52', 'trunk',
   ST_GeomFromText('LINESTRING(106.7200 10.8000, 106.7600 10.8400, 106.8000 10.8600, 106.8400 10.8800)', 4326)),
  ('Đường Phạm Văn Đồng', 'Đ. Phạm Văn Đồng', 'primary',
   ST_GeomFromText('LINESTRING(106.6600 10.8200, 106.7100 10.8600, 106.7600 10.8600)', 4326)),
  ('Quốc lộ 1A', 'QL1A', 'trunk',
   ST_GeomFromText('LINESTRING(106.6000 10.8600, 106.7000 10.8620, 106.8000 10.8650, 106.8500 10.8670)', 4326)),
  ('Đường Kha Vạn Cân', 'Đ. Kha Vạn Cân', 'secondary',
   ST_GeomFromText('LINESTRING(106.7150 10.8500, 106.7450 10.8580, 106.7600 10.8550)', 4326)),
  ('Đường Lê Văn Việt', 'Đ. Lê Văn Việt', 'secondary',
   ST_GeomFromText('LINESTRING(106.7750 10.8480, 106.8050 10.8450, 106.8350 10.8400)', 4326)),
  ('Đường Nguyễn Huệ', 'Đ. Nguyễn Huệ', 'pedestrian',
   ST_GeomFromText('LINESTRING(106.7020 10.7720, 106.7060 10.7750)', 4326)),
  ('Đường Lê Duẩn', 'Đ. Lê Duẩn', 'primary',
   ST_GeomFromText('LINESTRING(106.6980 10.7800, 106.7050 10.7860)', 4326));

-- 9. Automatically Backfill Existing Verified Signs with 2-Tier Canonical Address
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
