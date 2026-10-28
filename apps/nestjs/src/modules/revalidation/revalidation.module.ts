import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RevalidationService } from './application/revalidation.service';
import { RevalidationDecision } from './infrastructure/persistence/revalidation-decision.entity';
import { RevalidationEvidence } from './infrastructure/persistence/revalidation-evidence.entity';
import { RevalidationTask } from './infrastructure/persistence/revalidation-task.entity';
import { FreshnessRule } from './infrastructure/persistence/freshness-rule.entity';
import { RouteClassification } from './infrastructure/persistence/route-classification.entity';
import { RevalidationController } from './presentation/revalidation.controller';
import { VerifiedSignOrmEntity } from '../sign-map/infrastructure/persistence/verified-sign.orm-entity';
import { SignLifecycleEvent } from '../sign-map/infrastructure/persistence/sign-lifecycle-event.entity';
import { VerifiedSignHistory } from '../sign-map/infrastructure/persistence/verified-sign-history.entity';
import { ModerationCase } from '../moderation/infrastructure/persistence/moderation-case.entity';
import { SurveyorProfile } from '../survey/infrastructure/persistence/surveyor-profile.entity';
import { TrafficSignType } from '../catalog/traffic-sign-type.entity';
import { ConsensusConfig } from '../consensus/infrastructure/persistence/consensus-config.entity';
import { WalletModule } from '../wallet/wallet.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { DailyTasksModule } from '../daily-tasks/daily-tasks.module';
import { AiInferenceModule } from '../../integrations/ai-inference/ai-inference.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RevalidationTask,
      RevalidationEvidence,
      RevalidationDecision,
      FreshnessRule,
      RouteClassification,
      VerifiedSignOrmEntity,
      SignLifecycleEvent,
      VerifiedSignHistory,
      ModerationCase,
      SurveyorProfile,
      TrafficSignType,
      ConsensusConfig,
    ]),
    WalletModule,
    NotificationsModule,
    DailyTasksModule,
    AiInferenceModule,
  ],
  controllers: [RevalidationController],
  providers: [RevalidationService],
  exports: [RevalidationService],
})
export class RevalidationModule {}
