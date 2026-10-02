import { BadRequestException } from '@nestjs/common';
import { Repository, DataSource } from 'typeorm';
import { HazardsService } from './hazards.service';
import { RoadHazardEvent, HazardStatus } from '../infrastructure/persistence/road-hazard-event.entity';
import { HazardConfirmation, HazardVoteType } from '../infrastructure/persistence/hazard-confirmation.entity';
import { WalletService } from '../../wallet/application/wallet.service';
import { TransactionType } from '../../wallet/infrastructure/persistence/credit-transaction.entity';
import { DailyTasksService } from '../../daily-tasks/daily-tasks.service';
import { NotificationsService } from '../../notifications/notifications.service';

describe('HazardsService', () => {
  let service: HazardsService;
  let hazardRepo: jest.Mocked<Repository<RoadHazardEvent>>;
  let confirmRepo: jest.Mocked<Repository<HazardConfirmation>>;
  let dataSource: jest.Mocked<DataSource>;
  let walletService: jest.Mocked<WalletService>;
  let dailyTasksService: jest.Mocked<DailyTasksService>;
  let notificationsService: jest.Mocked<NotificationsService>;
  let queryMock: jest.Mock;

  beforeEach(() => {
    queryMock = jest.fn();
    hazardRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
    } as any;
    confirmRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
    } as any;
    dataSource = {
      query: queryMock,
    } as any;
    walletService = {
      resolveRewardAmount: jest.fn().mockImplementation((type, def) => Promise.resolve(def)),
      creditUser: jest.fn().mockResolvedValue(undefined),
    } as any;
    dailyTasksService = {
      recordProgress: jest.fn().mockResolvedValue([]),
    } as any;
    notificationsService = {
      create: jest.fn().mockResolvedValue({} as any),
    } as any;

    service = new HazardsService(
      hazardRepo,
      confirmRepo,
      dataSource,
      walletService,
      dailyTasksService,
      notificationsService,
    );
  });

  describe('reportHazard (300m deduplication & creation)', () => {
    it('creates a new hazard event when none exists within 300m', async () => {
      queryMock.mockImplementation(async (sql: string, params?: any[]) => {
        const norm = sql.replace(/\s+/g, ' ');
        if (norm.includes('ST_DWithin')) {
          return [];
        }
        if (norm.includes('INSERT INTO road_hazard_events')) {
          return [];
        }
        if (norm.includes('INSERT INTO hazard_confirmations')) {
          return [];
        }
        if (norm.includes('FROM road_hazard_events WHERE id = $1')) {
          return [
            {
              id: params?.[0] ?? 'new-hazard-id',
              reported_by: 'user-1',
              hazard_type: 'SPEED_CHECK',
              description: 'Radar trap',
              status: HazardStatus.UNCONFIRMED,
              confirmations_count: 1,
              dismissals_count: 0,
              reward_paid: false,
              expires_at: new Date(Date.now() + 45 * 60 * 1000),
              created_at: new Date(),
              updated_at: new Date(),
              lat: 10.7769,
              lon: 106.7009,
            },
          ];
        }
        return [];
      });

      const result = await service.reportHazard('user-1', {
        hazardType: 'SPEED_CHECK',
        latitude: 10.7769,
        longitude: 106.7009,
        description: 'Radar trap',
      });

      expect(result).toBeDefined();
      expect(result.hazardType).toBe('SPEED_CHECK');
      expect(result.status).toBe(HazardStatus.UNCONFIRMED);
      expect(result.confirmationsCount).toBe(1);
      expect(dailyTasksService.recordProgress).toHaveBeenCalledWith('user-1', 'HAZARD', 1);
    });

    it('merges report into existing active event within 300m as implicit confirmation', async () => {
      const existingId = 'existing-hazard-id';
      const existingMatch = {
        id: existingId,
        reported_by: 'user-original',
        hazard_type: 'SPEED_CHECK',
        description: 'Near toll',
        status: HazardStatus.UNCONFIRMED,
        confirmations_count: 1,
        dismissals_count: 0,
        reward_paid: false,
        expires_at: new Date(Date.now() + 30 * 60 * 1000),
        created_at: new Date(),
        updated_at: new Date(),
        lat: 10.7765,
        lon: 106.7005,
        distance_meters: 65.4,
      };

      queryMock.mockImplementation(async (sql: string) => {
        const norm = sql.replace(/\s+/g, ' ');
        if (norm.includes('ST_DWithin')) {
          return [existingMatch];
        }
        if (norm.includes('INSERT INTO hazard_confirmations')) {
          return [];
        }
        if (norm.includes('UPDATE road_hazard_events')) {
          return [];
        }
        if (norm.includes('FROM road_hazard_events WHERE id = $1')) {
          return [{ ...existingMatch, confirmations_count: 2 }];
        }
        return [];
      });

      confirmRepo.findOne.mockResolvedValue(null);

      const result = await service.reportHazard('user-2', {
        hazardType: 'SPEED_CHECK',
        latitude: 10.7769,
        longitude: 106.7009,
      });

      expect(result.isMerged).toBe(true);
      expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE road_hazard_events'),
        [existingId],
      );
      expect(dailyTasksService.recordProgress).toHaveBeenCalledWith('user-2', 'HAZARD', 1);
    });

    it('prevents double voting if user reports again near an event they already confirmed', async () => {
      const existingId = 'existing-hazard-id';
      const existingMatch = {
        id: existingId,
        reported_by: 'user-1',
        hazard_type: 'POTHOLE',
        description: 'Deep hole',
        status: HazardStatus.UNCONFIRMED,
        confirmations_count: 1,
        dismissals_count: 0,
        reward_paid: false,
        expires_at: new Date(Date.now() + 30 * 60 * 1000),
        created_at: new Date(),
        updated_at: new Date(),
        lat: 10.7765,
        lon: 106.7005,
        distance_meters: 20.0,
      };

      queryMock.mockImplementation(async (sql: string) => {
        if (sql.includes('ST_DWithin')) {
          return [existingMatch];
        }
        return [];
      });

      confirmRepo.findOne.mockResolvedValue({ id: 'conf-1' } as any);

      const result = await service.reportHazard('user-1', {
        hazardType: 'POTHOLE',
        latitude: 10.7766,
        longitude: 106.7006,
      });

      expect(result.id).toBe(existingId);
      expect(result.isMerged).toBe(true);
      expect(queryMock).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE road_hazard_events'));
    });
  });

  describe('confirmHazard & consensus payouts', () => {
    it('throws BadRequestException if user has already voted on this hazard', async () => {
      queryMock.mockImplementation(async (sql: string) => {
        const norm = sql.replace(/\s+/g, ' ');
        if (norm.includes('FROM road_hazard_events WHERE id = $1')) {
          return [
            {
              id: 'hazard-1',
              status: HazardStatus.UNCONFIRMED,
              expires_at: new Date(Date.now() + 30 * 60 * 1000),
              created_at: new Date(),
              confirmations_count: 1,
              dismissals_count: 0,
              reward_paid: false,
            },
          ];
        }
        return [];
      });

      confirmRepo.findOne.mockResolvedValue({ id: 'existing-vote' } as any);

      await expect(
        service.confirmHazard('hazard-1', 'user-1', { voteType: HazardVoteType.CONFIRM }),
      ).rejects.toThrow(BadRequestException);
    });

    it('reaches consensus at K=3: transitions status to CONFIRMED and pays reporter and confirmers', async () => {
      const hazardRecord = {
        id: 'hazard-1',
        reported_by: 'reporter-user',
        hazard_type: 'ACCIDENT',
        status: HazardStatus.UNCONFIRMED,
        confirmations_count: 2,
        dismissals_count: 0,
        reward_paid: false,
        expires_at: new Date(Date.now() + 30 * 60 * 1000),
        created_at: new Date(),
        updated_at: new Date(),
        lat: 10.7769,
        lon: 106.7009,
      };

      queryMock.mockImplementation(async (sql: string) => {
        const norm = sql.replace(/\s+/g, ' ');
        if (norm.includes('INSERT INTO hazard_confirmations')) {
          return [];
        }
        if (norm.includes('UPDATE road_hazard_events')) {
          return [];
        }
        if (norm.includes('SELECT DISTINCT user_id FROM hazard_confirmations')) {
          return [{ user_id: 'confirmer-1' }, { user_id: 'confirmer-2' }];
        }
        if (norm.includes('FROM road_hazard_events WHERE id = $1')) {
          return [{ ...hazardRecord, status: HazardStatus.CONFIRMED, confirmations_count: 3, reward_paid: false }];
        }
        return [];
      });

      confirmRepo.findOne.mockResolvedValue(null);

      const result = await service.confirmHazard('hazard-1', 'confirmer-2', {
        voteType: HazardVoteType.CONFIRM,
        latitude: 10.7769,
        longitude: 106.7009,
      });

      expect(result.status).toBe(HazardStatus.CONFIRMED);
      expect(result.confirmationsCount).toBe(3);

      // Verify reporter payout
      expect(walletService.creditUser).toHaveBeenCalledWith(
        'reporter-user',
        10,
        TransactionType.HAZARD_REPORT_REWARD,
        'road_hazard_event',
        'hazard-1',
        expect.stringContaining('Roadside hazard verified by consensus'),
      );

      // Verify confirmers payout
      expect(walletService.creditUser).toHaveBeenCalledWith(
        'confirmer-1',
        2,
        TransactionType.HAZARD_CONFIRM_REWARD,
        'road_hazard_event',
        'hazard-1',
        expect.stringContaining('Roadside hazard confirmation bonus'),
      );
      expect(walletService.creditUser).toHaveBeenCalledWith(
        'confirmer-2',
        2,
        TransactionType.HAZARD_CONFIRM_REWARD,
        'road_hazard_event',
        'hazard-1',
        expect.stringContaining('Roadside hazard confirmation bonus'),
      );

      // Verify notification
      expect(notificationsService.create).toHaveBeenCalledWith(
        'reporter-user',
        'HAZARD_CONFIRMED',
        'Roadside Hazard Confirmed',
        expect.stringContaining('+10 credits'),
        'road_hazard_event',
        'hazard-1',
      );
    });

    it('transitions hazard to DISMISSED when dismissals exceed confirmations', async () => {
      const hazardRecord = {
        id: 'hazard-1',
        reported_by: 'reporter-user',
        hazard_type: 'SPEED_CHECK',
        status: HazardStatus.UNCONFIRMED,
        confirmations_count: 1,
        dismissals_count: 1,
        reward_paid: false,
        expires_at: new Date(Date.now() + 30 * 60 * 1000),
        created_at: new Date(),
        updated_at: new Date(),
        lat: 10.7769,
        lon: 106.7009,
      };

      let updateCalled = false;
      queryMock.mockImplementation(async (sql: string) => {
        const norm = sql.replace(/\s+/g, ' ');
        if (norm.includes('INSERT INTO hazard_confirmations')) {
          return [];
        }
        if (norm.includes('UPDATE road_hazard_events')) {
          updateCalled = true;
          return [];
        }
        if (norm.includes('FROM road_hazard_events WHERE id = $1')) {
          return [{
            ...hazardRecord,
            status: updateCalled ? HazardStatus.DISMISSED : HazardStatus.UNCONFIRMED,
            dismissals_count: updateCalled ? 2 : 1,
          }];
        }
        return [];
      });

      confirmRepo.findOne.mockResolvedValue(null);

      const result = await service.confirmHazard('hazard-1', 'dismiss-user', {
        voteType: HazardVoteType.DISMISS,
      });

      expect(result.status).toBe(HazardStatus.DISMISSED);
      expect(result.dismissalsCount).toBe(2);
    });
  });

  describe('listHazards', () => {
    it('queries active hazards with proximity coordinates and distance', async () => {
      queryMock.mockImplementation(async (sql: string) => {
        if (sql.includes('COUNT(*)')) {
          return [{ cnt: 1 }];
        }
        return [
          {
            id: 'hazard-1',
            reported_by: 'reporter-1',
            hazard_type: 'SPEED_CHECK',
            description: 'Radar',
            status: HazardStatus.CONFIRMED,
            confirmations_count: 3,
            dismissals_count: 0,
            reward_paid: true,
            lat: 10.7769,
            lon: 106.7009,
            distance_meters: 154.2,
            expires_at: new Date(Date.now() + 30 * 60 * 1000),
            created_at: new Date(),
            updated_at: new Date(),
          },
        ];
      });

      const result = await service.listHazards({
        lat: 10.775,
        lon: 106.700,
        radiusMeters: 5000,
      });

      expect(result.total).toBe(1);
      expect(result.items[0].distanceMeters).toBe(154.2);
      expect(result.items[0].status).toBe(HazardStatus.CONFIRMED);
    });

    it('queries active hazards with bbox and status filter', async () => {
      queryMock.mockImplementation(async (sql: string) => {
        if (sql.includes('COUNT(*)')) return [{ cnt: 2 }];
        return [
          {
            id: 'h-1',
            reported_by: 'u-1',
            hazard_type: 'POTHOLE',
            status: HazardStatus.UNCONFIRMED,
            confirmations_count: 1,
            dismissals_count: 0,
            reward_paid: false,
            lat: 10.5,
            lon: 106.5,
            distance_meters: null,
            expires_at: new Date(),
            created_at: new Date(),
            updated_at: new Date(),
          },
        ];
      });

      const res = await service.listHazards({
        status: HazardStatus.UNCONFIRMED,
        minLat: 10,
        minLon: 106,
        maxLat: 11,
        maxLon: 107,
      });

      expect(res.total).toBe(2);
      expect(res.items[0].hazardType).toBe('POTHOLE');
      expect(res.items[0].distanceMeters).toBeNull();
    });
  });

  describe('getHazard', () => {
    it('returns hazard detail when found', async () => {
      queryMock.mockResolvedValueOnce([
        {
          id: 'hazard-1',
          reported_by: 'u-1',
          hazard_type: 'ACCIDENT',
          description: 'Two cars crashed',
          status: HazardStatus.CONFIRMED,
          confirmations_count: 4,
          dismissals_count: 0,
          reward_paid: true,
          lat: 10.77,
          lon: 106.70,
          expires_at: new Date(),
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]);

      const res = await service.getHazard('hazard-1');
      expect(res.id).toBe('hazard-1');
      expect(res.hazardType).toBe('ACCIDENT');
    });

    it('throws NotFoundException when hazard does not exist', async () => {
      queryMock.mockResolvedValueOnce([]);
      await expect(service.getHazard('missing-h')).rejects.toThrow();
    });
  });
});
