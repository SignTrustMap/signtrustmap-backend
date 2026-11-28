import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { TrafficSignType } from '../../../catalog/traffic-sign-type.entity';
import { SurveySubmission } from './survey-submission.entity';

export enum CandidateStatus {
  PENDING_REVIEW = 'PENDING_REVIEW',
  IN_CONSENSUS = 'IN_CONSENSUS',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
  ESCALATED_MODERATION = 'ESCALATED_MODERATION',
  NEW_TYPE_HOLD = 'NEW_TYPE_HOLD',
  // eslint-disable-next-line @typescript-eslint/no-duplicate-enum-values
  MISSING_TYPE_HOLD = 'NEW_TYPE_HOLD',
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

  @Column({ name: 'selected_sign_type_id', type: 'int', nullable: true })
  selectedSignTypeId?: number | null;

  @Column({ name: 'selected_by', type: 'uuid', nullable: true })
  selectedBy?: string | null;

  @Column({ name: 'selected_at', type: 'timestamptz', nullable: true })
  selectedAt?: Date | null;

  @Column({ name: 'selection_reason', type: 'varchar', length: 500, nullable: true })
  selectionReason?: string | null;

  @Column({ name: 'bounty_credits', type: 'int', default: 10 })
  bountyCredits: number;

  @Column({ name: 'is_promoted', type: 'boolean', default: false })
  isPromoted: boolean;

  @Column({ name: 'promoted_at', type: 'timestamptz', nullable: true })
  promotedAt?: Date | null;

  @Column({ name: 'votes_count', type: 'int', default: 0 })
  votesCount: number;

  @Column({ name: 'first_voted_at', type: 'timestamptz', nullable: true })
  firstVotedAt?: Date | null;

  @Column({ name: 'review_round', type: 'int', default: 1 })
  reviewRound: number;

  @Column({ name: 'is_manual_annotation', type: 'boolean', default: false })
  isManualAnnotation: boolean;

  @Column({ name: 'manual_annotation_by', type: 'uuid', nullable: true })
  manualAnnotationBy?: string | null;

  @Column({ name: 'manual_bounding_box', type: 'jsonb', nullable: true })
  manualBoundingBox?: { xmin: number; ymin: number; xmax: number; ymax: number; imgWidth?: number; imgHeight?: number } | null;

  @Column({ name: 'manual_annotation_notes', type: 'text', nullable: true })
  manualAnnotationNotes?: string | null;

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
