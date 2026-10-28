import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DailyTask } from './daily-task.entity';
import { DailyTaskCompletion } from './daily-task-completion.entity';
import { MissionContributionEvent } from './mission-contribution-event.entity';
import { UserBadge } from './user-badge.entity';
import { CreditTransaction } from '../wallet/infrastructure/persistence/credit-transaction.entity';
import { DailyTasksService } from './daily-tasks.service';
import { DailyTasksController } from './daily-tasks.controller';
import { WalletModule } from '../wallet/wallet.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DailyTask,
      DailyTaskCompletion,
      MissionContributionEvent,
      UserBadge,
      CreditTransaction,
    ]),
    WalletModule,
    NotificationsModule,
  ],
  controllers: [DailyTasksController],
  providers: [DailyTasksService],
  exports: [DailyTasksService],
})
export class DailyTasksModule {}
