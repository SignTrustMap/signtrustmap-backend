import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RevalidationTask } from '../../entities/revalidation-task.entity';
import { RevalidationEvidence } from '../../entities/revalidation-evidence.entity';
import { RevalidationDecision } from '../../entities/revalidation-decision.entity';
import { RevalidationService } from './revalidation.service';
import { RevalidationController } from './revalidation.controller';
import { WalletModule } from '../wallet/wallet.module';
import { NotificationsModule } from '../notifications/notifications.module';
@Module({
  imports: [TypeOrmModule.forFeature([RevalidationTask, RevalidationEvidence, RevalidationDecision]), WalletModule, NotificationsModule],
  controllers: [RevalidationController],
  providers: [RevalidationService],
  exports: [RevalidationService],
})
export class RevalidationModule {}
