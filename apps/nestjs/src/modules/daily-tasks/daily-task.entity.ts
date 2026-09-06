import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

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

  @Column({ name: 'reward_credits', type: 'int' })
  rewardCredits: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;
}
