import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Unique,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DailyTask } from './daily-task.entity';

@Entity('daily_task_completions')
@Unique(['userId', 'dailyTaskId', 'completionDate'])
export class DailyTaskCompletion {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'daily_task_id', type: 'int' })
  dailyTaskId: number;

  /** Stored as DATE (YYYY-MM-DD). TypeORM maps to string; we keep string for portability. */
  @Column({ name: 'completion_date', type: 'date' })
  completionDate: string;

  @Column({ type: 'int', default: 0 })
  progress: number;

  @Column({ name: 'is_completed', type: 'boolean', default: false })
  isCompleted: boolean;

  @Column({ type: 'boolean', default: false })
  claimed: boolean;

  @Column({ name: 'claimed_at', type: 'timestamptz', nullable: true })
  claimedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => DailyTask, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'daily_task_id' })
  dailyTask: DailyTask;
}
