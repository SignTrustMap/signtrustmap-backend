import { LeaderboardController } from './leaderboard.controller';
import { LeaderboardService } from './leaderboard.service';

describe('LeaderboardController', () => {
  let controller: LeaderboardController;
  let service: any;

  beforeEach(() => {
    service = {
      getLeaderboard: jest.fn().mockResolvedValue({
        items: [{ user_id: 'u-1', rank: 1 }],
        total: 1,
        page: 1,
        pageSize: 20,
      }),
      refreshMaterializedView: jest.fn().mockResolvedValue({ refreshed: true }),
    };
    controller = new LeaderboardController(service as unknown as LeaderboardService);
  });

  it('delegates getLeaderboard with parsed page and pageSize', async () => {
    const res = await controller.getLeaderboard('2', '15');
    expect(service.getLeaderboard).toHaveBeenCalledWith(2, 15);
    expect(res.total).toBe(1);
  });

  it('uses default pagination if invalid query params', async () => {
    await controller.getLeaderboard('invalid', 'NaN');
    expect(service.getLeaderboard).toHaveBeenCalledWith(1, 20);
  });

  it('delegates refresh to service', async () => {
    const res = await controller.refresh();
    expect(service.refreshMaterializedView).toHaveBeenCalled();
    expect(res.refreshed).toBe(true);
  });
});
