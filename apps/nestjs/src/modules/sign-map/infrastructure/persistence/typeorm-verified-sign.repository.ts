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
  best_frame_url?: string | null;
  status: string;
  freshness_score: number | string;
  confirmation_count?: number | string | null;
  last_verified_at: Date | string | null;
  commune_code?: string | null;
  road_name?: string | null;
  display_address?: string | null;
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
         candidate.best_frame_url AS best_frame_url,
         sign.status,
         sign.freshness_score,
         COALESCE(sign.confirmation_count, 0) AS confirmation_count,
         sign.last_verified_at,
         sign.commune_code,
         sign.road_name,
         sign.display_address,
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
       JOIN sign_categories category ON category.id = sign_type.category_id
       LEFT JOIN unverified_sign_candidates candidate ON candidate.id = sign.origin_candidate_id`;

  private static readonly SELECT_SIGN = `SELECT ${TypeOrmVerifiedSignRepository.SELECT_COLUMNS} ${TypeOrmVerifiedSignRepository.FROM_JOIN_SIGN}`;

  constructor(
    @InjectRepository(VerifiedSignOrmEntity)
    private readonly repository: Repository<VerifiedSignOrmEntity>,
  ) {}

  private async queryWithHealing<T>(sql: string, parameters?: unknown[]): Promise<T> {
    try {
      return (await this.repository.query(sql, parameters)) as T;
    } catch (error: any) {
      if (
        error?.code === '42703' &&
        (String(error?.message).includes('allowed_vehicles') ||
          String(error?.message).includes('column sign_type.allowed_vehicles does not exist'))
      ) {
        try {
          await this.repository.query(`
            ALTER TABLE "traffic_sign_types"
              ADD COLUMN IF NOT EXISTS "allowed_vehicles" text[]
                NOT NULL DEFAULT ARRAY['CAR','MOTORCYCLE','TRUCK','BUS','BICYCLE','PEDESTRIAN']::text[];
          `);
          return (await this.repository.query(sql, parameters)) as T;
        } catch {
          throw error;
        }
      }
      if (
        error?.code === '42703' &&
        (String(error?.message).includes('commune_code') ||
          String(error?.message).includes('road_name') ||
          String(error?.message).includes('display_address'))
      ) {
        try {
          await this.repository.query(`
            ALTER TABLE "verified_traffic_signs"
              ADD COLUMN IF NOT EXISTS "commune_code" VARCHAR(5),
              ADD COLUMN IF NOT EXISTS "road_name" VARCHAR(255),
              ADD COLUMN IF NOT EXISTS "display_address" TEXT;
          `);
          return (await this.repository.query(sql, parameters)) as T;
        } catch {
          throw error;
        }
      }
      throw error;
    }
  }

  async findById(id: string): Promise<VerifiedSign | null> {
    const rows = (await this.queryWithHealing(
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
         last_verified_at,
         commune_code,
         road_name,
         display_address
       ) VALUES (
         $1,
         $2,
         ST_SetSRID(ST_MakePoint($3, $4), 4326),
         $5,
         $6,
         'ACTIVE',
         1,
         $7,
         $8,
         $9,
         $10
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
        sign.communeCode ?? null,
        sign.roadName ?? null,
        sign.displayAddress ?? null,
      ],
    )) as Array<{ id: string }>;
    const createdRow = Array.isArray(rows[0]) ? rows[0][0] : rows[0];
    const created = createdRow?.id && (await this.findById(String(createdRow.id)));
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
    if (sign.communeCode !== undefined) {
      assignments.push(`commune_code = ${parameter(sign.communeCode)}`);
    }
    if (sign.roadName !== undefined) {
      assignments.push(`road_name = ${parameter(sign.roadName)}`);
    }
    if (sign.displayAddress !== undefined) {
      assignments.push(`display_address = ${parameter(sign.displayAddress)}`);
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
    const updatedRow = Array.isArray(rows[0]) ? rows[0][0] : rows[0];
    if (!updatedRow?.id) return null;
    return this.findById(String(updatedRow.id));
  }

  async findActiveAlongRoute(
    routeWkt: string,
    corridorWidthMeters: number,
  ): Promise<VerifiedSign[]> {
    const rows = (await this.queryWithHealing(
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
    const rows = (await this.queryWithHealing(
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
    const rows = (await this.queryWithHealing(
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
      frameUrl: row.best_frame_url ?? null,
      bestFrameUrl: row.best_frame_url ?? null,
      status: row.status,
      freshnessScore: Number(row.freshness_score),
      confirmationCount: Number(row.confirmation_count ?? 0),
      lastVerifiedAt: row.last_verified_at,
      communeCode: row.commune_code ?? null,
      roadName: row.road_name ?? null,
      displayAddress: row.display_address ?? null,
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
