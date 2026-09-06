import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('review_flags')
export class ReviewFlag {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'review_id', type: 'uuid' })
  reviewId: string;

  @Column({ type: 'enum', enum: ['BLURRY', 'CORRECTED_LABEL', 'MISSING_TYPE', 'DUPLICATE', 'FRAUD'] as any })
  reason: string;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
