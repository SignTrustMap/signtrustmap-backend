import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { UnverifiedSignCandidate } from './unverified-sign-candidate.entity';
import { User } from './user.entity';
import { TrafficSignType } from './traffic-sign-type.entity';

@Entity('candidate_reviews')
@Index(['candidateId', 'reviewerId'], { unique: true })
export class CandidateReview {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'candidate_id', type: 'uuid' })
  candidateId: string;

  @Column({ name: 'reviewer_id', type: 'uuid' })
  reviewerId: string;

  @Column({ type: 'smallint' })
  vote: number;

  @Column({ name: 'suggested_sign_type_id', type: 'int', nullable: true })
  suggestedSignTypeId: number | null;

  @Column({ name: 'decline_reason', type: 'varchar', length: 50, nullable: true })
  declineReason: string | null;

  @Column({ name: 'decline_note', type: 'varchar', length: 500, nullable: true })
  declineNote: string | null;

  @CreateDateColumn({ name: 'reviewed_at', type: 'timestamptz' })
  reviewedAt: Date;

  @ManyToOne(() => UnverifiedSignCandidate, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'candidate_id' })
  candidate: UnverifiedSignCandidate;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reviewer_id' })
  reviewer: User;

  @ManyToOne(() => TrafficSignType, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'suggested_sign_type_id' })
  suggestedSignType: TrafficSignType | null;
}
