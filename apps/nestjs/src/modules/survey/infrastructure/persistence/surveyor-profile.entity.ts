import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('surveyor_profiles')
export class SurveyorProfile {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'total_submissions', type: 'int', default: 0 })
  totalSubmissions: number;

  @Column({ name: 'total_verified_signs', type: 'int', default: 0 })
  totalVerifiedSigns: number;

  @Column({ name: 'total_credits_earned', type: 'bigint', default: 0 })
  totalCreditsEarned: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
