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

type MissionEventType = 'VERIFIED_SIGN' | 'APPROVED_ANOMALY';

interface MissionPeriod {
  startDate: string;
  endDateExclusive: string;
  start: Date;
  end: Date;
}

interface MissionActivityDay {
  contribution_day: string;
  verified_sign_count: number | string;
  approved_anomaly_count: number | string;
  rewarded_anomaly_count: number | string;
}

const VERIFY_THREE_SIGNS_REWARD = 15;
const APPROVED_ANOMALY_REWARD = 20;
const WEEKLY_FIVE_MISSIONS_REWARD = 50;
const STREAK_SEVEN_BADGE = 'CONTRIBUTION_STREAK_7';
const STREAK_BONUS_PARAMETER = 'MISSIONS_STREAK_BONUS_CREDITS';

function addCalendarDays(date: string, count: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + count));
  return value.toISOString().slice(0, 10);
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
   * Record a reviewer who voted with the consensus for a published, verified sign.
   * The candidate ID is the idempotency boundary for this user's contribution.
   */
  async recordVerifiedSign(userId: string, candidateId: string): Promise<void> {
    await this.recordMissionContribution(userId, 'VERIFIED_SIGN', candidateId);
  }

  /**
   * Record the report owner's contribution only after consensus and evidence validation.
   */
  async recordApprovedAnomaly(userId: string, hazardId: string): Promise<void> {
    await this.recordMissionContribution(userId, 'APPROVED_ANOMALY', hazardId);
  }

  async getMissionOverview(userId: string) {
    const now = new Date();
    const timeZone = this.getMissionTimeZone();
    const today = this.dateInTimeZone(now, timeZone);
    const dayPeriod = this.getPeriod(today, 1, timeZone);
    const weekStart = this.getWeekStart(today);
    const weekPeriod = this.getPeriod(weekStart, 7, timeZone);
    const weekEndDate = addCalendarDays(weekPeriod.endDateExclusive, -1);

    const dayRows = await this.getMissionActivityDays(userId, dayPeriod, timeZone);
    const todayActivity = dayRows[0] ?? {
      contribution_day: today,
      verified_sign_count: 0,
      approved_anomaly_count: 0,
      rewarded_anomaly_count: 0,
    };
    const verifiedSignsToday = Number(todayActivity.verified_sign_count);
    const approvedAnomaliesToday = Number(todayActivity.approved_anomaly_count);

    const weekRows = await this.getMissionActivityDays(userId, weekPeriod, timeZone);
    const weeklyCompletedMissions = weekRows.reduce(
      (total, row) =>
        total +
        (Number(row.verified_sign_count) >= 3 ? 1 : 0) +
        Number(row.approved_anomaly_count),
      0,
    );
    const weeklyBonusKey = this.weeklyBonusKey(userId, weekStart);
    const weeklyBonusGranted = await this.hasReward(weeklyBonusKey);

    const streakDates = await this.getRecentContributionDates(userId, dayPeriod.end, timeZone);
    const currentStreakDays = this.calculateCurrentStreak(streakDates, today);
    const badgeRows: Array<{ badge_code: string; earned_at: Date }> = await this.dataSource.query(
      `SELECT badge_code, earned_at
       FROM user_badges
       WHERE user_id = $1
       ORDER BY earned_at DESC`,
      [userId],
    );
    const streakBonusCredits = await this.getConfiguredStreakBonus();

    return {
      timeZone,
      daily: {
        date: today,
        missions: [
          {
            code: 'VERIFY_3_SIGNS',
            title: 'Verify 3 eligible traffic signs',
            progress: Math.min(verifiedSignsToday, 3),
            target: 3,
            completed: verifiedSignsToday >= 3,
            rewardCredits: VERIFY_THREE_SIGNS_REWARD,
            rewardGranted:
              verifiedSignsToday >= 3 &&
              (await this.hasReward(this.dailySignRewardKey(userId, today))),
          },
          {
            code: 'APPROVED_ANOMALY_REPORT',
            title: 'Submit an approved anomaly report with evidence',
            progress: approvedAnomaliesToday,
            target: 1,
            completed: approvedAnomaliesToday > 0,
            rewardCredits: APPROVED_ANOMALY_REWARD,
            rewardGranted:
              approvedAnomaliesToday > 0 &&
              Number(todayActivity.rewarded_anomaly_count) === approvedAnomaliesToday,
            repeatable: true,
          },
        ],
      },
      weekly: {
        startDate: weekStart,
        endDate: weekEndDate,
        completedMissions: weeklyCompletedMissions,
        target: 5,
        completed: weeklyCompletedMissions >= 5,
        bonusCredits: WEEKLY_FIVE_MISSIONS_REWARD,
        bonusGranted: weeklyBonusGranted,
      },
      streak: {
        currentDays: currentStreakDays,
        requiredDays: 7,
        badgeCode: STREAK_SEVEN_BADGE,
        badgeEarned: badgeRows.some((badge) => badge.badge_code === STREAK_SEVEN_BADGE),
        badgeEarnedAt:
          badgeRows.find((badge) => badge.badge_code === STREAK_SEVEN_BADGE)?.earned_at ?? null,
        bonusCredits: streakBonusCredits,
        badges: badgeRows.map((badge) => ({
          code: badge.badge_code,
          earnedAt: badge.earned_at,
        })),
      },
    };
  }

  private async recordMissionContribution(
    userId: string,
    eventType: MissionEventType,
    sourceId: string,
  ): Promise<void> {
    const occurredAt = new Date();
    await this.dataSource.query(
      `INSERT INTO mission_contribution_events (user_id, event_type, source_id, occurred_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, event_type, source_id) DO NOTHING`,
      [userId, eventType, sourceId, occurredAt],
    );

    await this.processMissionRewards(userId, eventType, sourceId, occurredAt);
  }

  private async processMissionRewards(
    userId: string,
    eventType: MissionEventType,
    sourceId: string,
    occurredAt: Date,
  ): Promise<void> {
    const timeZone = this.getMissionTimeZone();
    const contributionDate = this.dateInTimeZone(occurredAt, timeZone);
    const dayPeriod = this.getPeriod(contributionDate, 1, timeZone);
    const dayRows = await this.getMissionActivityDays(userId, dayPeriod, timeZone);
    const verifiedSignCount = Number(dayRows[0]?.verified_sign_count ?? 0);

    if (verifiedSignCount >= 3) {
      await this.walletService.creditUser(
        userId,
        VERIFY_THREE_SIGNS_REWARD,
        TransactionType.MISSION_REWARD,
        'daily_mission',
        sourceId,
        'Daily mission reward: verified 3 eligible traffic signs',
        {
          idempotencyKey: this.dailySignRewardKey(userId, contributionDate),
          metadata: { missionCode: 'VERIFY_3_SIGNS', contributionDate, timeZone },
        },
      );
    }

    if (eventType === 'APPROVED_ANOMALY') {
      await this.walletService.creditUser(
        userId,
        APPROVED_ANOMALY_REWARD,
        TransactionType.MISSION_REWARD,
        'road_hazard_event',
        sourceId,
        'Approved anomaly report mission reward',
        {
          idempotencyKey: `mission:approved-anomaly:${sourceId}`,
          metadata: { missionCode: 'APPROVED_ANOMALY_REPORT', timeZone },
        },
      );
    }

    const weekStart = this.getWeekStart(contributionDate);
    const weekPeriod = this.getPeriod(weekStart, 7, timeZone);
    const weekRows = await this.getMissionActivityDays(userId, weekPeriod, timeZone);
    const completedMissions = weekRows.reduce(
      (total, row) =>
        total +
        (Number(row.verified_sign_count) >= 3 ? 1 : 0) +
        Number(row.approved_anomaly_count),
      0,
    );
    if (completedMissions >= 5) {
      await this.walletService.creditUser(
        userId,
        WEEKLY_FIVE_MISSIONS_REWARD,
        TransactionType.MISSION_REWARD,
        'weekly_mission',
        sourceId,
        'Weekly mission bonus: completed 5 eligible missions',
        {
          idempotencyKey: this.weeklyBonusKey(userId, weekStart),
          metadata: { missionCode: 'WEEKLY_FIVE_MISSIONS', weekStart, timeZone },
        },
      );
    }

    await this.processStreakReward(userId, sourceId, contributionDate, timeZone, occurredAt);
  }

  private async processStreakReward(
    userId: string,
    sourceId: string,
    contributionDate: string,
    timeZone: string,
    occurredAt: Date,
  ): Promise<void> {
    const dayPeriod = this.getPeriod(contributionDate, 1, timeZone);
    const dates = await this.getRecentContributionDates(userId, dayPeriod.end, timeZone);
    const streakDays = this.calculateStreakEnding(dates, contributionDate);
    if (streakDays < 7) return;

    await this.dataSource.query(
      `INSERT INTO user_badges (user_id, badge_code, earned_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, badge_code) DO NOTHING`,
      [userId, STREAK_SEVEN_BADGE, occurredAt],
    );

    const bonus = await this.getConfiguredStreakBonus();
    const streakStartDate = addCalendarDays(contributionDate, -(streakDays - 1));
    for (let milestone = 7; bonus > 0 && milestone <= streakDays; milestone += 7) {
      const idempotencyKey = `mission:streak-seven:${userId}:${streakStartDate}:${milestone}`;
      if (await this.hasReward(idempotencyKey)) continue;
      await this.walletService.creditUser(
        userId,
        bonus,
        TransactionType.MISSION_REWARD,
        'user_badge',
        sourceId,
        'Seven-day contribution streak bonus',
        {
          idempotencyKey,
          metadata: {
            badgeCode: STREAK_SEVEN_BADGE,
            streakStartDate,
            streakMilestoneDays: milestone,
            contributionDate,
            timeZone,
          },
        },
      );
    }
  }

  private async getMissionActivityDays(
    userId: string,
    period: MissionPeriod,
    timeZone: string,
  ): Promise<MissionActivityDay[]> {
    return this.dataSource.query(
      `SELECT to_char(occurred_at AT TIME ZONE $4, 'YYYY-MM-DD') AS contribution_day,
              COUNT(*) FILTER (WHERE event_type = 'VERIFIED_SIGN')::int AS verified_sign_count,
              COUNT(*) FILTER (WHERE event_type = 'APPROVED_ANOMALY')::int AS approved_anomaly_count,
              COUNT(*) FILTER (
                WHERE event_type = 'APPROVED_ANOMALY'
                  AND EXISTS (
                    SELECT 1
                    FROM credit_transactions ct
                    WHERE ct.idempotency_key = 'mission:approved-anomaly:' || mce.source_id::text
                  )
              )::int AS rewarded_anomaly_count
       FROM mission_contribution_events mce
       WHERE mce.user_id = $1
         AND mce.occurred_at >= $2
         AND mce.occurred_at < $3
       GROUP BY 1
       ORDER BY 1`,
      [userId, period.start, period.end, timeZone],
    );
  }

  private async getRecentContributionDates(
    userId: string,
    before: Date,
    timeZone: string,
  ): Promise<string[]> {
    const rows: Array<{ contribution_day: string }> = await this.dataSource.query(
      `SELECT DISTINCT to_char(occurred_at AT TIME ZONE $3, 'YYYY-MM-DD') AS contribution_day
       FROM mission_contribution_events
       WHERE user_id = $1
         AND occurred_at < $2
       ORDER BY contribution_day DESC`,
      [userId, before, timeZone],
    );
    return rows.map((row) => row.contribution_day);
  }

  private async getConfiguredStreakBonus(): Promise<number> {
    const rows: Array<{ value: string }> = await this.dataSource.query(
      'SELECT value FROM system_parameters WHERE key = $1',
      [STREAK_BONUS_PARAMETER],
    );
    if (!rows.length) {
      throw new Error(`Missing system parameter ${STREAK_BONUS_PARAMETER}`);
    }
    const bonus = Number(rows[0].value);
    if (!Number.isSafeInteger(bonus) || bonus < 0) {
      throw new Error(`${STREAK_BONUS_PARAMETER} must be a non-negative integer`);
    }
    return bonus;
  }

  private async hasReward(idempotencyKey: string): Promise<boolean> {
    const rows: Array<{ exists: boolean }> = await this.dataSource.query(
      'SELECT EXISTS (SELECT 1 FROM credit_transactions WHERE idempotency_key = $1) AS exists',
      [idempotencyKey],
    );
    return Boolean(rows[0]?.exists);
  }

  private getMissionTimeZone(): string {
    const timeZone = process.env.MISSIONS_TIME_ZONE || 'UTC';
    try {
      new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    } catch {
      throw new Error(`Invalid MISSIONS_TIME_ZONE: ${timeZone}`);
    }
    return timeZone;
  }

  private dateInTimeZone(date: Date, timeZone: string): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  private getPeriod(startDate: string, dayCount: number, timeZone: string): MissionPeriod {
    const endDateExclusive = addCalendarDays(startDate, dayCount);
    return {
      startDate,
      endDateExclusive,
      start: this.zonedMidnight(startDate, timeZone),
      end: this.zonedMidnight(endDateExclusive, timeZone),
    };
  }

  private zonedMidnight(date: string, timeZone: string): Date {
    const [year, month, day] = date.split('-').map(Number);
    const desiredUtc = Date.UTC(year, month - 1, day);
    let timestamp = desiredUtc;
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const values = Object.fromEntries(
        formatter.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]),
      );
      const representedUtc = Date.UTC(
        Number(values.year),
        Number(values.month) - 1,
        Number(values.day),
        Number(values.hour),
        Number(values.minute),
        Number(values.second),
      );
      timestamp += desiredUtc - representedUtc;
    }
    return new Date(timestamp);
  }

  private getWeekStart(date: string): string {
    const [year, month, day] = date.split('-').map(Number);
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    return addCalendarDays(date, -((weekday + 6) % 7));
  }

  private dailySignRewardKey(userId: string, date: string): string {
    return `mission:verify-three:${userId}:${date}`;
  }

  private weeklyBonusKey(userId: string, weekStart: string): string {
    return `mission:weekly-five:${userId}:${weekStart}`;
  }

  private calculateStreakEnding(dates: string[], endDate: string): number {
    const dateSet = new Set(dates);
    let streakDays = 0;
    for (let offset = 0; offset < 7; offset += 1) {
      if (!dateSet.has(addCalendarDays(endDate, -offset))) return streakDays;
      streakDays += 1;
    }
    for (let offset = 7; dateSet.has(addCalendarDays(endDate, -offset)); offset += 1) {
      streakDays += 1;
    }
    return streakDays;
  }

  private calculateCurrentStreak(dates: string[], today: string): number {
    if (!dates.length) return 0;
    const anchor = dates[0] === today || dates[0] === addCalendarDays(today, -1) ? dates[0] : null;
    if (!anchor) return 0;

    let streak = 1;
    let expectedDate = addCalendarDays(anchor, -1);
    for (const date of dates.slice(1)) {
      if (date !== expectedDate) break;
      streak += 1;
      expectedDate = addCalendarDays(expectedDate, -1);
    }
    return streak;
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
