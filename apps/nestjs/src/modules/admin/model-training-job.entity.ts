import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('model_training_jobs')
export class ModelTrainingJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'model_type', type: 'varchar', length: 50 })
  modelType: string;

  @Column({ name: 'triggered_by', type: 'uuid', nullable: true })
  triggeredBy?: string | null;

  @Column({ type: 'varchar', length: 50, default: 'QUEUED' })
  status: string;

  @Column({ name: 'result_model_version_id', type: 'int', nullable: true })
  resultModelVersionId?: number | null;

  @Column({ name: 'evaluation_summary', type: 'text', nullable: true })
  evaluationSummary?: string | null;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt?: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt?: Date | null;
}
