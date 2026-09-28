import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('reward_rules')
export class RewardRule {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'activity_type', type: 'varchar', length: 64, unique: true })
  activityType: string;

  @Column({ name: 'base_amount', type: 'int' })
  baseAmount: number;

  @Column({ name: 'daily_limit', type: 'int', default: 10 })
  dailyLimit: number;

  @Column({ name: 'multiplier_config', type: 'jsonb', default: () => "'{}'::jsonb" })
  multiplierConfig: Record<string, any>;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'effective_from', type: 'timestamptz', default: () => 'NOW()' })
  effectiveFrom: Date;

  @Column({ name: 'effective_to', type: 'timestamptz', nullable: true })
  effectiveTo: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
