import { DailyTasksService } from './daily-tasks.service';
import { TransactionType } from '../wallet/infrastructure/persistence/credit-transaction.entity';

describe('DailyTasksService missions', () => {
  let service: DailyTasksService;
  let events: Array<{ userId: string; eventType: string; sourceId: string; occurredAt: Date }>;
  let badges: Map<string, Date>;
  let creditedTransactions: Map<string, { amount: number; userId: string }>;
  let walletService: any;
  let dataSource: any;
  const originalTimeZone = process.env.MISSIONS_TIME_ZONE;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-28T12:00:00.000Z'));
    process.env.MISSIONS_TIME_ZONE = 'UTC';
    events = [];
    badges = new Map();
    creditedTransactions = new Map();
    walletService = {
      creditUser: jest.fn(async (userId: string, amount: number, _type: string, _refType: string, _refId: string, _description: string, options?: { idempotencyKey?: string }) => {
        const key = options?.idempotencyKey ?? `unkeyed:${creditedTransactions.size}`;
        if (!creditedTransactions.has(key)) creditedTransactions.set(key, { userId, amount });
        return { walletId: 'wallet-1', newBalance: 100, txId: `tx-${key}` };
      }),
    };

    dataSource = {
      query: jest.fn(async (sql: string, params: any[] = []) => {
        if (sql.includes('INSERT INTO mission_contribution_events')) {
          const [userId, eventType, sourceId, occurredAt] = params;
          if (!events.some((event) => event.userId === userId && event.eventType === eventType && event.sourceId === sourceId)) {
            events.push({ userId, eventType, sourceId, occurredAt: new Date(occurredAt) });
          }
          return [];
        }

        if (sql.includes('INSERT INTO user_badges')) {
          badges.set(`${params[0]}:${params[1]}`, new Date(params[2]));
          return [];
        }

        if (sql.includes('FROM system_parameters')) return [{ value: '7' }];

        if (sql.includes('SELECT EXISTS (SELECT 1 FROM credit_transactions')) {
          return [{ exists: creditedTransactions.has(params[0]) }];
        }

        if (sql.includes('SELECT badge_code, earned_at')) {
          return [...badges.entries()]
            .filter(([key]) => key.startsWith(`${params[0]}:`))
            .map(([key, earned_at]) => ({ badge_code: key.split(':')[1], earned_at }));
        }

        if (sql.includes('SELECT DISTINCT to_char')) {
          const [userId, before, , from] = params;
          const dates = new Set(
            events
              .filter(
                (event) =>
                  event.userId === userId &&
                  event.occurredAt < new Date(before) &&
                  (!from || event.occurredAt >= new Date(from)),
              )
              .map((event) => event.occurredAt.toISOString().slice(0, 10)),
          );
          return [...dates].sort((a, b) => b.localeCompare(a)).map((contribution_day) => ({ contribution_day }));
        }

        if (sql.includes('FROM mission_contribution_events')) {
          const [userId, start, end] = params;
          const grouped = new Map<string, { verified_sign_count: number; approved_anomaly_count: number; rewarded_anomaly_count: number }>();
          for (const event of events) {
            if (event.userId !== userId || event.occurredAt < new Date(start) || event.occurredAt >= new Date(end)) continue;
            const contribution_day = event.occurredAt.toISOString().slice(0, 10);
            const row = grouped.get(contribution_day) ?? {
              verified_sign_count: 0,
              approved_anomaly_count: 0,
              rewarded_anomaly_count: 0,
            };
            if (event.eventType === 'VERIFIED_SIGN') row.verified_sign_count += 1;
            if (event.eventType === 'APPROVED_ANOMALY') {
              row.approved_anomaly_count += 1;
              if (creditedTransactions.has(`mission:approved-anomaly:${event.sourceId}`)) {
                row.rewarded_anomaly_count += 1;
              }
            }
            grouped.set(contribution_day, row);
          }
          return [...grouped.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([contribution_day, values]) => ({ contribution_day, ...values }));
        }

        throw new Error(`Unexpected mission test query: ${sql}`);
      }),
    };

    service = new DailyTasksService(
      { find: jest.fn(), findOne: jest.fn() } as any,
      { find: jest.fn(), findOne: jest.fn(), create: jest.fn(), save: jest.fn() } as any,
      walletService,
      {} as any,
      {} as any,
      dataSource,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    if (originalTimeZone === undefined) delete process.env.MISSIONS_TIME_ZONE;
    else process.env.MISSIONS_TIME_ZONE = originalTimeZone;
  });

  it('grants +15 once after three distinct eligible verified signs, including concurrent event processing', async () => {
    await Promise.all([
      service.recordVerifiedSign('user-1', 'candidate-1'),
      service.recordVerifiedSign('user-1', 'candidate-2'),
      service.recordVerifiedSign('user-1', 'candidate-3'),
      service.recordVerifiedSign('user-1', 'candidate-4'),
    ]);

    const dailyRewards = [...creditedTransactions.entries()].filter(([key, tx]) =>
      key.startsWith('mission:verify-three:user-1:') && tx.amount === 15,
    );
    expect(dailyRewards).toHaveLength(1);
    expect(walletService.creditUser).toHaveBeenCalledWith(
      'user-1',
      15,
      TransactionType.MISSION_REWARD,
      'daily_mission',
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ idempotencyKey: 'mission:verify-three:user-1:2026-09-28' }),
    );

    await service.recordVerifiedSign('user-1', 'candidate-4');
    expect([...creditedTransactions.keys()].filter((key) => key.startsWith('mission:verify-three:'))).toHaveLength(1);
  });

  it('grants +20 only from the approved-anomaly domain hook and deduplicates a replay', async () => {
    await service.recordApprovedAnomaly('user-1', 'hazard-1');
    await service.recordApprovedAnomaly('user-1', 'hazard-1');

    expect(creditedTransactions.get('mission:approved-anomaly:hazard-1')).toEqual({
      userId: 'user-1',
      amount: 20,
    });
    expect(events).toHaveLength(1);
  });

  it('grants the +50 weekly bonus after five eligible mission completions only once', async () => {
    for (let index = 1; index <= 5; index += 1) {
      await service.recordApprovedAnomaly('user-1', `hazard-${index}`);
    }

    expect(creditedTransactions.get('mission:weekly-five:user-1:2026-09-28')).toEqual({
      userId: 'user-1',
      amount: 50,
    });
    await service.recordApprovedAnomaly('user-1', 'hazard-5');
    expect([...creditedTransactions.entries()].filter(([key, tx]) => key.startsWith('mission:weekly-five:') && tx.amount === 50)).toHaveLength(1);
  });

  it('awards the badge once and the configured bonus once per seven-day streak milestone', async () => {
    for (let offset = 13; offset >= 0; offset -= 1) {
      const day = new Date(Date.UTC(2026, 8, 28 - offset, 12));
      jest.setSystemTime(day);
      await service.recordApprovedAnomaly('user-1', `hazard-day-${day.toISOString().slice(0, 10)}`);
    }

    expect(badges.has('user-1:CONTRIBUTION_STREAK_7')).toBe(true);
    expect(creditedTransactions.get('mission:streak-seven:user-1:2026-09-15:7')).toEqual({
      userId: 'user-1',
      amount: 7,
    });
    expect(creditedTransactions.get('mission:streak-seven:user-1:2026-09-15:14')).toEqual({
      userId: 'user-1',
      amount: 7,
    });
    await service.recordApprovedAnomaly('user-1', 'hazard-day-2026-09-28');
    for (let offset = 0; offset < 7; offset += 1) {
      const day = new Date(Date.UTC(2026, 9, 1 + offset, 12));
      jest.setSystemTime(day);
      await service.recordApprovedAnomaly('user-1', `new-streak-${day.toISOString().slice(0, 10)}`);
    }
    expect([...creditedTransactions.keys()].filter((key) => key.startsWith('mission:streak-seven:user-1:'))).toHaveLength(3);
    expect(badges.size).toBe(1);
  });

  it('counts multiple actions on one calendar day as one streak day', async () => {
    await Promise.all([
      service.recordVerifiedSign('user-1', 'candidate-1'),
      service.recordVerifiedSign('user-1', 'candidate-2'),
      service.recordVerifiedSign('user-1', 'candidate-3'),
    ]);

    const overview = await service.getMissionOverview('user-1');
    expect(overview.streak.currentDays).toBe(1);
    expect(overview.daily.missions[0].completed).toBe(true);
  });

  it('scopes mission progress queries to the authenticated user ID supplied by the controller', async () => {
    await service.recordVerifiedSign('user-1', 'candidate-1');
    await service.recordVerifiedSign('user-2', 'candidate-2');

    const queryOffset = dataSource.query.mock.calls.length;
    const overview = await service.getMissionOverview('user-1');

    expect(overview.daily.missions[0].progress).toBe(1);
    const progressQueries = dataSource.query.mock.calls.slice(queryOffset).filter(([sql]: [string]) =>
      sql.includes('FROM mission_contribution_events'),
    );
    expect(progressQueries.every(([, params]: [string, any[]]) => params[0] === 'user-1')).toBe(true);
  });

  it('uses UTC calendar dates and resets the weekly count on Monday', async () => {
    jest.setSystemTime(new Date('2026-09-27T23:59:59.000Z'));
    for (let index = 0; index < 3; index += 1) {
      await service.recordVerifiedSign('user-1', `sunday-candidate-${index}`);
    }

    jest.setSystemTime(new Date('2026-09-28T00:00:00.000Z'));
    for (let index = 0; index < 4; index += 1) {
      await service.recordApprovedAnomaly('user-1', `monday-hazard-${index}`);
    }

    const overview = await service.getMissionOverview('user-1');
    expect(overview.daily.date).toBe('2026-09-28');
    expect(overview.weekly.startDate).toBe('2026-09-28');
    expect(overview.weekly.completedMissions).toBe(4);
    expect(overview.weekly.bonusGranted).toBe(false);
  });
});
