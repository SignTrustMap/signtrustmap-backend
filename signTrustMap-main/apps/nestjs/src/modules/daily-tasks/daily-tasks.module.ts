import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DailyTask } from '../../entities/daily-task.entity';
import { DailyTaskCompletion } from '../../entities/daily-task-completion.entity';
import { Wallet } from '../../entities/wallet.entity';
import { CreditTransaction } from '../../entities/credit-transaction.entity';
import { DailyTasksService } from './daily-tasks.service';
import { DailyTasksController } from './daily-tasks.controller';

@Module({
  imports: [TypeOrmModule.forFeature([DailyTask, DailyTaskCompletion, Wallet, CreditTransaction])],
  controllers: [DailyTasksController],
  providers: [DailyTasksService],
  exports: [DailyTasksService],
})
export class DailyTasksModule {}
