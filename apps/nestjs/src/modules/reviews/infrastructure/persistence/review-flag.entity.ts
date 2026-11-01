import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('review_flags')
export class ReviewFlag {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'review_id', type: 'uuid' })
  reviewId: string;

  @Column({ name: 'flag_reason', type: 'enum', enum: ['BLURRY', 'CORRECTED_LABEL', 'NEW_SIGN_TYPE', 'MISSING_TYPE', 'DUPLICATE', 'FRAUD'] as any })
  reason: string;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
