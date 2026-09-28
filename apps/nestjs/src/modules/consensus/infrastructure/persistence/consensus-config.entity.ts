import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('consensus_configs')
export class ConsensusConfig {
  @PrimaryGeneratedColumn({ type: 'int' })
  id: number;

  @Column({ name: 'approval_threshold', type: 'float' })
  approvalThreshold: number;

  @Column({ name: 'rejection_threshold', type: 'float' })
  rejectionThreshold: number;

  @Column({ name: 'min_votes_required', type: 'int', default: 3 })
  minVotesRequired: number;

  @Column({ name: 'alpha_smoothing_factor', type: 'float', default: 0.1 })
  alphaSmoothingFactor: number;

  @Column({ name: 'weight_correct', type: 'float', default: 1.0 })
  weightCorrect: number;

  @Column({ name: 'penalty_false', type: 'float', default: 2.0 })
  penaltyFalse: number;

  @Column({ name: 'min_sample_baseline', type: 'int', default: 5 })
  minSampleBaseline: number;

  @Column({ name: 'min_reliability_threshold', type: 'float', default: 50.0 })
  minReliabilityThreshold: number;

  @Column({ name: 'consecutive_error_limit', type: 'int', default: 3 })
  consecutiveErrorLimit: number;

  @Column({ name: 'suspension_cooldown_days', type: 'int', default: 7 })
  suspensionCooldownDays: number;

  @Column({ name: 'provisional_vote_weight', type: 'float', default: 0.5 })
  provisionalVoteWeight: number;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'effective_from', type: 'timestamptz', default: () => 'now()' })
  effectiveFrom: Date;
}
