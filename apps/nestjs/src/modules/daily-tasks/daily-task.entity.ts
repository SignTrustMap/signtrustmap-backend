import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('daily_tasks')
export class DailyTask {
  @PrimaryGeneratedColumn({ type: 'int' })
  id: number;

  @Column({ name: 'task_code', type: 'varchar', length: 50, unique: true })
  taskCode: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'target_count', type: 'int', default: 1 })
  targetCount: number;

  @Column({ name: 'reward_credits', type: 'int' })
  rewardCredits: number;

  @Column({ name: 'activity_type', type: 'varchar', length: 50, default: 'SURVEY' })
  activityType: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
