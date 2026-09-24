import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

export enum RevalDecision {
  UNCHANGED = 'UNCHANGED',
  CHANGED = 'CHANGED',
  MISSING = 'MISSING',
  UNCLEAR = 'UNCLEAR',
  INVALID = 'INVALID',
}

@Entity('revalidation_decisions')
export class RevalidationDecision {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'evidence_id', type: 'uuid' })
  evidenceId: string;

  @Column({ name: 'reviewer_id', type: 'uuid' })
  reviewerId: string;

  @Column({ type: 'enum', enum: RevalDecision })
  decision: RevalDecision;

  @Column({ name: 'suggested_sign_type_id', type: 'int', nullable: true })
  suggestedSignTypeId: number | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'decided_at', type: 'timestamptz' })
  decidedAt: Date;
}
