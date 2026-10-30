import { DataSource } from 'typeorm';
import { LeaderboardService } from './leaderboard.service';

describe('LeaderboardService (Phase 4 Materialized Leaderboard View)', () => {
  let service: LeaderboardService;
  let dataSource: any;

  beforeEach(() => {
    dataSource = {
      query: jest.fn(),
    };
    service = new LeaderboardService(dataSource as unknown as DataSource);
  });

  it('queries mv_community_leaderboard with pagination', async () => {
    const mockRows = [
      {
        user_id: 'user-1',
        full_name: 'Top Reviewer',
        reliability_score: 98.5,
        composite_score: 95.2,
        rank: 1,
      },
      {
        user_id: 'user-2',
        full_name: 'Second Contributor',
        reliability_score: 91.0,
        composite_score: 88.0,
        rank: 2,
      },
    ];
    dataSource.query.mockResolvedValue(mockRows);

    const result = await service.getLeaderboard(1, 10);
    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(10);
    expect(result.cached).toBe(false);
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT * FROM mv_community_leaderboard'),
    );
  });

  it('serves second call from in-memory cache', async () => {
    const mockRows = [{ user_id: 'u-1', rank: 1 }];
    dataSource.query.mockResolvedValue(mockRows);

    const first = await service.getLeaderboard(1, 20);
    expect(first.cached).toBe(false);

    const second = await service.getLeaderboard(1, 20);
    expect(second.cached).toBe(true);
    expect(dataSource.query).toHaveBeenCalledTimes(1);
  });

  it('falls back to live calculation if materialized view query fails', async () => {
    dataSource.query
      .mockRejectedValueOnce(new Error('relation mv_community_leaderboard does not exist'))
      .mockResolvedValueOnce([
        {
          user_id: 'u-fallback',
          full_name: 'Fallback User',
          reliability_score: 85.0,
        },
      ]);

    const result = await service.getLeaderboard(1, 20);
    expect(result.items).toHaveLength(1);
    expect(result.fallback).toBe(true);
    expect(dataSource.query).toHaveBeenCalledTimes(2);
  });

  it('refreshes materialized view via refresh_community_leaderboard function', async () => {
    dataSource.query.mockResolvedValue(undefined);

    const result = await service.refreshMaterializedView();
    expect(result.refreshed).toBe(true);
    expect(dataSource.query).toHaveBeenCalledWith('SELECT refresh_community_leaderboard()');
  });

  it('falls back to REFRESH MATERIALIZED VIEW CONCURRENTLY if function fails', async () => {
    dataSource.query
      .mockRejectedValueOnce(new Error('function does not exist'))
      .mockResolvedValueOnce(undefined);

    const result = await service.refreshMaterializedView();
    expect(result.refreshed).toBe(true);
    expect(dataSource.query).toHaveBeenCalledWith(
      'REFRESH MATERIALIZED VIEW CONCURRENTLY mv_community_leaderboard',
    );
  });
});
