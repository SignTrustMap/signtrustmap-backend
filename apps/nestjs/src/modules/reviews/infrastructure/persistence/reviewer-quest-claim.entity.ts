import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../../auth/infrastructure/persistence/user.entity';

export enum QuestTargetType {
  CANDIDATE_VALIDATION = 'CANDIDATE_VALIDATION',
  REVALIDATION_TASK = 'REVALIDATION_TASK',
}

export enum QuestClaimStatus {
  CLAIMED = 'CLAIMED',
  COMPLETED = 'COMPLETED',
  EXPIRED = 'EXPIRED',
  ABANDONED = 'ABANDONED',
}

@Entity('reviewer_quest_claims')
@Index(['reviewerId', 'status'])
@Index(['targetId', 'targetType'])
export class ReviewerQuestClaim {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'reviewer_id', type: 'uuid' })
  reviewerId: string;

  @Column({
    name: 'target_type',
    type: 'enum',
    enum: QuestTargetType,
  })
  targetType: QuestTargetType;

  @Column({ name: 'target_id', type: 'uuid' })
  targetId: string;

  @Column({
    type: 'enum',
    enum: QuestClaimStatus,
    default: QuestClaimStatus.CLAIMED,
  })
  status: QuestClaimStatus;

  @Column({ name: 'time_limit_minutes', type: 'int', default: 120 })
  timeLimitMinutes: number;

  @CreateDateColumn({ name: 'claimed_at', type: 'timestamptz' })
  claimedAt: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ name: 'base_reward_credits', type: 'int', default: 10 })
  baseRewardCredits: number;

  @Column({ name: 'escalated_bonus_credits', type: 'int', default: 0 })
  escalatedBonusCredits: number;

  @Column({ name: 'penalty_applied', type: 'boolean', default: false })
  penaltyApplied: boolean;

  @Column({ name: 'penalty_notes', type: 'text', nullable: true })
  penaltyNotes: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reviewer_id' })
  reviewer?: User;
}
