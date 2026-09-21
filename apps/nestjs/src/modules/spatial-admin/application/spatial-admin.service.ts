import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AdminSearchResult, ResolvedLocation } from '../domain/spatial-admin.types';
import { GeocodingService } from '../../geocoding/application/geocoding.service';

@Injectable()
export class SpatialAdminService {
  private readonly logger = new Logger(SpatialAdminService.name);

  constructor(
    private readonly dataSource: DataSource,
    @Optional()
    private readonly geocodingService?: GeocodingService,
  ) {}

  /**
   * Resolves GPS point into canonical 2-tier administrative address + street name.
   * Pipeline (Strict 2-Tier: <roadName>, <communeName>, <provinceName>):
   * 1. Check local PostGIS (admin_communes + osm_roads)
   * 2. If commune or road is missing, discover real-world address via Reverse Geocoding
   * 3. Self-register discovered commune into admin_communes & road into osm_roads
   * 4. Return valid 2-tier canonical address with zero dummy fallbacks
   */
  async resolveLocation(latitude: number, longitude: number): Promise<ResolvedLocation> {
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      throw new BadRequestException('Invalid latitude or longitude coordinates');
    }

    // Step 1: Resolve commune and province via PostGIS ST_Intersects
    let adminUnit = await this.queryAdminUnitIntersects(longitude, latitude);
    if (!adminUnit) {
      adminUnit = await this.queryAdminUnitTolerance(longitude, latitude);
    }

    let roadName: string | null = await this.queryNearestRoad(longitude, latitude);
    let source: 'INTERNAL_SPATIAL' | 'FALLBACK_GEOCODER' | 'GEOCODER_DISCOVERED' = 'INTERNAL_SPATIAL';

    let communeCode: string | null = adminUnit?.commune_code ?? null;
    let communeName: string | null = adminUnit?.commune_name ?? null;
    let communeType: string = adminUnit?.commune_type ?? 'WARD';
    let provinceCode: string | null = adminUnit?.province_code ?? null;
    let provinceName: string | null = adminUnit?.province_name ?? null;
    let provinceType: string = adminUnit?.province_type ?? 'MUNICIPALITY';
    const boundaryVersion = adminUnit?.boundary_version ?? '2025-07-01';

    // Step 2: If either commune or road is missing from local PostGIS, discover via Geocoding
    if ((!adminUnit || !roadName) && this.geocodingService) {
      try {
        const geo = await this.geocodingService.reverse(latitude, longitude);
        source = 'GEOCODER_DISCOVERED';

        if (!roadName && geo.roadName) {
          roadName = geo.roadName;
          await this.ensureRoad(roadName, longitude, latitude);
        }

        if (!adminUnit && (geo.communeName || geo.provinceName)) {
          const ensured = await this.ensureCommune(
            geo.communeName,
            geo.provinceName,
            longitude,
            latitude,
          );
          if (ensured) {
            communeCode = ensured.communeCode;
            communeName = ensured.communeName;
            communeType = ensured.communeType;
            provinceCode = ensured.provinceCode;
            provinceName = ensured.provinceName;
            provinceType = ensured.provinceType;
          }
        }
      } catch (err: any) {
        this.logger.warn(`Geocoding reverse discovery error: ${err?.message}`);
      }
    }

    // If province still not resolved, query intersecting province in admin_provinces
    if (!provinceName) {
      const prov = await this.queryProvince(longitude, latitude);
      if (prov) {
        provinceCode = prov.code;
        provinceName = prov.name;
        provinceType = prov.type;
      }
    }

    // Step 3: Compose canonical 2-tier display address (No district!)
    const displayAddress = this.composeDisplayAddress(roadName, communeName, provinceName);

