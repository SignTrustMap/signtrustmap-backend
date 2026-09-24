import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { DailyTask } from './daily-task.entity';
import { DailyTaskCompletion } from './daily-task-completion.entity';
import { Wallet } from '../wallet/infrastructure/persistence/wallet.entity';
import {
  CreditTransaction,
  TransactionType,
} from '../wallet/infrastructure/persistence/credit-transaction.entity';

@Injectable()
export class DailyTasksService {
  constructor(
    @InjectRepository(DailyTask) private readonly taskRepo: Repository<DailyTask>,
    @InjectRepository(DailyTaskCompletion) private readonly completionRepo: Repository<DailyTaskCompletion>,
    @InjectRepository(Wallet) private readonly walletRepo: Repository<Wallet>,
    @InjectRepository(CreditTransaction) private readonly txRepo: Repository<CreditTransaction>,
    private readonly dataSource: DataSource,
  ) {}

  /** List all active daily tasks – helper for the frontend / Postman */
  async listActive() {
    return this.taskRepo.find({ where: { isActive: true }, order: { id: 'ASC' } });
  }

  /** List completions for the current user (today) */
  async listCompletions(userId: string, date?: string) {
    const targetDate = date || new Date().toISOString().slice(0, 10);
    return this.completionRepo.find({
      where: { userId, completionDate: targetDate },
      relations: ['dailyTask'],
      order: { dailyTaskId: 'ASC' },
    });
  }

  /**
   * POST /api/v1/daily-tasks/:id/claim
   * Validates that the task was completed today and not yet claimed,
   * then credits the wallet atomically.
   */
  async claim(userId: string, taskId: number) {
    const task = await this.taskRepo.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException(`Daily task #${taskId} not found`);
    if (!task.isActive) throw new BadRequestException(`Daily task #${taskId} is inactive`);

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC

    const completion = await this.completionRepo.findOne({
      where: { userId, dailyTaskId: taskId, completionDate: today },
    });

    if (!completion) {
      throw new BadRequestException(
        `Task #${taskId} has not been completed today (${today}). Complete the task before claiming.`,
      );
    }
    if (completion.claimed) {
      throw new ConflictException(`Reward for task #${taskId} has already been claimed today`);
    }

    return this.dataSource.transaction(async (manager) => {
      // Lock / re-check inside transaction
      const fresh = await manager.findOne(DailyTaskCompletion, {
        where: { userId, dailyTaskId: taskId, completionDate: today },
      });
      if (!fresh || fresh.claimed) {
        throw new ConflictException('Reward already claimed or completion missing');
      }

      // Ensure wallet exists
      let wallet = await manager.findOne(Wallet, { where: { userId } });
      if (!wallet) {
        wallet = manager.create(Wallet, { userId, balance: '0' });
        wallet = await manager.save(wallet);
      }

      // Mark as claimed
      fresh.claimed = true;
      fresh.claimedAt = new Date();
      await manager.save(fresh);

      // Credit wallet – bigint stored as string, do arithmetic in JS (safe for credit amounts)
      const newBalance = BigInt(wallet.balance) + BigInt(task.rewardCredits);
      await manager.update(Wallet, { id: wallet.id }, { balance: newBalance.toString() });

      // Record transaction
      const tx = manager.create(CreditTransaction, {
        walletId: wallet.id,
        amount: task.rewardCredits, // positive = earn
        transactionType: TransactionType.DAILY_TASK_REWARD,
        referenceType: 'daily_task',
        referenceId: null,
        description: `Daily task reward: ${task.taskCode} (${task.name})`,
      });
      const savedTx = await manager.save(tx);

      const updatedWallet = await manager.findOne(Wallet, { where: { id: wallet.id } });

      return {
        message: `Claimed ${task.rewardCredits} credits for task "${task.name}"`,
        reward: task.rewardCredits,
        wallet: { id: updatedWallet!.id, balance: Number(updatedWallet!.balance) },
        transaction: {
          id: savedTx.id,
          amount: savedTx.amount,
          transactionType: savedTx.transactionType,
          createdAt: savedTx.createdAt,
        },
        completion: { id: fresh.id, claimed: true, claimedAt: fresh.claimedAt },
      };
    });
  }
}
