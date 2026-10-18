import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { TrafficSignType } from '../../../catalog/traffic-sign-type.entity';
import { SurveySubmission } from './survey-submission.entity';

export enum CandidateStatus {
  PENDING_REVIEW = 'PENDING_REVIEW',
  IN_CONSENSUS = 'IN_CONSENSUS',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
  ESCALATED_MODERATION = 'ESCALATED_MODERATION',
  MISSING_TYPE_HOLD = 'MISSING_TYPE_HOLD',
  RECAPTURE_REQUESTED = 'RECAPTURE_REQUESTED',
}

export enum SpatialConfidenceLevel {
  HIGH = 'HIGH',
  LOW = 'LOW',
}

@Entity('unverified_sign_candidates')
export class UnverifiedSignCandidate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'submission_id', type: 'uuid' })
  submissionId: string;

  @Column({ name: 'predicted_sign_type_id', type: 'int' })
  predictedSignTypeId: number;

  @Column({ name: 'confidence_score', type: 'float' })
  confidenceScore: number;

  @Column({ name: 'best_frame_url', type: 'varchar', length: 500 })
  bestFrameUrl: string;

  @Column({ name: 'sign_crop_url', type: 'varchar', length: 500 })
  signCropUrl: string;

  @Column({
    name: 'spatial_confidence',
    type: 'enum',
    enum: SpatialConfidenceLevel,
    default: SpatialConfidenceLevel.HIGH,
  })
  spatialConfidence: SpatialConfidenceLevel;

  @Column({ name: 'active_learning_priority', type: 'float', default: 0 })
  activeLearningPriority: number;

  @Column({ type: 'enum', enum: CandidateStatus, default: CandidateStatus.PENDING_REVIEW })
  status: CandidateStatus;

  @Column({ name: 'possible_signs', type: 'jsonb', nullable: true })
  possibleSigns?: any;

  top5?: any;
  remedySigns?: any;
  predictedSignTypes?: any;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => TrafficSignType, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'predicted_sign_type_id' })
  predictedSignType: TrafficSignType;

  @ManyToOne(() => SurveySubmission, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'submission_id' })
  submission: SurveySubmission;
}
