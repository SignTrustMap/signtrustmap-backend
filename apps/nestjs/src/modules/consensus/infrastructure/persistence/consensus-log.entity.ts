import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export enum ConsensusOutcome {
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  ESCALATED = 'ESCALATED',
}

@Entity('consensus_logs')
export class ConsensusLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'candidate_id', type: 'uuid' })
  candidateId: string;

  @Column({ name: 'config_id', type: 'int' })
  configId: number;

  @Column({ name: 'calculated_score', type: 'float' })
  calculatedScore: number;

  @Column({ name: 'final_outcome', type: 'enum', enum: ConsensusOutcome })
  finalOutcome: ConsensusOutcome;

  @Column({ name: 'verified_sign_type_id', type: 'int', nullable: true })
  verifiedSignTypeId: number | null;

  @CreateDateColumn({ name: 'executed_at', type: 'timestamptz' })
  executedAt: Date;
}
