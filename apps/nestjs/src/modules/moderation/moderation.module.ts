import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ModerationService } from './application/moderation.service';
import { MissingSignTypeReport } from './infrastructure/persistence/missing-sign-type-report.entity';
import { ModerationAction } from './infrastructure/persistence/moderation-action.entity';
import { ModerationCase } from './infrastructure/persistence/moderation-case.entity';
import { ModerationController } from './presentation/moderation.controller';
import { SignCategory } from '../catalog/sign-category.entity';
import { TrafficSignType } from '../catalog/traffic-sign-type.entity';
import { UnverifiedSignCandidate } from '../survey/infrastructure/persistence/unverified-sign-candidate.entity';
import { CandidateRecaptureRequest } from '../reviews/infrastructure/persistence/candidate-recapture-request.entity';
import { User } from '../auth/infrastructure/persistence/user.entity';
import { SignTypeImage } from '../catalog/sign-type-image.entity';
import { UserStatusHistory } from '../admin/user-status-history.entity';
import { AuditLog } from '../admin/audit-log.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { CatalogModule } from '../catalog/catalog.module';
import { CatalogSyncModule } from '../../integrations/catalog-sync/catalog-sync.module';
import { MinioModule } from '../../integrations/minio/minio.module';
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ModerationCase,
      ModerationAction,
      MissingSignTypeReport,
      SignCategory,
      TrafficSignType,
      UnverifiedSignCandidate,
      CandidateRecaptureRequest,
      User,
      SignTypeImage,
      UserStatusHistory,
      AuditLog,
    ]),
    NotificationsModule,
    CatalogModule,
    CatalogSyncModule,
    MinioModule,
  ],
  controllers: [ModerationController],
  providers: [ModerationService],
  exports: [ModerationService],
})
export class ModerationModule {}
