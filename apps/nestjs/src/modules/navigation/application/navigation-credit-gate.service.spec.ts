import { BadRequestException, NotFoundException } from '@nestjs/common';
import { NavigationCreditGateService } from './navigation-credit-gate.service';
import { NavSessionStatus } from '../infrastructure/persistence/navigation-session.entity';
import { TransactionType } from '../../wallet/infrastructure/persistence/credit-transaction.entity';

describe('NavigationCreditGateService (Phase 7 Credit Sinks & Turn-by-Turn Billing)', () => {
  let service: NavigationCreditGateService;
  let sessionRepo: any;
  let profileRepo: any;
  let dataSource: any;
  let walletService: any;

  const mockDriverId = 'd0000000-0000-0000-0000-000000000001';

  beforeEach(() => {
    sessionRepo = {
      findOne: jest.fn(),
      save: jest.fn(async (s: any) => s),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
    };

    profileRepo = {
      create: jest.fn((dto: any) => ({ ...dto })),
      save: jest.fn(async (p: any) => p),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      remove: jest.fn().mockResolvedValue({}),
    };

    dataSource = {
      query: jest.fn().mockResolvedValue([]),
    };

    walletService = {
      resolveRewardAmount: jest.fn(async (type: any, def: number) => def),
      deductUser: jest.fn().mockResolvedValue({
        txId: 'tx-nav-fee-1',
        walletId: 'w-1',
        newBalance: 95,
      }),
    };

    service = new NavigationCreditGateService(
      sessionRepo,
      profileRepo,
      dataSource,
      walletService,
    );
  });

  describe('initiateSession', () => {
    const validDto = {
      origin: { latitude: 10.7769, longitude: 106.7009 },
      destination: { latitude: 10.7800, longitude: 106.7050 },
      vehicleType: 'CAR',
      idempotencyKey: 'idemp-nav-123',
    };

    it('successfully debits 5 credits and starts an active navigation session', async () => {
      const result = await service.initiateSession(mockDriverId, validDto);

      expect(walletService.resolveRewardAmount).toHaveBeenCalledWith(
        TransactionType.NAVIGATION_FEE,
        5,
      );
      expect(walletService.deductUser).toHaveBeenCalledWith(
        mockDriverId,
        5,
        TransactionType.NAVIGATION_FEE,
        'navigation_session',
        expect.any(String),
        'Turn-by-turn navigation session fee',
        { idempotencyKey: 'idemp-nav-123' },
      );
      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO navigation_sessions'),
        expect.arrayContaining([
          expect.any(String),
          mockDriverId,
          106.7009,
          10.7769,
          106.7050,
          10.7800,
          5,
        ]),
      );
      expect(result.status).toBe(NavSessionStatus.ACTIVE);
      expect(result.creditsDeducted).toBe(5);
      expect(result.remainingBalance).toBe(95);
      expect(result.driverId).toBe(mockDriverId);
    });

    it('rejects initiation when origin or destination coordinates are out of valid bounds', async () => {
      const invalidDto = {
        ...validDto,
        origin: { latitude: 95.0, longitude: 106.7 },
      };

      await expect(service.initiateSession(mockDriverId, invalidDto)).rejects.toThrow(
        BadRequestException,
      );
      expect(walletService.deductUser).not.toHaveBeenCalled();
    });

    it('throws BadRequestException if driver has insufficient credits in wallet', async () => {
      walletService.deductUser.mockRejectedValue(
        new BadRequestException('Insufficient balance to deduct 5 credits'),
      );

      await expect(service.initiateSession(mockDriverId, validDto)).rejects.toThrow(
        'Insufficient credits to initiate turn-by-turn navigation session',
      );
      expect(dataSource.query).not.toHaveBeenCalled();
    });
  });

  describe('endSession', () => {
    it('successfully concludes an active session', async () => {
      const existingSession = {
        id: 'sess-1',
        driverId: mockDriverId,
        status: NavSessionStatus.ACTIVE,
        creditsDeducted: 5,
        startedAt: new Date(),
        endedAt: null,
      };
      sessionRepo.findOne.mockResolvedValue(existingSession);

      const result = await service.endSession(mockDriverId, 'sess-1');

      expect(sessionRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'sess-1', driverId: mockDriverId },
      });
      expect(sessionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: NavSessionStatus.COMPLETED,
          endedAt: expect.any(Date),
        }),
      );
      expect(result.status).toBe(NavSessionStatus.COMPLETED);
    });

    it('throws NotFoundException when session does not exist', async () => {
      sessionRepo.findOne.mockResolvedValue(null);

      await expect(service.endSession(mockDriverId, 'sess-none')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('listSessions', () => {
    it('returns paginated navigation sessions for the driver', async () => {
      const mockSessions = [
        { id: 'sess-1', driverId: mockDriverId, status: NavSessionStatus.COMPLETED },
      ];
      sessionRepo.findAndCount.mockResolvedValue([mockSessions, 1]);

      const result = await service.listSessions(mockDriverId, 1, 20);

      expect(sessionRepo.findAndCount).toHaveBeenCalledWith({
        where: { driverId: mockDriverId },
        order: { startedAt: 'DESC' },
        skip: 0,
        take: 20,
      });
      expect(result.items).toEqual(mockSessions);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
    });
  });

  describe('createAlertProfile', () => {
    const profileDto = {
      name: 'Expressway Radar Filter',
      description: 'Filters alerts for highway navigation',
      filterRules: { categories: ['SPEED_LIMIT'], speedThresholdKmh: 80 },
    };

    it('successfully debits 20 credits and creates custom alert profile', async () => {
      walletService.deductUser.mockResolvedValue({
        txId: 'tx-profile-fee-1',
        walletId: 'w-1',
        newBalance: 75,
      });

      const result = await service.createAlertProfile(mockDriverId, profileDto);

      expect(walletService.resolveRewardAmount).toHaveBeenCalledWith(
        TransactionType.CUSTOM_PROFILE_SPEND,
        20,
      );
      expect(walletService.deductUser).toHaveBeenCalledWith(
        mockDriverId,
        20,
        TransactionType.CUSTOM_PROFILE_SPEND,
        'custom_alert_profile',
        expect.any(String),
        'Custom alert profile activation: Expressway Radar Filter',
      );
      expect(profileRepo.save).toHaveBeenCalled();
      expect(result.creditsDeducted).toBe(20);
      expect(result.remainingBalance).toBe(75);
    });

    it('throws BadRequestException if user has insufficient credits for profile unlock', async () => {
      walletService.deductUser.mockRejectedValue(
        new BadRequestException('Insufficient balance to deduct 20 credits'),
      );

      await expect(service.createAlertProfile(mockDriverId, profileDto)).rejects.toThrow(
        'Insufficient credits to unlock custom alert profile',
      );
      expect(profileRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('activateAlertProfile', () => {
    it('deactivates other profiles and activates the selected profile', async () => {
      const existingProfile = {
        id: 'prof-1',
        userId: mockDriverId,
        name: 'Profile 1',
        isActive: false,
      };
      profileRepo.findOne.mockResolvedValue(existingProfile);

      const result = await service.activateAlertProfile(mockDriverId, 'prof-1');

      expect(profileRepo.update).toHaveBeenCalledWith(
        { userId: mockDriverId },
        { isActive: false },
      );
      expect(profileRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: true }),
      );
      expect(result.isActive).toBe(true);
    });

    it('throws NotFoundException if profile does not exist', async () => {
      profileRepo.findOne.mockResolvedValue(null);

      await expect(service.activateAlertProfile(mockDriverId, 'prof-none')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deleteAlertProfile', () => {
    it('deletes the profile when found', async () => {
      const existingProfile = {
        id: 'prof-1',
        userId: mockDriverId,
      };
      profileRepo.findOne.mockResolvedValue(existingProfile);

      const result = await service.deleteAlertProfile(mockDriverId, 'prof-1');

      expect(profileRepo.remove).toHaveBeenCalledWith(existingProfile);
      expect(result.deleted).toBe(true);
    });

    it('throws NotFoundException if profile does not exist', async () => {
      profileRepo.findOne.mockResolvedValue(null);

      await expect(service.deleteAlertProfile(mockDriverId, 'prof-none')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
