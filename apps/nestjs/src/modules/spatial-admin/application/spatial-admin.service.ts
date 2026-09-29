import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AdminSearchResult, ResolvedLocation } from '../domain/spatial-admin.types';
import {
  formatCanonicalRoadName,
  isCleanVietnameseRoadName,
} from '../domain/road-name-formatter';

@Injectable()
export class SpatialAdminService {
  private readonly logger = new Logger(SpatialAdminService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Resolves WGS84 GPS point into a canonical 2-tier administrative address under QĐ 19/2025/QĐ-TTg.
   * Format: <Tên đường>, <Phường/Xã>, <Tỉnh/Thành phố>.
   * Road name is null if no designated road centerline exists within spatial tolerance.
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

    const communeCode: string | null = adminUnit?.commune_code ?? null;
    const communeName: string | null = adminUnit?.commune_name ?? null;
    const communeType: string = adminUnit?.commune_type ?? 'WARD';
    let provinceCode: string | null = adminUnit?.province_code ?? null;
    let provinceName: string | null = adminUnit?.province_name ?? null;
    let provinceType: string = adminUnit?.province_type ?? 'MUNICIPALITY';
    const boundaryVersion = adminUnit?.boundary_version ?? '2025-07-01';

    // If province still not resolved, query intersecting province in admin_provinces
    if (!provinceName) {
      const prov = await this.queryProvince(longitude, latitude);
      if (prov) {
        provinceCode = prov.code;
        provinceName = prov.name;
        provinceType = prov.type;
      }
    }

    // Step 2: Query nearest genuine road line from local PostGIS osm_roads
    const roadName: string | null = await this.queryNearestRoad(longitude, latitude);

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
      source: 'INTERNAL_SPATIAL',
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

  private async queryProvince(
    longitude: number,
    latitude: number,
  ): Promise<{ code: string; name: string; type: string } | null> {
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
         WHERE ST_DWithin(c.geometry, ST_SetSRID(ST_Point($1, $2), 4326), 0.005)
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
           AND ST_DWithin(geometry, ST_SetSRID(ST_Point($1, $2), 4326), 0.0005)
         ORDER BY geometry <-> ST_SetSRID(ST_Point($1, $2), 4326)
         LIMIT 1`,
        [longitude, latitude],
      );
      if (rows.length > 0 && rows[0].name) {
        const canonical = formatCanonicalRoadName(rows[0].name);
        if (canonical && isCleanVietnameseRoadName(canonical)) {
          return canonical;
        }
      }
      return null;
    } catch (err: any) {
      this.logger.warn(`queryNearestRoad query error: ${err?.message}`);
      return null;
    }
  }
}
