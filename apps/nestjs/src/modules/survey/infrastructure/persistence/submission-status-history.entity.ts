import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('submission_status_history')
export class SubmissionStatusHistory {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Index('submission_status_history_submission_id_idx')
  @Column({ name: 'submission_id', type: 'uuid' })
  submissionId: string;

  @Column({ name: 'old_status', type: 'varchar', length: 50, nullable: true })
  oldStatus?: string | null;

  @Column({ name: 'new_status', type: 'varchar', length: 50 })
  newStatus: string;

  @Column({ type: 'text', nullable: true })
  note?: string | null;

  @CreateDateColumn({ name: 'changed_at', type: 'timestamptz' })
  changedAt: Date;
}
