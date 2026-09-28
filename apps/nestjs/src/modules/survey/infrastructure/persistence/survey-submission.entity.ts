import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import {
  CoordinateSource,
  SubmissionContractIssue,
  SubmissionType,
} from '../../domain/submission-contract';

export { CoordinateSource, SubmissionType } from '../../domain/submission-contract';

export enum SubmissionStatus {
  DRAFT = 'DRAFT',
  QUEUED = 'QUEUED',
  SYNCHRONIZING = 'SYNCHRONIZING',
  DETECTING = 'DETECTING',
  TRACKING = 'TRACKING',
  ESTIMATING = 'ESTIMATING',
  CLASSIFYING = 'CLASSIFYING',
  COMPLETED = 'COMPLETED',
  PARTIALLY_PROCESSED = 'PARTIALLY_PROCESSED',
  FAILED = 'FAILED',
  PENDING_CORRECTION = 'PENDING_CORRECTION',
  NO_SIGN_DETECTED = 'NO_SIGN_DETECTED',
  REJECTED = 'REJECTED',
}

@Entity('survey_submissions')
export class SurveySubmission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'surveyor_id', type: 'uuid' })
  surveyorId: string;

  @Column({ name: 'submission_type', type: 'enum', enum: SubmissionType })
  submissionType: SubmissionType;

  @Column({ type: 'enum', enum: SubmissionStatus, default: SubmissionStatus.DRAFT })
  status: SubmissionStatus;

  @Column({ name: 'captured_at', type: 'timestamptz' })
  capturedAt: Date;

  @Column({ name: 'coordinate_source', type: 'enum', enum: CoordinateSource })
  coordinateSource: CoordinateSource;

  @Column({ name: 'camera_profile_id', type: 'uuid', nullable: true })
  cameraProfileId?: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ name: 'validation_errors', type: 'jsonb', default: () => "'[]'::jsonb" })
  validationErrors: SubmissionContractIssue[];

  @Column({ name: 'correction_requirements', type: 'jsonb', default: () => "'[]'::jsonb" })
  correctionRequirements: SubmissionContractIssue[];

  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason: string | null;

  @Column({ name: 'total_candidates_extracted', type: 'int', default: 0 })
  totalCandidatesExtracted: number;

  @Column({ name: 'reward_status', type: 'varchar', length: 32, default: 'NONE' })
  rewardStatus: string;

  @Column({ name: 'reward_amount', type: 'int', default: 0 })
  rewardAmount: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
