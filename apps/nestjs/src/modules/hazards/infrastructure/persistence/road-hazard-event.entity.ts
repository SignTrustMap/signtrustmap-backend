import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum HazardStatus {
  UNCONFIRMED = 'UNCONFIRMED',
  CONFIRMED = 'CONFIRMED',
  DISMISSED = 'DISMISSED',
}

@Entity('road_hazard_events')
export class RoadHazardEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'reported_by', type: 'uuid' })
  reportedBy: string;

  @Column({ name: 'hazard_type', type: 'varchar', length: 64 })
  hazardType: string;

  @Column({ type: 'varchar', length: 160, nullable: true })
  title: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  severity: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({
    type: 'varchar',
    length: 32,
    default: HazardStatus.UNCONFIRMED,
  })
  status: HazardStatus;

  @Column({ name: 'confirmations_count', type: 'int', default: 1 })
  confirmationsCount: number;

  @Column({ name: 'dismissals_count', type: 'int', default: 0 })
  dismissalsCount: number;

  @Column({ name: 'reward_paid', type: 'boolean', default: false })
  rewardPaid: boolean;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
