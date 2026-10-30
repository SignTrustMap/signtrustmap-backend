import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('verified_sign_history')
export class VerifiedSignHistory {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Index('verified_sign_history_verified_sign_id_idx')
  @Column({ name: 'verified_sign_id', type: 'uuid' })
  verifiedSignId: string;

  @Column({ name: 'previous_sign_type_id', type: 'int', nullable: true })
  previousSignTypeId?: number | null;

  @Column({ name: 'previous_location', type: 'geometry', spatialFeatureType: 'Point', srid: 4326, nullable: true })
  previousLocation?: string | null;

  @Column({ name: 'previous_traffic_direction', type: 'float', nullable: true })
  previousTrafficDirection?: number | null;

  @Column({ name: 'previous_crop_url', type: 'varchar', length: 500, nullable: true })
  previousCropUrl?: string | null;

  @Column({ name: 'change_reason', type: 'varchar', length: 50 })
  changeReason: string;

  @CreateDateColumn({ name: 'changed_at', type: 'timestamptz' })
  changedAt: Date;
}
