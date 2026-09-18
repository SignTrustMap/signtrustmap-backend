import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VehicleType } from '../../../../common/vehicle-types';
import { VerifiedSignRepository } from '../../domain/verified-sign.repository';
import {
  CreateVerifiedSign,
  NearbySignCandidate,
  UpdateVerifiedSign,
  VerifiedSign,
} from '../../domain/verified-sign';
import { appliesToTrafficHeading } from '../../domain/traffic-direction';
import { VerifiedSignOrmEntity } from './verified-sign.orm-entity';

interface VerifiedSignRow {
  id: string;
  sign_type_id: number | string;
  longitude: number | string;
  latitude: number | string;
  traffic_direction: number | string | null;
  sign_crop_url: string;
  status: string;
  freshness_score: number | string;
  confirmation_count?: number | string | null;
  last_verified_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  category_id: number | string;
  sign_code: string;
  name_vi: string;
  name_en: string;
  description: string | null;
  labeling_guidelines: string | null;
  shape: string | null;
  color_scheme: string | null;
  is_active: boolean;
  allowed_vehicles: string[] | null;
  navigation_value: string | null;
  category_code: string;
  category_name_vi: string;
  category_name_en: string;
}

@Injectable()
export class TypeOrmVerifiedSignRepository implements VerifiedSignRepository {
  private static readonly SELECT_COLUMNS = `
         sign.id,
         sign.sign_type_id,
         ST_X(sign.location::geometry) AS longitude,
         ST_Y(sign.location::geometry) AS latitude,
         sign.traffic_direction,
         sign.sign_crop_url,
         sign.status,
         sign.freshness_score,
         COALESCE(sign.confirmation_count, 0) AS confirmation_count,
         sign.last_verified_at,
         sign.created_at,
         sign.updated_at,
         sign_type.category_id,
         sign_type.sign_code,
         sign_type.name_vi,
         sign_type.name_en,
         sign_type.description,
         sign_type.labeling_guidelines,
         sign_type.shape,
         sign_type.color_scheme,
         sign_type.is_active,
         sign_type.allowed_vehicles,
         (
           SELECT mapping.osm_value
           FROM sign_type_osm_mappings mapping
           WHERE mapping.sign_type_id = sign_type.id
             AND lower(mapping.osm_key) = 'maxspeed'
           ORDER BY mapping.id
           LIMIT 1
         ) AS navigation_value,
         category.code AS category_code,
         category.name_vi AS category_name_vi,
         category.name_en AS category_name_en`;

  private static readonly FROM_JOIN_SIGN = `
       FROM verified_traffic_signs sign
       JOIN traffic_sign_types sign_type ON sign_type.id = sign.sign_type_id
       JOIN sign_categories category ON category.id = sign_type.category_id`;

  private static readonly SELECT_SIGN = `SELECT ${TypeOrmVerifiedSignRepository.SELECT_COLUMNS} ${TypeOrmVerifiedSignRepository.FROM_JOIN_SIGN}`;

  constructor(
    @InjectRepository(VerifiedSignOrmEntity)
    private readonly repository: Repository<VerifiedSignOrmEntity>,
  ) {}

  async findById(id: string): Promise<VerifiedSign | null> {
    const rows = (await this.repository.query(
      `${TypeOrmVerifiedSignRepository.SELECT_SIGN}
       WHERE sign.id = $1`,
      [id],
    )) as VerifiedSignRow[];
    return rows[0] ? this.toDomain(rows[0]) : null;
  }

  async create(sign: CreateVerifiedSign): Promise<VerifiedSign> {
    const rows = (await this.repository.query(
      `INSERT INTO verified_traffic_signs (
         sign_type_id,
         origin_candidate_id,
         location,
         traffic_direction,
         sign_crop_url,
         status,
         freshness_score,
         last_verified_at
       ) VALUES (
         $1,
         $2,
         ST_SetSRID(ST_MakePoint($3, $4), 4326),
         $5,
         $6,
         'ACTIVE',
         1,
         $7
       )
       RETURNING id`,
      [
        sign.signTypeId,
        sign.originCandidateId,
        sign.longitude,
        sign.latitude,
        sign.trafficDirection,
        sign.signCropUrl,
        sign.lastVerifiedAt,
      ],
    )) as Array<{ id: string }>;
    const created = rows[0] && (await this.findById(String(rows[0].id)));
    if (!created) throw new Error('Created verified sign could not be loaded');
    return created;
  }