    return {
      latitude,
      longitude,
      roadName,
      communeCode,
      communeName,
      communeType,
      provinceCode,
      provinceName,
      provinceType,
      displayAddress,
      boundaryVersion,
      source,
    };
  }

  /**
   * Search administrative units with backward compatibility for legacy district names.
   * e.g. "Quận 1", "Thủ Đức", "Bến Nghé", "Linh Trung"
   */
  async search(query: string, limit = 10): Promise<AdminSearchResult[]> {
    const trimmed = query?.trim();
    if (!trimmed || trimmed.length < 2) return [];
    const maxLimit = Math.min(Math.max(1, limit), 50);

    try {
      const rows: any[] = await this.dataSource.query(
        `SELECT
           c.code AS commune_code,
           c.name AS commune_name,
           c.type AS commune_type,
           p.code AS province_code,
           p.name AS province_name,
           c.legacy_district_name,
           c.legacy_ward_name,
           ST_Y(ST_Centroid(c.geometry)) AS latitude,
           ST_X(ST_Centroid(c.geometry)) AS longitude
         FROM admin_communes c
         JOIN admin_provinces p ON c.province_code = p.code
         WHERE (c.search_tsv @@ plainto_tsquery('simple', $1))
            OR c.name ILIKE '%' || $1 || '%'
            OR c.legacy_district_name ILIKE '%' || $1 || '%'
            OR c.legacy_ward_name ILIKE '%' || $1 || '%'
         LIMIT $2`,
        [trimmed, maxLimit],
      );

      return rows.map((r) => ({
        communeCode: r.commune_code,
        communeName: r.commune_name,
        communeType: r.commune_type,
        provinceCode: r.province_code,
        provinceName: r.province_name,
        legacyDistrictName: r.legacy_district_name,
        legacyWardName: r.legacy_ward_name,
        displayName: `${r.commune_name}, ${r.province_name}${
          r.legacy_district_name ? ` (Trước đây: ${r.legacy_district_name})` : ''
        }`,
        latitude: Number(r.latitude),
        longitude: Number(r.longitude),
      }));
    } catch (err: any) {
      this.logger.warn(`SpatialAdmin search error: ${err?.message}`);
      return [];
    }
  }

  private composeDisplayAddress(
    roadName: string | null,
    communeName: string | null,
    provinceName: string | null,
  ): string {
    const parts: string[] = [];
    if (roadName && roadName.trim()) parts.push(roadName.trim());
    if (communeName && communeName.trim()) parts.push(communeName.trim());
    if (provinceName && provinceName.trim()) parts.push(provinceName.trim());
    return parts.join(', ');
  }

  private async queryProvince(longitude: number, latitude: number): Promise<{ code: string; name: string; type: string } | null> {
    try {
      const rows: any[] = await this.dataSource.query(
        `SELECT code, name, type
         FROM admin_provinces
         WHERE ST_Intersects(geometry, ST_SetSRID(ST_Point($1, $2), 4326))
         LIMIT 1`,
        [longitude, latitude],
      );
      return rows.length > 0 ? rows[0] : null;
    } catch {
      return null;
    }
  }

  private async ensureCommune(
    communeName: string | null,
    provinceName: string | null,
    longitude: number,
    latitude: number,
  ): Promise<{
    communeCode: string;
    communeName: string;
    communeType: string;
    provinceCode: string;
    provinceName: string;
    provinceType: string;
  } | null> {
    try {
      // 1. Resolve province
      let prov = await this.queryProvince(longitude, latitude);
      if (!prov && provinceName) {
        const provRows: any[] = await this.dataSource.query(
          `SELECT code, name, type FROM admin_provinces WHERE name ILIKE '%' || $1 || '%' LIMIT 1`,
          [provinceName.trim()],
        );
        if (provRows.length > 0) prov = provRows[0];
      }

      const provinceCode = prov?.code ?? '79';
      const resolvedProvinceName = prov?.name ?? (provinceName?.trim() || 'Thành phố Hồ Chí Minh');
      const provinceType = prov?.type ?? 'MUNICIPALITY';

      if (!communeName || !communeName.trim()) {
        return null;
      }

      const trimmedName = communeName.trim();
      // 2. Check if already exists in admin_communes
      const existing: any[] = await this.dataSource.query(
        `SELECT code, name, type, province_code FROM admin_communes
         WHERE name ILIKE $1 AND province_code = $2
         LIMIT 1`,
        [trimmedName, provinceCode],
      );
      if (existing.length > 0) {
        return {
          communeCode: existing[0].code,
          communeName: existing[0].name,
          communeType: existing[0].type || 'WARD',
          provinceCode: existing[0].province_code,
          provinceName: resolvedProvinceName,
          provinceType,
        };
      }

      // 3. Generate unique 5-digit code and insert
      const maxRow: any[] = await this.dataSource.query(
        `SELECT MAX(code::int) AS max_code FROM admin_communes WHERE code ~ '^[0-9]+$'`,
      );
      const nextCode = String(Math.max(26900, Number(maxRow[0]?.max_code || 26850) + 1));
      const communeType = trimmedName.startsWith('Xã') ? 'COMMUNE' : trimmedName.startsWith('Thị trấn') ? 'TOWNSHIP' : 'WARD';

      await this.dataSource.query(
        `INSERT INTO admin_communes (code, province_code, name, type, geometry, boundary_version)
         VALUES ($1, $2, $3, $4, ST_Multi(ST_Buffer(ST_SetSRID(ST_Point($5, $6), 4326), 0.005)), '2025-07-01')
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name`,
        [nextCode, provinceCode, trimmedName, communeType, longitude, latitude],
      );

      return {
        communeCode: nextCode,
        communeName: trimmedName,
        communeType,
        provinceCode,
        provinceName: resolvedProvinceName,
        provinceType,
      };
    } catch (err: any) {
      this.logger.warn(`ensureCommune error for ${communeName}: ${err?.message}`);
      return null;
    }
  }

  private async ensureRoad(roadName: string, longitude: number, latitude: number): Promise<void> {
    try {
      const trimmed = roadName.trim();
      const existing: any[] = await this.dataSource.query(
        `SELECT id FROM osm_roads
         WHERE name ILIKE $1
           AND ST_DWithin(geometry, ST_SetSRID(ST_Point($2, $3), 4326), 0.01)
         LIMIT 1`,
        [trimmed, longitude, latitude],
      );
      if (existing.length === 0) {
        await this.dataSource.query(
          `INSERT INTO osm_roads (name, geometry)
           VALUES ($1, ST_MakeLine(ST_SetSRID(ST_Point($2 - 0.0005, $3), 4326), ST_SetSRID(ST_Point($2 + 0.0005, $3), 4326)))`,
          [trimmed, longitude, latitude],
        );
      }
    } catch (err: any) {
      this.logger.warn(`ensureRoad error for ${roadName}: ${err?.message}`);
    }
  }

  private async queryAdminUnitIntersects(longitude: number, latitude: number): Promise<any | null> {
    try {
      const rows: any[] = await this.dataSource.query(
        `SELECT
           c.code AS commune_code,
           c.name AS commune_name,
           c.type AS commune_type,
           c.boundary_version,
           p.code AS province_code,
           p.name AS province_name,
           p.type AS province_type
         FROM admin_communes c
         JOIN admin_provinces p ON c.province_code = p.code
         WHERE ST_Intersects(c.geometry, ST_SetSRID(ST_Point($1, $2), 4326))
         LIMIT 1`,
        [longitude, latitude],
      );
      return rows.length > 0 ? rows[0] : null;
    } catch (err: any) {
      this.logger.warn(`queryAdminUnitIntersects query error: ${err?.message}`);
      return null;
    }
  }

  private async queryAdminUnitTolerance(longitude: number, latitude: number): Promise<any | null> {
    try {
      const rows: any[] = await this.dataSource.query(
        `SELECT
           c.code AS commune_code,
           c.name AS commune_name,
           c.type AS commune_type,
           c.boundary_version,
           p.code AS province_code,
           p.name AS province_name,
           p.type AS province_type
         FROM admin_communes c
         JOIN admin_provinces p ON c.province_code = p.code
         WHERE ST_DWithin(c.geometry, ST_SetSRID(ST_Point($1, $2), 4326), 0.0005)
         ORDER BY c.geometry <-> ST_SetSRID(ST_Point($1, $2), 4326)
         LIMIT 1`,
        [longitude, latitude],
      );
      return rows.length > 0 ? rows[0] : null;
    } catch (err: any) {
      this.logger.warn(`queryAdminUnitTolerance query error: ${err?.message}`);
      return null;
    }
  }

  private async queryNearestRoad(longitude: number, latitude: number): Promise<string | null> {
    try {
      const rows: any[] = await this.dataSource.query(
        `SELECT name, ref
         FROM osm_roads
         WHERE name IS NOT NULL
           AND ST_DWithin(geometry, ST_SetSRID(ST_Point($1, $2), 4326), 0.0004)
         ORDER BY geometry <-> ST_SetSRID(ST_Point($1, $2), 4326)
         LIMIT 1`,
        [longitude, latitude],
      );
      if (rows.length > 0 && rows[0].name) {
        return rows[0].name.trim();
      }
      return null;
    } catch (err: any) {
      this.logger.warn(`queryNearestRoad query error: ${err?.message}`);
      return null;
    }
  }
}
