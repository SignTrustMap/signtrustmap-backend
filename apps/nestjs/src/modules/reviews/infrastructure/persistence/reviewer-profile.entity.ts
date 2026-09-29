import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('reviewer_profiles')
export class ReviewerProfile {
  @PrimaryColumn({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({
    name: 'reliability_score',
    type: 'numeric',
    precision: 5,
    scale: 2,
    default: 100.0,
    transformer: {
      to: (value: number) => value,
      from: (value: string | number) => Number(value),
    },
  })
  reliabilityScore: number;

  @Column({ name: 'total_correct_votes', type: 'int', default: 0 })
  totalCorrectVotes: number;

  @Column({ name: 'total_false_votes', type: 'int', default: 0 })
  totalFalseVotes: number;

  @Column({ name: 'consecutive_errors', type: 'int', default: 0 })
  consecutiveErrors: number;

  @Column({ name: 'is_provisional', type: 'boolean', default: true })
  isProvisional: boolean;

  @Column({ name: 'is_review_suspended', type: 'boolean', default: false })
  isReviewSuspended: boolean;

  @Column({ name: 'suspended_at', type: 'timestamptz', nullable: true })
  suspendedAt: Date | null;

  @Column({ name: 'suspended_until', type: 'timestamptz', nullable: true })
  suspendedUntil: Date | null;

  @Column({ name: 'suspension_reason', type: 'text', nullable: true })
  suspensionReason: string | null;

  // Legacy columns retained for backwards compatibility
  @Column({ name: 'total_reviews', type: 'int', default: 0 })
  totalReviews: number;

  @Column({ name: 'correct_reviews', type: 'int', default: 0 })
  correctReviews: number;

  @Column({ name: 'accuracy_rate', type: 'float', default: 0 })
  accuracyRate: number;

  @Column({ name: 'current_streak', type: 'int', default: 0 })
  currentStreak: number;

  @Column({ name: 'last_reviewed_at', type: 'timestamptz', nullable: true })
  lastReviewedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
