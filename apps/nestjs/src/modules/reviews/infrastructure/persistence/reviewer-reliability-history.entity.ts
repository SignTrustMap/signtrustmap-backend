import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('reviewer_reliability_history')
export class ReviewerReliabilityHistory {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Index('reviewer_reliability_history_reviewer_id_idx')
  @Column({ name: 'reviewer_id', type: 'uuid' })
  reviewerId: string;

  @Column({ name: 'consensus_log_id', type: 'uuid', nullable: true })
  consensusLogId?: string | null;

  @Column({ name: 'old_score', type: 'float' })
  oldScore: number;

  @Column({ name: 'new_score', type: 'float' })
  newScore: number;

  @Column({ name: 'alignment_value', type: 'smallint' })
  alignmentValue: number;

  @CreateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
