import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('ai_model_versions')
@Index('ai_model_versions_model_type_version_tag_idx', ['modelType', 'versionTag'], { unique: true })
export class AiModelVersion {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'model_type', type: 'varchar', length: 50 })
  modelType: string;

  @Column({ name: 'version_tag', type: 'varchar', length: 50 })
  versionTag: string;

  @Column({ name: 'artifact_url', type: 'varchar', length: 500, nullable: true })
  artifactUrl?: string | null;

  @Column({ name: 'trained_at', type: 'timestamptz', nullable: true })
  trainedAt?: Date | null;

  @Column({ name: 'is_active', type: 'boolean', default: false })
  isActive: boolean;

  @Column({ name: 'evaluation_metrics', type: 'jsonb', nullable: true })
  evaluationMetrics?: Record<string, any> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
