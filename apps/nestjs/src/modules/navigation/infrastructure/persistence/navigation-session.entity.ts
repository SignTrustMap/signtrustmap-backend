import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

export enum NavSessionStatus {
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

@Entity('navigation_sessions')
export class NavigationSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'driver_id', type: 'uuid' })
  driverId: string;

  @Column({ type: 'geometry', spatialFeatureType: 'Point', srid: 4326, nullable: true })
  origin?: any;

  @Column({ type: 'geometry', spatialFeatureType: 'Point', srid: 4326, nullable: true })
  destination?: any;

  @Column({ name: 'credits_deducted', type: 'int', default: 0 })
  creditsDeducted: number;

  @Column({ name: 'is_reviewer_free_route', type: 'boolean', default: false })
  isReviewerFreeRoute: boolean;

  @Column({ name: 'target_sign_id', type: 'uuid', nullable: true })
  targetSignId: string | null;

  @Column({ name: 'waiver_reason', type: 'varchar', length: 64, nullable: true })
  waiverReason: string | null;

  @Column({
    type: 'varchar',
    length: 32,
    default: NavSessionStatus.ACTIVE,
  })
  status: NavSessionStatus;

  @CreateDateColumn({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;

  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt: Date | null;
}
