import {
  Entity,
  PrimaryColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { UnverifiedSignCandidate } from '../../../survey/infrastructure/persistence/unverified-sign-candidate.entity';
import { User } from '../../../auth/infrastructure/persistence/user.entity';

@Entity('reviewer_skipped_candidates')
@Index(['reviewerId', 'candidateId'], { unique: true })
export class ReviewerSkippedCandidate {
  @PrimaryColumn({ name: 'reviewer_id', type: 'uuid' })
  reviewerId: string;

  @PrimaryColumn({ name: 'candidate_id', type: 'uuid' })
  candidateId: string;

  @CreateDateColumn({ name: 'skipped_at', type: 'timestamptz' })
  skippedAt: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reviewer_id' })
  reviewer: User;

  @ManyToOne(() => UnverifiedSignCandidate, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'candidate_id' })
  candidate: UnverifiedSignCandidate;
}
