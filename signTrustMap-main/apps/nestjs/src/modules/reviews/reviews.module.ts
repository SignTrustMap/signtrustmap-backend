import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UnverifiedSignCandidate } from '../../entities/unverified-sign-candidate.entity';
import { CandidateReview } from '../../entities/candidate-review.entity';
import { TrafficSignType } from '../../entities/traffic-sign-type.entity';
import { ReviewsService } from './reviews.service';
import { ReviewsController } from './reviews.controller';
import { ConsensusModule } from '../consensus/consensus.module';
@Module({
  imports: [TypeOrmModule.forFeature([UnverifiedSignCandidate, CandidateReview, TrafficSignType]), ConsensusModule],
  controllers: [ReviewsController],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
