import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum SubmissionType {
  VIDEO_GPX = 'VIDEO_GPX',
  SINGLE_IMAGE = 'SINGLE_IMAGE',
  LIVE_TRIP = 'LIVE_TRIP',
}

export enum SubmissionStatus {
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
}

@Entity('survey_submissions')
export class SurveySubmission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'surveyor_id', type: 'uuid' })
  surveyorId: string;

  @Column({ name: 'submission_type', type: 'enum', enum: SubmissionType })
  submissionType: SubmissionType;

  @Column({ type: 'enum', enum: SubmissionStatus, default: SubmissionStatus.QUEUED })
  status: SubmissionStatus;

  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason: string | null;

  @Column({ name: 'total_candidates_extracted', type: 'int', default: 0 })
  totalCandidatesExtracted: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
