import { BountyBoardController } from './bounty-board.controller';
import { BountyBoardService } from '../application/bounty-board.service';
import {
  QuestClaimStatus,
  QuestTargetType,
} from '../infrastructure/persistence/reviewer-quest-claim.entity';

describe('BountyBoardController', () => {
  let controller: BountyBoardController;
  let service: {
    getAvailableQuests: jest.Mock;
    getMyClaims: jest.Mock;
    claimQuest: jest.Mock;
    abandonQuest: jest.Mock;
    expireStaleClaims: jest.Mock;
  };

  const mockUser = { id: 'reviewer-1', email: 'reviewer@stm.dev' };

  beforeEach(() => {
    service = {
      getAvailableQuests: jest.fn(),
      getMyClaims: jest.fn(),
      claimQuest: jest.fn(),
      abandonQuest: jest.fn(),
      expireStaleClaims: jest.fn(),
    };
    controller = new BountyBoardController(service as unknown as BountyBoardService);
  });

  it('getMyClaims forwards user ID and optional query parameters to service', async () => {
    const mockClaims = [{ id: 'claim-1', title: 'Verify P.102', totalRewardCredits: 25 }];
    service.getMyClaims.mockResolvedValue(mockClaims);

    const query = {
      status: QuestClaimStatus.CLAIMED,
      targetType: QuestTargetType.CANDIDATE_VALIDATION,
      latitude: 10.7769,
      longitude: 106.7009,
    };

    const result = await controller.getMyClaims(mockUser, query);

    expect(result).toEqual(mockClaims);
    expect(service.getMyClaims).toHaveBeenCalledWith('reviewer-1', query);
  });
});
