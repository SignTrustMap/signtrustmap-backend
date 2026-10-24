import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { UnverifiedSignCandidate } from '../../../survey/infrastructure/persistence/unverified-sign-candidate.entity';

@Entity('candidate_recapture_requests')
export class CandidateRecaptureRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'candidate_id', type: 'uuid' })
  candidateId: string;

  @Column({ name: 'reviewer_id', type: 'uuid' })
  reviewerId: string;

  @Column({ name: 'surveyor_id', type: 'uuid', nullable: true })
  surveyorId: string | null;

  @Column({ name: 'missing_type_report_id', type: 'uuid', nullable: true })
  missingTypeReportId: string | null;

  @Column({ type: 'varchar', length: 100 })
  reason: string;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128, nullable: true })
  idempotencyKey?: string | null;

  @Column({ name: 'submission_idempotency_key', type: 'varchar', length: 128, nullable: true })
  submissionIdempotencyKey?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @ManyToOne(() => UnverifiedSignCandidate, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'candidate_id' })
  candidate?: UnverifiedSignCandidate;
}
