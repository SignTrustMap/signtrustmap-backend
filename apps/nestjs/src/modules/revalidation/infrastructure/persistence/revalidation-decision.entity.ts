import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

export enum RevalDecision {
  UNCHANGED = 'UNCHANGED',
  STILL_ACTIVE = 'STILL_ACTIVE',
  CHANGED = 'CHANGED',
  MISSING = 'MISSING',
  REMOVED = 'REMOVED',
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

  @Column({ name: 'reviewer_location', type: 'geometry', spatialFeatureType: 'Point', srid: 4326, nullable: true })
  reviewerLocation: any;

  @Column({ name: 'accuracy_meters', type: 'double precision', nullable: true })
  accuracyMeters: number | null;

  @Column({ name: 'quest_claim_id', type: 'uuid', nullable: true })
  questClaimId: string | null;

  @CreateDateColumn({ name: 'decided_at', type: 'timestamptz' })
  decidedAt: Date;
}
