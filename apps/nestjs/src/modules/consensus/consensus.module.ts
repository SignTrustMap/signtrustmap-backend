import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConsensusService } from './application/consensus.service';
import { ConsensusConfig } from './infrastructure/persistence/consensus-config.entity';
import { ConsensusLog } from './infrastructure/persistence/consensus-log.entity';
import { CandidateReview } from '../reviews/infrastructure/persistence/candidate-review.entity';
import { UnverifiedSignCandidate } from '../survey/infrastructure/persistence/unverified-sign-candidate.entity';
import { ReviewerProfile } from '../reviews/infrastructure/persistence/reviewer-profile.entity';
import { ReviewerReliabilityHistory } from '../reviews/infrastructure/persistence/reviewer-reliability-history.entity';
import { VerifiedSignOrmEntity } from '../sign-map/infrastructure/persistence/verified-sign.orm-entity';
import { SignLifecycleEvent } from '../sign-map/infrastructure/persistence/sign-lifecycle-event.entity';
import { VerifiedSignHistory } from '../sign-map/infrastructure/persistence/verified-sign-history.entity';
import { CandidateGeoEstimation } from '../survey/infrastructure/persistence/candidate-geo-estimation.entity';
import { SurveySubmission } from '../survey/infrastructure/persistence/survey-submission.entity';
import { SurveyorProfile } from '../survey/infrastructure/persistence/surveyor-profile.entity';
import { ModerationCase } from '../moderation/infrastructure/persistence/moderation-case.entity';
import { RevalidationTask } from '../revalidation/infrastructure/persistence/revalidation-task.entity';
import { WalletModule } from '../wallet/wallet.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SpatialAdminModule } from '../spatial-admin/spatial-admin.module';
import { DailyTasksModule } from '../daily-tasks/daily-tasks.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ConsensusConfig,
      ConsensusLog,
      UnverifiedSignCandidate,
      CandidateReview,
      ReviewerProfile,
      ReviewerReliabilityHistory,
      VerifiedSignOrmEntity,
      SignLifecycleEvent,
      VerifiedSignHistory,
      CandidateGeoEstimation,
      SurveySubmission,
      SurveyorProfile,
      ModerationCase,
      RevalidationTask,
    ]),
    WalletModule,
    NotificationsModule,
    SpatialAdminModule,
    DailyTasksModule,
  ],
  providers: [ConsensusService],
  exports: [ConsensusService],
})
export class ConsensusModule {}
