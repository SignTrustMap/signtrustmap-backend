import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum MissingTypeStatus {
  PENDING = 'PENDING',
  MERGED = 'MERGED',
  ESCALATED_ADMIN = 'ESCALATED_ADMIN',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  INCOMPLETE = 'INCOMPLETE',
}

@Entity('missing_sign_type_reports')
export class MissingSignTypeReport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'reporter_id', type: 'uuid' })
  reporterId: string;

  @Column({ name: 'candidate_id', type: 'uuid', nullable: true })
  candidateId: string | null;

  @Column({ name: 'proposed_category_id', type: 'int', nullable: true })
  proposedCategoryId: number | null;

  @Column({ name: 'proposed_name', type: 'varchar', length: 255 })
  proposedName: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'suggested_shape', type: 'varchar', length: 30, nullable: true })
  suggestedShape: string | null;

  @Column({ name: 'suggested_color_scheme', type: 'varchar', length: 30, nullable: true })
  suggestedColorScheme: string | null;

  @Column({ type: 'enum', enum: MissingTypeStatus, default: MissingTypeStatus.PENDING })
  status: MissingTypeStatus;

  @Column({ name: 'merged_into_sign_type_id', type: 'int', nullable: true })
  mergedIntoSignTypeId: number | null;

  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  reviewedBy: string | null;

  @Column({ name: 'staff_notes', type: 'text', nullable: true })
  staffNotes: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
