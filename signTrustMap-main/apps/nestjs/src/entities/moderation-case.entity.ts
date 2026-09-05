import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

export enum ModerationType {
  REVIEW_CONFLICT = 'REVIEW_CONFLICT',
  SUSPICIOUS_GPS = 'SUSPICIOUS_GPS',
  SPAM_SUBMISSION = 'SPAM_SUBMISSION',
  PAYMENT_DISCREPANCY = 'PAYMENT_DISCREPANCY',
  CATALOG_PROPOSAL = 'CATALOG_PROPOSAL',
}

export enum ModerationStatus {
  PENDING = 'PENDING',
  IN_REVIEW = 'IN_REVIEW',
  RESOLVED = 'RESOLVED',
  ESCALATED_ADMIN = 'ESCALATED_ADMIN',
}

@Entity('moderation_cases')
export class ModerationCase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'case_type', type: 'enum', enum: ModerationType })
  caseType: ModerationType;

  @Column({ name: 'target_entity_type', type: 'varchar', length: 50 })
  targetEntityType: string;

  @Column({ name: 'target_entity_id', type: 'uuid' })
  targetEntityId: string;

  @Column({ name: 'assigned_staff_id', type: 'uuid', nullable: true })
  assignedStaffId: string | null;

  @Column({ type: 'enum', enum: ModerationStatus, default: ModerationStatus.PENDING })
  status: ModerationStatus;

  @Column({ name: 'resolution_note', type: 'text', nullable: true })
  resolutionNote: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;
}
