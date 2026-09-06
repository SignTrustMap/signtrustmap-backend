import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DailyTask } from './daily-task.entity';
import { DailyTaskCompletion } from './daily-task-completion.entity';
import { Wallet } from '../wallet/infrastructure/persistence/wallet.entity';
import { CreditTransaction } from '../wallet/infrastructure/persistence/credit-transaction.entity';
import { DailyTasksService } from './daily-tasks.service';
import { DailyTasksController } from './daily-tasks.controller';

@Module({
  imports: [TypeOrmModule.forFeature([DailyTask, DailyTaskCompletion, Wallet, CreditTransaction])],
  controllers: [DailyTasksController],
  providers: [DailyTasksService],
  exports: [DailyTasksService],
})
export class DailyTasksModule {}
