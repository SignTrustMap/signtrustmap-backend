import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ModerationService } from './application/moderation.service';
import { NewSignTypeReport } from './infrastructure/persistence/missing-sign-type-report.entity';
import { ModerationAction } from './infrastructure/persistence/moderation-action.entity';
import { ModerationCase } from './infrastructure/persistence/moderation-case.entity';
import { ModerationController } from './presentation/moderation.controller';
import { SignCategory } from '../catalog/sign-category.entity';
import { TrafficSignType } from '../catalog/traffic-sign-type.entity';
import { UnverifiedSignCandidate } from '../survey/infrastructure/persistence/unverified-sign-candidate.entity';
import { SurveyorProfile } from '../survey/infrastructure/persistence/surveyor-profile.entity';
import { SurveyorReputationHistory } from '../survey/infrastructure/persistence/surveyor-reputation-history.entity';
import { CandidateRecaptureRequest } from '../reviews/infrastructure/persistence/candidate-recapture-request.entity';
import { ReviewerQuestClaim } from '../reviews/infrastructure/persistence/reviewer-quest-claim.entity';
import { ReviewerSkippedCandidate } from '../reviews/infrastructure/persistence/reviewer-skipped-candidate.entity';
import { User } from '../auth/infrastructure/persistence/user.entity';
import { SignTypeImage } from '../catalog/sign-type-image.entity';
import { UserStatusHistory } from '../admin/user-status-history.entity';
import { AuditLog } from '../admin/audit-log.entity';
import { AdminModule } from '../admin/admin.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CatalogModule } from '../catalog/catalog.module';
import { CatalogSyncModule } from '../../integrations/catalog-sync/catalog-sync.module';
import { MinioModule } from '../../integrations/minio/minio.module';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ModerationCase,
      ModerationAction,
      NewSignTypeReport,
      SignCategory,
      TrafficSignType,
      UnverifiedSignCandidate,
      SurveyorProfile,
      SurveyorReputationHistory,
      CandidateRecaptureRequest,
      ReviewerQuestClaim,
      ReviewerSkippedCandidate,
      User,
      SignTypeImage,
      UserStatusHistory,
      AuditLog,
    ]),
    AdminModule,
    NotificationsModule,
    CatalogModule,
    CatalogSyncModule,
    MinioModule,
    WalletModule,
  ],
  controllers: [ModerationController],
  providers: [ModerationService],
  exports: [ModerationService],
})
export class ModerationModule {}
