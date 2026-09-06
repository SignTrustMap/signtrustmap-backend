import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReviewsService } from './application/reviews.service';
import { CandidateReview } from './infrastructure/persistence/candidate-review.entity';
import { ReviewFlag } from './infrastructure/persistence/review-flag.entity';
import { ReviewsController } from './presentation/reviews.controller';
import { TrafficSignType } from '../catalog/traffic-sign-type.entity';
import { UnverifiedSignCandidate } from '../survey/infrastructure/persistence/unverified-sign-candidate.entity';
import { ConsensusModule } from '../consensus/consensus.module';
@Module({
  imports: [
    TypeOrmModule.forFeature([
      UnverifiedSignCandidate,
      CandidateReview,
      ReviewFlag,
      TrafficSignType,
    ]),
    ConsensusModule,
  ],
  controllers: [ReviewsController],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
