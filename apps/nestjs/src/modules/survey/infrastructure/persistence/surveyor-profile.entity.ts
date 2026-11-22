import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('surveyor_profiles')
export class SurveyorProfile {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'total_submissions', type: 'int', default: 0 })
  totalSubmissions: number;

  @Column({ name: 'total_verified_signs', type: 'int', default: 0 })
  totalVerifiedSigns: number;

  @Column({ name: 'total_credits_earned', type: 'bigint', default: 0 })
  totalCreditsEarned: number;

  @Column({ name: 'reliability_score', type: 'float', default: 1.0 })
  reliabilityScore: number;

  @Column({ name: 'total_manual_annotations', type: 'int', default: 0 })
  totalManualAnnotations: number;

  @Column({ name: 'approved_manual_annotations', type: 'int', default: 0 })
  approvedManualAnnotations: number;

  @Column({ name: 'rejected_manual_annotations', type: 'int', default: 0 })
  rejectedManualAnnotations: number;

  @Column({ name: 'consecutive_annotation_errors', type: 'int', default: 0 })
  consecutiveAnnotationErrors: number;

  @Column({ name: 'is_annotation_suspended', type: 'boolean', default: false })
  isAnnotationSuspended: boolean;

  @Column({ name: 'suspended_until', type: 'timestamptz', nullable: true })
  suspendedUntil?: Date | null;

  @Column({ name: 'suspension_reason', type: 'text', nullable: true })
  suspensionReason?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
