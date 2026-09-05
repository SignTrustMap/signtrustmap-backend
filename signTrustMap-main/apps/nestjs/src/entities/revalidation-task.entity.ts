import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

export enum TaskPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

export enum TaskStatus {
  OPEN = 'OPEN',
  EVALUATING = 'EVALUATING',
  COMPLETED = 'COMPLETED',
  EXPIRED = 'EXPIRED',
}

@Entity('revalidation_tasks')
export class RevalidationTask {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'verified_sign_id', type: 'uuid' })
  verifiedSignId: string;

  @Column({ name: 'freshness_rule_id', type: 'int', nullable: true })
  freshnessRuleId: number | null;

  @Column({ type: 'enum', enum: TaskPriority, default: TaskPriority.MEDIUM })
  priority: TaskPriority;

  @Column({ name: 'reward_credits', type: 'int', default: 10 })
  rewardCredits: number;

  @Column({ type: 'enum', enum: TaskStatus, default: TaskStatus.OPEN })
  status: TaskStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'expired_at', type: 'timestamptz', nullable: true })
  expiredAt: Date | null;
}
