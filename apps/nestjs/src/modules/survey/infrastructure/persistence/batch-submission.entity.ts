import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../../../auth/infrastructure/persistence/user.entity';

export enum BatchRewardStatus {
  NONE = 'NONE',
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  PAID = 'PAID',
  WITHHELD = 'WITHHELD',
  REJECTED = 'REJECTED',
  REVERSED = 'REVERSED',
}

export enum BatchProcessingStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

@Entity('batch_submissions')
export class BatchSubmission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  title: string | null;

  @Column({ name: 'total_images', type: 'int', default: 0 })
  totalImages: number;

  @Column({ name: 'processed_images', type: 'int', default: 0 })
  processedImages: number;

  @Column({ name: 'extracted_candidates', type: 'int', default: 0 })
  extractedCandidates: number;

  @Column({ name: 'reward_status', type: 'varchar', length: 32, default: BatchRewardStatus.PENDING })
  rewardStatus: BatchRewardStatus;

  @Column({ name: 'reward_amount', type: 'int', default: 0 })
  rewardAmount: number;

  @Column({ type: 'varchar', length: 32, default: BatchProcessingStatus.PENDING })
  status: BatchProcessingStatus;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata: Record<string, any>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
