import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

/**
 * Note: The `location` column in the DB is geometry(Point,4326).
 * TypeORM's PostGIS support is not added to avoid extra dependencies;
 * raw SQL with ST_SetSRID(ST_MakePoint(lon, lat), 4326) is used for inserts.
 * The column is therefore omitted from the entity mapping and accessed via
 * dataSource.query() helpers in the RevalidationService.
 */
@Entity('revalidation_evidences')
export class RevalidationEvidence {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'task_id', type: 'uuid' })
  taskId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'media_url', type: 'varchar', length: 500 })
  mediaUrl: string;

  @Column({ name: 'evidence_type', type: 'varchar', length: 32, default: 'STILL_ACTIVE' })
  evidenceType: string;

  @Column({ name: 'is_live_capture', type: 'boolean', default: false })
  isLiveCapture: boolean;

  @Column({ name: 'accuracy_meters', type: 'float', nullable: true })
  accuracyMeters?: number | null;

  @Column({ name: 'heading_degrees', type: 'float', nullable: true })
  headingDegrees?: number | null;

  @CreateDateColumn({ name: 'submitted_at', type: 'timestamptz' })
  submittedAt: Date;
}

