import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

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

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'effective_from', type: 'timestamptz', default: () => 'now()' })
  effectiveFrom: Date;
}
