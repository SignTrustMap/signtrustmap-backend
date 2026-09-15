import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RevalidationService } from './application/revalidation.service';
import { RevalidationDecision } from './infrastructure/persistence/revalidation-decision.entity';
import { RevalidationEvidence } from './infrastructure/persistence/revalidation-evidence.entity';
import { RevalidationTask } from './infrastructure/persistence/revalidation-task.entity';
import { FreshnessRule } from './infrastructure/persistence/freshness-rule.entity';
import { RevalidationController } from './presentation/revalidation.controller';
import { WalletModule } from '../wallet/wallet.module';
import { NotificationsModule } from '../notifications/notifications.module';
@Module({
  imports: [TypeOrmModule.forFeature([RevalidationTask, RevalidationEvidence, RevalidationDecision, FreshnessRule]), WalletModule, NotificationsModule],
  controllers: [RevalidationController],
  providers: [RevalidationService],
  exports: [RevalidationService],
})
export class RevalidationModule {}