  async update(id: string, sign: UpdateVerifiedSign): Promise<VerifiedSign | null> {
    const assignments: string[] = [];
    const parameters: unknown[] = [];
    const parameter = (value: unknown): string => {
      parameters.push(value);
      return `$${parameters.length}`;
    };

    if (sign.signTypeId !== undefined) {
      assignments.push(`sign_type_id = ${parameter(sign.signTypeId)}`);
    }
    if (sign.latitude !== undefined && sign.longitude !== undefined) {
      const longitude = parameter(sign.longitude);
      const latitude = parameter(sign.latitude);
      assignments.push(`location = ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)`);
    }
    if (sign.trafficDirection !== undefined) {
      assignments.push(`traffic_direction = ${parameter(sign.trafficDirection)}`);
    }
    if (sign.signCropUrl !== undefined) {
      assignments.push(`sign_crop_url = ${parameter(sign.signCropUrl)}`);
    }
    if (sign.lastVerifiedAt !== undefined) {
      assignments.push(`last_verified_at = ${parameter(sign.lastVerifiedAt)}`);
    }
    if (sign.status !== undefined) {
      assignments.push(`status = ${parameter(sign.status)}::sign_lifecycle_status`);
    }
    if (assignments.length === 0) return this.findById(id);

    assignments.push('updated_at = NOW()');
    const idParameter = parameter(id);
    const rows = (await this.repository.query(
      `UPDATE verified_traffic_signs
       SET ${assignments.join(', ')}
       WHERE id = ${idParameter}
       RETURNING id`,
      parameters,
    )) as Array<{ id: string }>;
    if (!rows[0]) return null;
    return this.findById(String(rows[0].id));
  }

  async findActiveAlongRoute(
    routeWkt: string,
    corridorWidthMeters: number,
  ): Promise<VerifiedSign[]> {
    const rows = (await this.repository.query(
      `${TypeOrmVerifiedSignRepository.SELECT_SIGN}
       WHERE sign.status = 'ACTIVE'
         AND ST_DWithin(
           sign.location::geography,
           ST_GeomFromText($1, 4326)::geography,
           $2
         )`,
      [routeWkt, corridorWidthMeters],
    )) as VerifiedSignRow[];

    return rows.map((row) => this.toDomain(row));
  }

  async findActiveInBounds(
    minLatitude: number,
    minLongitude: number,
    maxLatitude: number,
    maxLongitude: number,
    limit: number,
  ): Promise<VerifiedSign[]> {
    const rows = (await this.repository.query(
      `${TypeOrmVerifiedSignRepository.SELECT_SIGN}
       WHERE sign.status = 'ACTIVE'
         AND sign.location && ST_MakeEnvelope($1, $2, $3, $4, 4326)
       ORDER BY sign.updated_at DESC
       LIMIT $5`,
      [minLongitude, minLatitude, maxLongitude, maxLatitude, limit],
    )) as VerifiedSignRow[];

    return rows.map((row) => this.toDomain(row));
  }

  async findNearbyCandidates(
    latitude: number,
    longitude: number,
    radiusMeters: number,
    headingDegrees?: number,
  ): Promise<NearbySignCandidate[]> {
    const rows = (await this.repository.query(
      `SELECT
         ${TypeOrmVerifiedSignRepository.SELECT_COLUMNS},
         ST_Distance(
           sign.location::geography,
           ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
         ) AS distance_meters
       ${TypeOrmVerifiedSignRepository.FROM_JOIN_SIGN}
       WHERE sign.status = 'ACTIVE'
         AND ST_DWithin(
           sign.location::geography,
           ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
           $3
         )
       ORDER BY distance_meters ASC`,
      [longitude, latitude, radiusMeters],
    )) as Array<VerifiedSignRow & { distance_meters: number | string }>;

    let candidates: NearbySignCandidate[] = rows.map((row) => ({
      sign: this.toDomain(row),
      distanceMeters: Math.round(Number(row.distance_meters) * 10) / 10,
    }));

    if (headingDegrees !== undefined && headingDegrees !== null) {
      candidates = candidates.filter((candidate) =>
        appliesToTrafficHeading(candidate.sign.trafficDirection, headingDegrees, 45),
      );
    }

    return candidates;
  }

  private toDomain(row: VerifiedSignRow): VerifiedSign {
    return {
      id: String(row.id),
      signType: {
        id: Number(row.sign_type_id),
        categoryId: Number(row.category_id),
        signCode: row.sign_code,
        nameVi: row.name_vi,
        nameEn: row.name_en,
        description: row.description,
        labelingGuidelines: row.labeling_guidelines,
        shape: row.shape,
        colorScheme: row.color_scheme,
        isActive: row.is_active,
        allowedVehicles: row.allowed_vehicles as VehicleType[] | undefined,
        value: this.numericSpeedValue(row.navigation_value),
        category: {
          id: Number(row.category_id),
          code: row.category_code,
          nameVi: row.category_name_vi,
          nameEn: row.category_name_en,
        },
      },
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      trafficDirection:
        row.traffic_direction == null ? null : Number(row.traffic_direction),
      signCropUrl: row.sign_crop_url,
      status: row.status,
      freshnessScore: Number(row.freshness_score),
      confirmationCount: Number(row.confirmation_count ?? 0),
      lastVerifiedAt: row.last_verified_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private numericSpeedValue(value: string | null): number | null {
    const match = value?.trim().match(/^(\d{1,3}(?:\.\d+)?)\s*(?:km\/?h|kph)?$/i);
    if (!match) return null;
    const speed = Number(match[1]);
    return Number.isFinite(speed) ? speed : null;
  }
}
