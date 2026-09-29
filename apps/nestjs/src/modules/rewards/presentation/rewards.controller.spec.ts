import { RewardsController } from './rewards.controller';
import { RewardEngineService } from '../application/reward-engine.service';
import { CreateRewardRuleDto, UpdateRewardRuleDto } from './dto/reward-rule.dto';

describe('RewardsController (Phase 2 Admin Reward Rules)', () => {
  let controller: RewardsController;
  let service: jest.Mocked<RewardEngineService>;

  beforeEach(() => {
    service = {
      listRules: jest.fn(),
      getRule: jest.fn(),
      createRule: jest.fn(),
      updateRule: jest.fn(),
      toggleRule: jest.fn(),
    } as unknown as jest.Mocked<RewardEngineService>;

    controller = new RewardsController(service);
  });

  it('guarantees ADMIN role restriction at controller level', () => {
    const roles = Reflect.getMetadata('roles', RewardsController);
    expect(roles).toEqual(['ADMIN']);
  });

  it('listRules delegates to rewardEngine.listRules', async () => {
    const expected = [{ id: 1, activityType: 'SURVEY_REWARD' }];
    service.listRules.mockResolvedValue(expected as any);

    const result = await controller.listRules();
    expect(service.listRules).toHaveBeenCalled();
    expect(result).toBe(expected);
  });

  it('getRule delegates to rewardEngine.getRule', async () => {
    const expected = { id: 1, activityType: 'SURVEY_REWARD' };
    service.getRule.mockResolvedValue(expected as any);

    const result = await controller.getRule(1);
    expect(service.getRule).toHaveBeenCalledWith(1);
    expect(result).toBe(expected);
  });

  it('createRule delegates to rewardEngine.createRule', async () => {
    const dto: CreateRewardRuleDto = {
      activityType: 'HAZARD_REPORT_REWARD',
      baseAmount: 15,
      dailyLimit: 10,
    };
    const expected = { id: 2, ...dto };
    service.createRule.mockResolvedValue(expected as any);

    const result = await controller.createRule(dto);
    expect(service.createRule).toHaveBeenCalledWith(dto);
    expect(result).toBe(expected);
  });

  it('updateRule delegates to rewardEngine.updateRule', async () => {
    const dto: UpdateRewardRuleDto = {
      baseAmount: 20,
    };
    const expected = { id: 1, activityType: 'SURVEY_REWARD', baseAmount: 20 };
    service.updateRule.mockResolvedValue(expected as any);

    const result = await controller.updateRule(1, dto);
    expect(service.updateRule).toHaveBeenCalledWith(1, dto);
    expect(result).toBe(expected);
  });

  it('toggleRule delegates to rewardEngine.toggleRule', async () => {
    const expected = { id: 1, isActive: false };
    service.toggleRule.mockResolvedValue(expected as any);

    const result = await controller.toggleRule(1);
    expect(service.toggleRule).toHaveBeenCalledWith(1);
    expect(result).toBe(expected);
  });
});
