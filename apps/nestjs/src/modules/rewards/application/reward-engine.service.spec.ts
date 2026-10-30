import { ConflictException, NotFoundException } from '@nestjs/common';
import { RewardEngineService } from './reward-engine.service';
import { RewardRule } from '../infrastructure/persistence/reward-rule.entity';
import { TransactionType } from '../../wallet/infrastructure/persistence/credit-transaction.entity';

describe('RewardEngineService (Phase 2 Dynamic Rewards)', () => {
  let service: RewardEngineService;
  let ruleRepo: any;
  let dataSource: any;

  beforeEach(() => {
    ruleRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((dto: any) => ({ id: 1, ...dto }) as RewardRule),
      save: jest.fn(async (r: any) => r),
    };

    dataSource = {
      query: jest.fn().mockResolvedValue([]),
    };

    service = new RewardEngineService(ruleRepo, dataSource);
  });

  describe('calculateReward', () => {
    it('should fallback to default base amount if no active rule or credit_rule exists', async () => {
      ruleRepo.findOne.mockResolvedValue(null);
      dataSource.query.mockResolvedValue([]);

      const result = await service.calculateReward('user-1', TransactionType.SURVEY_REWARD);

      expect(result.eligible).toBe(true);
      expect(result.amount).toBe(10);
      expect(result.baseAmount).toBe(10);
      expect(result.dailyLimit).toBe(999);
      expect(result.currentDailyCount).toBe(0);
    });

    it('should fallback to credit_rules table value when ruleRepo has no match', async () => {
      ruleRepo.findOne.mockResolvedValue(null);
      dataSource.query.mockResolvedValue([{ reward_amount: 15 }]);

      const result = await service.calculateReward('user-1', TransactionType.SURVEY_REWARD);

      expect(result.eligible).toBe(true);
      expect(result.amount).toBe(15);
      expect(result.baseAmount).toBe(15);
    });

    it('should reject calculation if rule effectiveFrom is in the future', async () => {
      const futureDate = new Date(Date.now() + 86400000);
      ruleRepo.findOne.mockResolvedValue({
        id: 1,
        activityType: 'SURVEY_REWARD',
        baseAmount: 20,
        dailyLimit: 5,
        isActive: true,
        effectiveFrom: futureDate,
        effectiveTo: null,
      });

      const result = await service.calculateReward('user-1', TransactionType.SURVEY_REWARD);

      expect(result.eligible).toBe(false);
      expect(result.amount).toBe(0);
      expect(result.reason).toBe('RULE_NOT_YET_EFFECTIVE');
    });

    it('should reject calculation if rule effectiveTo has already passed', async () => {
      const pastDate = new Date(Date.now() - 86400000);
      ruleRepo.findOne.mockResolvedValue({
        id: 1,
        activityType: 'SURVEY_REWARD',
        baseAmount: 20,
        dailyLimit: 5,
        isActive: true,
        effectiveFrom: new Date(Date.now() - 172800000),
        effectiveTo: pastDate,
      });

      const result = await service.calculateReward('user-1', TransactionType.SURVEY_REWARD);

      expect(result.eligible).toBe(false);
      expect(result.amount).toBe(0);
      expect(result.reason).toBe('RULE_EXPIRED');
    });

    it('should reject calculation if daily contribution limit has been reached', async () => {
      ruleRepo.findOne.mockResolvedValue({
        id: 1,
        activityType: 'SURVEY_REWARD',
        baseAmount: 20,
        dailyLimit: 5,
        isActive: true,
        effectiveFrom: new Date(Date.now() - 86400000),
        effectiveTo: null,
      });
      dataSource.query.mockResolvedValue([{ cnt: 5 }]);

      const result = await service.calculateReward('user-1', TransactionType.SURVEY_REWARD);

      expect(result.eligible).toBe(false);
      expect(result.amount).toBe(0);
      expect(result.currentDailyCount).toBe(5);
      expect(result.reason).toBe('DAILY_LIMIT_REACHED');
    });

    it('should calculate base reward when within daily limit and no multipliers', async () => {
      ruleRepo.findOne.mockResolvedValue({
        id: 1,
        activityType: 'SURVEY_REWARD',
        baseAmount: 20,
        dailyLimit: 10,
        isActive: true,
        effectiveFrom: new Date(Date.now() - 86400000),
        effectiveTo: null,
        multiplierConfig: {},
      });
      dataSource.query.mockResolvedValue([{ cnt: 2 }]);

      const result = await service.calculateReward('user-1', TransactionType.SURVEY_REWARD);

      expect(result.eligible).toBe(true);
      expect(result.amount).toBe(20);
      expect(result.currentDailyCount).toBe(2);
    });

    it('should scale review reward with reputation bonus multiplier', async () => {
      ruleRepo.findOne.mockResolvedValue({
        id: 2,
        activityType: 'REVIEW_REWARD',
        baseAmount: 10,
        dailyLimit: 50,
        isActive: true,
        effectiveFrom: new Date(Date.now() - 86400000),
        effectiveTo: null,
        multiplierConfig: { reputation_bonus: true },
      });
      dataSource.query.mockResolvedValue([{ cnt: 1 }]);

      // Reliability = 100%: 10 * (0.5 + 0.5 * 1.0) = 10
      const res100 = await service.calculateReward('user-1', TransactionType.REVIEW_REWARD, {
        reliabilityScore: 100,
      });
      expect(res100.amount).toBe(10);

      // Reliability = 50%: 10 * (0.5 + 0.5 * 0.5) = 10 * 0.75 = 7
      const res50 = await service.calculateReward('user-1', TransactionType.REVIEW_REWARD, {
        reliabilityScore: 50,
      });
      expect(res50.amount).toBe(7);

      // Reliability = 0%: 10 * (0.5 + 0.5 * 0.0) = 5
      const res0 = await service.calculateReward('user-1', TransactionType.REVIEW_REWARD, {
        reliabilityScore: 0,
      });
      expect(res0.amount).toBe(5);
    });

    it('should scale candidate multiplier bonus for batch extractions', async () => {
      ruleRepo.findOne.mockResolvedValue({
        id: 3,
        activityType: 'SURVEY_REWARD',
        baseAmount: 20,
        dailyLimit: 20,
        isActive: true,
        effectiveFrom: new Date(Date.now() - 86400000),
        effectiveTo: null,
        multiplierConfig: {
          candidate_multiplier: true,
          bonus_per_candidate: 5,
        },
      });
      dataSource.query.mockResolvedValue([{ cnt: 0 }]);

      const res = await service.calculateReward('user-1', TransactionType.SURVEY_REWARD, {
        candidateCount: 4,
      });

      // 20 base + 4 * 5 bonus = 40
      expect(res.eligible).toBe(true);
      expect(res.amount).toBe(40);
    });
  });

  describe('Admin Rule Management', () => {
    it('listRules returns rules sorted by id', async () => {
      ruleRepo.find.mockResolvedValue([{ id: 1 }, { id: 2 }]);
      const rules = await service.listRules();
      expect(rules).toHaveLength(2);
      expect(ruleRepo.find).toHaveBeenCalledWith({ order: { id: 'ASC' } });
    });

    it('getRule returns single rule or throws NotFoundException', async () => {
      ruleRepo.findOne.mockResolvedValue({ id: 1, activityType: 'SURVEY_REWARD' });
      const rule = await service.getRule(1);
      expect(rule.id).toBe(1);

      ruleRepo.findOne.mockResolvedValue(null);
      await expect(service.getRule(99)).rejects.toThrow(NotFoundException);
    });

    it('createRule throws ConflictException when rule already exists', async () => {
      ruleRepo.findOne.mockResolvedValue({ id: 1, activityType: 'SURVEY_REWARD' });
      await expect(
        service.createRule({
          activityType: 'SURVEY_REWARD',
          baseAmount: 10,
          dailyLimit: 10,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('createRule persists new rule successfully', async () => {
      ruleRepo.findOne.mockResolvedValue(null);
      const created = await service.createRule({
        activityType: 'HAZARD_REPORT_REWARD',
        baseAmount: 15,
        dailyLimit: 5,
      });
      expect(created.id).toBe(1);
      expect(ruleRepo.create).toHaveBeenCalled();
      expect(ruleRepo.save).toHaveBeenCalled();
    });

    it('updateRule updates specified properties', async () => {
      const mockRule = { id: 1, baseAmount: 10, dailyLimit: 5, isActive: true };
      ruleRepo.findOne.mockResolvedValue(mockRule);

      const updated = await service.updateRule(1, { baseAmount: 25, dailyLimit: 8 });
      expect(updated.baseAmount).toBe(25);
      expect(updated.dailyLimit).toBe(8);
      expect(ruleRepo.save).toHaveBeenCalled();
    });

    it('toggleRule flips the isActive flag', async () => {
      const mockRule = { id: 1, isActive: true };
      ruleRepo.findOne.mockResolvedValue(mockRule);

      const toggled = await service.toggleRule(1);
      expect(toggled.isActive).toBe(false);
      expect(ruleRepo.save).toHaveBeenCalled();
    });
  });
});
