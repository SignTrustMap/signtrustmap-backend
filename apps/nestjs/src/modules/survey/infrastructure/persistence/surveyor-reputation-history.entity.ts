import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('surveyor_reputation_history')
export class SurveyorReputationHistory {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'surveyor_id', type: 'uuid' })
  surveyorId: string;

  @Column({ name: 'previous_score', type: 'float' })
  previousScore: number;

  @Column({ name: 'new_score', type: 'float' })
  newScore: number;

  @Column({ type: 'float' })
  delta: number;

  @Column({ name: 'change_reason', type: 'varchar', length: 255 })
  changeReason: string;

  @Column({ name: 'reference_entity_type', type: 'varchar', length: 50, nullable: true })
  referenceEntityType?: string | null;

  @Column({ name: 'reference_entity_id', type: 'uuid', nullable: true })
  referenceEntityId?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
