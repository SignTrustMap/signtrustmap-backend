import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReviewsService } from './application/reviews.service';
import { BountyBoardService } from './application/bounty-board.service';
import { CandidateReview } from './infrastructure/persistence/candidate-review.entity';
import { ReviewFlag } from './infrastructure/persistence/review-flag.entity';
import { ReviewsController } from './presentation/reviews.controller';
import { CandidatesController } from './presentation/candidates.controller';
import { BountyBoardController } from './presentation/bounty-board.controller';
import { TrafficSignType } from '../catalog/traffic-sign-type.entity';
import { SignCategory } from '../catalog/sign-category.entity';
import { UnverifiedSignCandidate } from '../survey/infrastructure/persistence/unverified-sign-candidate.entity';
import { CandidateGeoEstimation } from '../survey/infrastructure/persistence/candidate-geo-estimation.entity';
import { SurveySubmission } from '../survey/infrastructure/persistence/survey-submission.entity';
import { VerifiedSignOrmEntity } from '../sign-map/infrastructure/persistence/verified-sign.orm-entity';
import { ConsensusModule } from '../consensus/consensus.module';
import { SpatialAdminModule } from '../spatial-admin/spatial-admin.module';
import { DailyTasksModule } from '../daily-tasks/daily-tasks.module';
import { ReviewerSkippedCandidate } from './infrastructure/persistence/reviewer-skipped-candidate.entity';
import { ReviewerProfile } from './infrastructure/persistence/reviewer-profile.entity';
import { CandidateRecaptureRequest } from './infrastructure/persistence/candidate-recapture-request.entity';
import { ReviewerReliabilityHistory } from './infrastructure/persistence/reviewer-reliability-history.entity';
import { ReviewerQuestClaim } from './infrastructure/persistence/reviewer-quest-claim.entity';
import { RevalidationTask } from '../revalidation/infrastructure/persistence/revalidation-task.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { AiInferenceModule } from '../../integrations/ai-inference/ai-inference.module';
import { GeocodingModule } from '../geocoding/geocoding.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UnverifiedSignCandidate,
      CandidateGeoEstimation,
      SurveySubmission,
      VerifiedSignOrmEntity,
      CandidateReview,
      ReviewFlag,
      TrafficSignType,
      SignCategory,
      ReviewerSkippedCandidate,
      ReviewerProfile,
      CandidateRecaptureRequest,
      ReviewerReliabilityHistory,
      ReviewerQuestClaim,
      RevalidationTask,
    ]),
    ConsensusModule,
    SpatialAdminModule,
    GeocodingModule,
    DailyTasksModule,
    NotificationsModule,
    AiInferenceModule,
  ],
  controllers: [ReviewsController, CandidatesController, BountyBoardController],
  providers: [ReviewsService, BountyBoardService],
  exports: [ReviewsService, BountyBoardService],
})
export class ReviewsModule {}
