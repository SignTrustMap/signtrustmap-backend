import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

interface PointGeometry {
  type: 'Point';
  coordinates: [number, number];
}

@Entity('verified_traffic_signs')
export class VerifiedSignOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'sign_type_id', type: 'int' })
  signTypeId: number;

  @Column({ name: 'origin_candidate_id', type: 'uuid', unique: true })
  originCandidateId: string;

  @Column({ type: 'geometry', spatialFeatureType: 'Point', srid: 4326 })
  location: PointGeometry;

  @Column({ name: 'traffic_direction', type: 'double precision', nullable: true })
  trafficDirection: number | null;

  @Column({ name: 'sign_crop_url', type: 'varchar', length: 500 })
  signCropUrl: string;

  @Column({ type: 'varchar', length: 30, default: 'ACTIVE' })
  status: string;

  @Column({ name: 'freshness_score', type: 'double precision', default: 1 })
  freshnessScore: number;

  @Column({ name: 'confirmation_count', type: 'int', default: 0 })
  confirmationCount: number;

  @Column({ name: 'last_verified_at', type: 'timestamptz' })
  lastVerifiedAt: Date;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
