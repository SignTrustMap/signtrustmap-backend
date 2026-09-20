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
   * Pipeline:
   * 1. Point in Polygon on admin_communes & admin_provinces (with boundary tolerance fallback)
   * 2. Spatial KNN on osm_roads (with Nominatim reverse geocoding fallback)
   * 3. Canonical address composition: <roadName>, <communeName>, <provinceName>
   */
  async resolveLocation(latitude: number, longitude: number): Promise<ResolvedLocation> {
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      throw new BadRequestException('Invalid latitude or longitude coordinates');
    }

    // Step 1: Resolve commune and province via PostGIS ST_Intersects
    let adminUnit = await this.queryAdminUnitIntersects(longitude, latitude);

    // Boundary tolerance fallback: if on edge/river/drift within 50m (~0.0005 deg)
    if (!adminUnit) {
      adminUnit = await this.queryAdminUnitTolerance(longitude, latitude);
    }

    const communeCode = adminUnit?.commune_code ?? '00000';
    const communeName = adminUnit?.commune_name ?? 'Không xác định';
    const communeType = adminUnit?.commune_type ?? 'COMMUNE';
    const provinceCode = adminUnit?.province_code ?? '00';
    const provinceName = adminUnit?.province_name ?? 'Việt Nam';
    const provinceType = adminUnit?.province_type ?? 'PROVINCE';
    const boundaryVersion = adminUnit?.boundary_version ?? '2025-07-01';

    // Step 2: Resolve road name via local osm_roads KNN
    let roadName: string | null = await this.queryNearestRoad(longitude, latitude);
    let source: 'INTERNAL_SPATIAL' | 'FALLBACK_GEOCODER' = 'INTERNAL_SPATIAL';

    // Step 2b: Fallback to Geocoding reverse if no road line within 40m
    if (!roadName && this.geocodingService) {
      try {
        const reverseResult = await this.geocodingService.reverse(latitude, longitude);
        if (reverseResult.roadName) {
          roadName = reverseResult.roadName;
          source = 'FALLBACK_GEOCODER';
        }
      } catch (err: any) {
        this.logger.warn(`Geocoding reverse fallback error: ${err?.message}`);
      }
    }

    // Step 3: Compose canonical 2-tier display address
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
    communeName: string,
    provinceName: string,
  ): string {
    if (roadName && roadName.trim()) {
      return `${roadName.trim()}, ${communeName}, ${provinceName}`;
    }
    return `${communeName}, ${provinceName}`;
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
