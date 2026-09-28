import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { DailyTask } from './daily-task.entity';
import { DailyTaskCompletion } from './daily-task-completion.entity';
import { WalletService } from '../wallet/application/wallet.service';
import { TransactionType } from '../wallet/infrastructure/persistence/credit-transaction.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { RedisService } from '../../integrations/redis/redis.service';

export interface DailyTaskWithProgress {
  id: number;
  taskCode: string;
  name: string;
  description: string | null;
  rewardCredits: number;
  targetCount: number;
  activityType: string;
  progress: number;
  isCompleted: boolean;
  isClaimable: boolean;
  isClaimed: boolean;
  claimedAt: Date | null;
}

@Injectable()
export class DailyTasksService {
  private readonly logger = new Logger(DailyTasksService.name);

  constructor(
    @InjectRepository(DailyTask)
    private readonly taskRepo: Repository<DailyTask>,
    @InjectRepository(DailyTaskCompletion)
    private readonly completionRepo: Repository<DailyTaskCompletion>,
    private readonly walletService: WalletService,
    private readonly redisService: RedisService,
    private readonly notificationsService: NotificationsService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * List all active daily tasks
   */
  async listActive(): Promise<DailyTask[]> {
    return this.taskRepo.find({ where: { isActive: true }, order: { id: 'ASC' } });
  }

  /**
   * List today's daily tasks with current user's progress and claimability status
   */
  async listTasksWithProgress(userId: string, date?: string): Promise<DailyTaskWithProgress[]> {
    const targetDate = date || new Date().toISOString().slice(0, 10);
    const tasks = await this.listActive();

    const completions = await this.completionRepo.find({
      where: { userId, completionDate: targetDate },
    });

    const completionMap = new Map<number, DailyTaskCompletion>();
    for (const c of completions) {
      completionMap.set(c.dailyTaskId, c);
    }

    return tasks.map((task) => {
      const comp = completionMap.get(task.id);
      const progress = comp ? comp.progress : 0;
      const isCompleted = comp ? comp.isCompleted : false;
      const isClaimed = comp ? comp.claimed : false;
      const isClaimable = isCompleted && !isClaimed;

      return {
        id: task.id,
        taskCode: task.taskCode,
        name: task.name,
        description: task.description,
        rewardCredits: task.rewardCredits,
        targetCount: task.targetCount,
        activityType: task.activityType,
        progress,
        isCompleted,
        isClaimable,
        isClaimed,
        claimedAt: comp?.claimedAt ?? null,
      };
    });
  }

  /**
   * List completion records for the current user
   */
  async listCompletions(userId: string, date?: string): Promise<DailyTaskCompletion[]> {
    const targetDate = date || new Date().toISOString().slice(0, 10);
    return this.completionRepo.find({
      where: { userId, completionDate: targetDate },
      relations: ['dailyTask'],
      order: { dailyTaskId: 'ASC' },
    });
  }

  /**
   * Event-driven hook to record contributor activity and advance daily task progress
   */
  async recordProgress(
    userId: string,
    activityType: string,
    count: number = 1,
  ): Promise<DailyTaskCompletion[]> {
    if (count <= 0) return [];

    const today = new Date().toISOString().slice(0, 10);
    const matchingTasks = await this.taskRepo.find({
      where: { activityType, isActive: true },
    });

    if (!matchingTasks.length) return [];

    const updatedCompletions: DailyTaskCompletion[] = [];

    for (const task of matchingTasks) {
      let completion = await this.completionRepo.findOne({
        where: { userId, dailyTaskId: task.id, completionDate: today },
      });

      if (!completion) {
        completion = this.completionRepo.create({
          userId,
          dailyTaskId: task.id,
          completionDate: today,
          progress: 0,
          isCompleted: false,
          claimed: false,
          claimedAt: null,
        });
      }

      if (completion.isCompleted) {
        continue;
      }

      completion.progress = Math.min(task.targetCount, completion.progress + count);
      if (completion.progress >= task.targetCount) {
        completion.isCompleted = true;
      }

      const saved = await this.completionRepo.save(completion);
      updatedCompletions.push(saved);
    }

    return updatedCompletions;
  }

  /**
   * POST /api/v1/daily-tasks/:id/claim
   * Protected with Redis Redlock distributed mutex to eliminate double-claim race conditions.
   */
  async claim(userId: string, taskId: number) {
    const today = new Date().toISOString().slice(0, 10);
    const lockKey = `lock:daily_task_claim:${userId}:${taskId}:${today}`;

    // 1. Acquire distributed lock with 10s TTL
    const lockToken = await this.redisService.acquireLock(lockKey, 10000);
    if (!lockToken) {
      throw new ConflictException(
        `A claim request for task #${taskId} is already being processed. Please wait.`,
      );
    }

    try {
      // 2. Validate task existence and status
      const task = await this.taskRepo.findOne({ where: { id: taskId } });
      if (!task) {
        throw new NotFoundException(`Daily task #${taskId} not found`);
      }
      if (!task.isActive) {
        throw new BadRequestException(`Daily task #${taskId} is inactive`);
      }

      // 3. Validate completion record
      let completion = await this.completionRepo.findOne({
        where: { userId, dailyTaskId: taskId, completionDate: today },
      });

      if (!completion) {
        throw new BadRequestException(
          `Task #${taskId} has not been completed today (${today}). Complete the task before claiming.`,
        );
      }

      if (!completion.isCompleted && completion.progress < task.targetCount) {
        throw new BadRequestException(
          `Task #${taskId} is incomplete (${completion.progress}/${task.targetCount} steps).`,
        );
      }

      if (completion.claimed) {
        throw new ConflictException(`Reward for task #${taskId} has already been claimed today`);
      }

      // 4. Mark completion as claimed
      completion.claimed = true;
      completion.claimedAt = new Date();
      completion = await this.completionRepo.save(completion);

      // 5. Payout credit reward via WalletService
      const idempotencyKey = `daily_task_claim:${userId}:${taskId}:${today}`;
      const creditResult = await this.walletService.creditUser(
        userId,
        task.rewardCredits,
        TransactionType.DAILY_TASK_REWARD,
        'daily_task',
        String(completion.id),
        `Daily task reward: ${task.taskCode} (${task.name})`,
        { idempotencyKey },
      );

      // 6. Push notification
      try {
        await this.notificationsService.create(
          userId,
          'DAILY_TASK_CLAIMED',
          'Daily Challenge Completed!',
          `You earned +${task.rewardCredits} credits for completing "${task.name}".`,
          'daily_task',
          String(task.id),
        );
      } catch (err: any) {
        this.logger.warn(`Failed to send daily task notification: ${err.message}`);
      }

      // 7. Audit log entry
      try {
        await this.dataSource.query(
          `INSERT INTO audit_logs (user_id, action, resource_name, resource_id, new_values)
           VALUES ($1, 'CLAIM_DAILY_TASK', 'daily_task_completions', $2, $3)`,
          [
            userId,
            String(completion.id),
            JSON.stringify({
              taskId: task.id,
              taskCode: task.taskCode,
              rewardCredits: task.rewardCredits,
              balanceAfter: creditResult.newBalance.toString(),
            }),
          ],
        );
      } catch {}

      return {
        message: `Claimed ${task.rewardCredits} credits for task "${task.name}"`,
        reward: task.rewardCredits,
        wallet: {
          id: creditResult.walletId,
          balance: creditResult.newBalance,
        },
        completion: {
          id: completion.id,
          claimed: true,
          claimedAt: completion.claimedAt,
        },
      };
    } finally {
      // 8. Always release distributed lock
      await this.redisService.releaseLock(lockKey, lockToken);
    }
  }

  /**
   * Midnight UTC rollover: sweep or archive unclaimed tasks from previous day
   */
  async rolloverUnclaimedTasks(date?: string): Promise<{ rolledOverDate: string; unclaimedCount: number }> {
    const yesterday = date || new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const unclaimedRows = await this.completionRepo.find({
      where: { completionDate: yesterday, isCompleted: true, claimed: false },
    });

    this.logger.log(`Midnight UTC rollover: ${unclaimedRows.length} unclaimed task(s) for ${yesterday}`);
    return { rolledOverDate: yesterday, unclaimedCount: unclaimedRows.length };
  }
}
