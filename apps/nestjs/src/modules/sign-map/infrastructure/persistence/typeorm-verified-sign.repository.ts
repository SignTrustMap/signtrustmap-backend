import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VerifiedSignRepository } from '../../domain/verified-sign.repository';
import { VerifiedSign } from '../../domain/verified-sign';
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
  category_code: string;
  category_name_vi: string;
  category_name_en: string;
}

@Injectable()
export class TypeOrmVerifiedSignRepository implements VerifiedSignRepository {
  constructor(
    @InjectRepository(VerifiedSignOrmEntity)
    private readonly repository: Repository<VerifiedSignOrmEntity>,
  ) {}

  async findActiveAlongRoute(
    routeWkt: string,
    corridorWidthMeters: number,
  ): Promise<VerifiedSign[]> {
    const rows = (await this.repository.query(
      `SELECT
         sign.id,
         sign.sign_type_id,
         ST_X(sign.location::geometry) AS longitude,
         ST_Y(sign.location::geometry) AS latitude,
         sign.traffic_direction,
         sign.sign_crop_url,
         sign.status,
         sign.freshness_score,
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
         category.code AS category_code,
         category.name_vi AS category_name_vi,
         category.name_en AS category_name_en
       FROM verified_traffic_signs sign
       JOIN traffic_sign_types sign_type ON sign_type.id = sign.sign_type_id
       JOIN sign_categories category ON category.id = sign_type.category_id
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
      lastVerifiedAt: row.last_verified_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
