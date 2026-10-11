import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReviewsService } from './application/reviews.service';
import { CandidateReview } from './infrastructure/persistence/candidate-review.entity';
import { ReviewFlag } from './infrastructure/persistence/review-flag.entity';
import { ReviewsController } from './presentation/reviews.controller';
import { TrafficSignType } from '../catalog/traffic-sign-type.entity';
import { UnverifiedSignCandidate } from '../survey/infrastructure/persistence/unverified-sign-candidate.entity';
import { ConsensusModule } from '../consensus/consensus.module';
import { SpatialAdminModule } from '../spatial-admin/spatial-admin.module';
import { DailyTasksModule } from '../daily-tasks/daily-tasks.module';
import { ReviewerSkippedCandidate } from './infrastructure/persistence/reviewer-skipped-candidate.entity';
import { ReviewerProfile } from './infrastructure/persistence/reviewer-profile.entity';
import { CandidateRecaptureRequest } from './infrastructure/persistence/candidate-recapture-request.entity';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UnverifiedSignCandidate,
      CandidateReview,
      ReviewFlag,
      TrafficSignType,
      ReviewerSkippedCandidate,
      ReviewerProfile,
      CandidateRecaptureRequest,
    ]),
    ConsensusModule,
    SpatialAdminModule,
    DailyTasksModule,
    NotificationsModule,
  ],
  controllers: [ReviewsController],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
