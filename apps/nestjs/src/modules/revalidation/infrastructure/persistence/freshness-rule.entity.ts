import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum RulePriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

/**
 * Represents a row in `freshness_rules`.
 *
 * The `max_proximity_meters` and `daily_submission_limit` columns are added
 * by migration `005_revalidation_and_missing_type.sql` and enforce the
 * on-site evidence guardrails described in Scenario #3 (Flow 8).
 */
@Entity('freshness_rules')
export class FreshnessRule {
  @PrimaryGeneratedColumn({ type: 'int' })
  id: number;

  @Column({ name: 'sign_category_id', type: 'int', nullable: true })
  signCategoryId: number | null;

  @Column({ name: 'freshness_period_days', type: 'int' })
  freshnessPeriodDays: number;

  @Column({ name: 'default_priority', type: 'enum', enum: RulePriority, default: RulePriority.MEDIUM })
  defaultPriority: RulePriority;

  @Column({ name: 'max_proximity_meters', type: 'int', default: 50 })
  maxProximityMeters: number;

  @Column({ name: 'daily_submission_limit', type: 'int', default: 3 })
  dailySubmissionLimit: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;
}