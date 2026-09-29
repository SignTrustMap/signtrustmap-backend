import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { RewardRule } from '../infrastructure/persistence/reward-rule.entity';
import { CreateRewardRuleDto, UpdateRewardRuleDto } from '../presentation/dto/reward-rule.dto';
import { TransactionType } from '../../wallet/infrastructure/persistence/credit-transaction.entity';

export interface RewardEvaluationResult {
  eligible: boolean;
  amount: number;
  baseAmount: number;
  dailyLimit: number;
  currentDailyCount: number;
  reason?: string;
  multiplierConfig?: Record<string, any>;
}

@Injectable()
export class RewardEngineService {
  private readonly logger = new Logger(RewardEngineService.name);

  constructor(
    @InjectRepository(RewardRule)
    private readonly ruleRepo: Repository<RewardRule>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Evaluates dynamic reward eligibility and calculates total payout
   * based on base rate, daily limits, and dynamic multipliers.
   */
  async calculateReward(
    userId: string,
    activityType: TransactionType | string,
    context?: { reliabilityScore?: number; candidateCount?: number; baseFallback?: number },
  ): Promise<RewardEvaluationResult> {
    const now = new Date();

    // 1. Resolve matching active reward rule
    const rule = await this.ruleRepo.findOne({
      where: {
        activityType: String(activityType),
        isActive: true,
      },
      order: { effectiveFrom: 'DESC' },
    });

    if (!rule) {
      // Fallback check against credit_rules table if present
      let fallbackAmount = context?.baseFallback ?? 10;
      try {
        const rows: any[] = await this.dataSource.query(
          `SELECT reward_amount FROM credit_rules WHERE transaction_type=$1 AND is_active=true LIMIT 1`,
          [activityType],
        );
        if (rows.length && Number.isFinite(Number(rows[0].reward_amount))) {
          fallbackAmount = Number(rows[0].reward_amount);
        }
      } catch {}

      return {
        eligible: true,
        amount: fallbackAmount,
        baseAmount: fallbackAmount,
        dailyLimit: 999,
        currentDailyCount: 0,
      };
    }

    // Check effective date boundaries
    if (rule.effectiveFrom && new Date(rule.effectiveFrom) > now) {
      return {
        eligible: false,
        amount: 0,
        baseAmount: rule.baseAmount,
        dailyLimit: rule.dailyLimit,
        currentDailyCount: 0,
        reason: 'RULE_NOT_YET_EFFECTIVE',
      };
    }
    if (rule.effectiveTo && new Date(rule.effectiveTo) < now) {
      return {
        eligible: false,
        amount: 0,
        baseAmount: rule.baseAmount,
        dailyLimit: rule.dailyLimit,
        currentDailyCount: 0,
        reason: 'RULE_EXPIRED',
      };
    }

    // 2. Check daily contribution frequency limit
    const startOfUtcDay = new Date();
    startOfUtcDay.setUTCHours(0, 0, 0, 0);

    const countRows: any[] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS cnt
       FROM credit_transactions ct
       JOIN wallets w ON w.id = ct.wallet_id
       WHERE w.user_id = $1
         AND ct.transaction_type = $2
         AND ct.created_at >= $3`,
      [userId, activityType, startOfUtcDay],
    );
    const todayCount = countRows[0]?.cnt ?? 0;

    if (todayCount >= rule.dailyLimit) {
      return {
        eligible: false,
        amount: 0,
        baseAmount: rule.baseAmount,
        dailyLimit: rule.dailyLimit,
        currentDailyCount: todayCount,
        reason: 'DAILY_LIMIT_REACHED',
      };
    }

    // 3. Compute dynamic multiplier hooks
    let calculatedAmount = rule.baseAmount;
    const config = rule.multiplierConfig || {};

    // Reputation bonus: Reviewer reliability scaling
    // ReviewReward = BaseReward * (0.5 + 0.5 * (Reliability / 100))
    if (config.reputation_bonus && context?.reliabilityScore !== undefined) {
      const rel = Math.max(0, Math.min(100, Number(context.reliabilityScore)));
      const multiplier = 0.5 + 0.5 * (rel / 100);
      calculatedAmount = Math.floor(rule.baseAmount * multiplier);
    }

    // Candidate multiplier: bonus per valid extracted candidate
    if (config.candidate_multiplier && context?.candidateCount !== undefined) {
      const bonusPerCandidate = Number(config.bonus_per_candidate ?? 5);
      calculatedAmount = rule.baseAmount + Math.max(0, context.candidateCount * bonusPerCandidate);
    }

    return {
      eligible: true,
      amount: Math.max(1, calculatedAmount),
      baseAmount: rule.baseAmount,
      dailyLimit: rule.dailyLimit,
      currentDailyCount: todayCount,
      multiplierConfig: config,
    };
  }

  // ── Admin rule management ──

  async listRules(): Promise<RewardRule[]> {
    return this.ruleRepo.find({ order: { id: 'ASC' } });
  }

  async getRule(id: number): Promise<RewardRule> {
    const rule = await this.ruleRepo.findOne({ where: { id } });
    if (!rule) throw new NotFoundException(`Reward rule #${id} not found`);
    return rule;
  }

  async createRule(dto: CreateRewardRuleDto): Promise<RewardRule> {
    const existing = await this.ruleRepo.findOne({ where: { activityType: dto.activityType } });
    if (existing) {
      throw new ConflictException(`Reward rule for activity '${dto.activityType}' already exists (ID #${existing.id})`);
    }

    const rule = this.ruleRepo.create({
      activityType: dto.activityType,
      baseAmount: dto.baseAmount,
      dailyLimit: dto.dailyLimit,
      multiplierConfig: dto.multiplierConfig ?? {},
      isActive: dto.isActive ?? true,
      effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date(),
      effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
    });
    return this.ruleRepo.save(rule);
  }

  async updateRule(id: number, dto: UpdateRewardRuleDto): Promise<RewardRule> {
    const rule = await this.getRule(id);
    if (dto.baseAmount !== undefined) rule.baseAmount = dto.baseAmount;
    if (dto.dailyLimit !== undefined) rule.dailyLimit = dto.dailyLimit;
    if (dto.multiplierConfig !== undefined) rule.multiplierConfig = dto.multiplierConfig;
    if (dto.isActive !== undefined) rule.isActive = dto.isActive;
    if (dto.effectiveFrom !== undefined) rule.effectiveFrom = new Date(dto.effectiveFrom);
    if (dto.effectiveTo !== undefined) rule.effectiveTo = dto.effectiveTo ? new Date(dto.effectiveTo) : null;
    return this.ruleRepo.save(rule);
  }

  async toggleRule(id: number): Promise<RewardRule> {
    const rule = await this.getRule(id);
    rule.isActive = !rule.isActive;
    return this.ruleRepo.save(rule);
  }
}
