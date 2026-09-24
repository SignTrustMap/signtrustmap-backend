import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { CatalogService } from '../../catalog/catalog.service';
import { VerifiedSignRepository } from '../domain/verified-sign.repository';
import { VerifiedSign, VerifiedSignStatus } from '../domain/verified-sign';
import { VerifiedSignService } from './verified-sign.service';

describe('VerifiedSignService', () => {
  const repository: jest.Mocked<VerifiedSignRepository> = {
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    findActiveInBounds: jest.fn(),
    findActiveAlongRoute: jest.fn(),
    findNearbyCandidates: jest.fn(),
  };
  const catalog = {
    getSignType: jest.fn(),
  } as unknown as CatalogService;
  const service = new VerifiedSignService(repository, catalog);

  beforeEach(() => jest.resetAllMocks());

  it('creates an active verified sign and supplies the default verification timestamp', async () => {
    (catalog.getSignType as jest.Mock).mockResolvedValue({ id: 12, isActive: true });
    repository.create.mockImplementation(async (request) => sign({
      signType: { ...sign().signType, id: request.signTypeId },
      latitude: request.latitude,
      longitude: request.longitude,
      trafficDirection: request.trafficDirection,
      signCropUrl: request.signCropUrl,
      lastVerifiedAt: request.lastVerifiedAt,
    }));

    const created = await service.create({
      signTypeId: 12,
      originCandidateId: '7c283c24-e758-4496-8df0-7b892ee4e1c1',
      latitude: 10.7725,
      longitude: 106.698,
      trafficDirection: 90,
      signCropUrl: '  https://images.test/sign.jpg  ',
    });

    expect(catalog.getSignType).toHaveBeenCalledWith(12);
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        signTypeId: 12,
        trafficDirection: 90,
        signCropUrl: 'https://images.test/sign.jpg',
        lastVerifiedAt: expect.any(Date),
      }),
    );
    expect(created.signType.id).toBe(12);
  });

  it('rejects an inactive sign type', async () => {
    (catalog.getSignType as jest.Mock).mockResolvedValue({ id: 12, isActive: false });

    await expect(
      service.create({
        signTypeId: 12,
        originCandidateId: '7c283c24-e758-4496-8df0-7b892ee4e1c1',
        latitude: 10,
        longitude: 106,
        signCropUrl: 'sign.jpg',
      }),
    ).rejects.toEqual(
      new ConflictException('Verified signs cannot use an inactive sign type'),
    );
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('rejects a partial location update', async () => {
    await expect(
      service.update('7c283c24-e758-4496-8df0-7b892ee4e1c1', { latitude: 10 }),
    ).rejects.toEqual(
      new BadRequestException('Latitude and longitude must be updated together'),
    );
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('normalizes a patch and allows clearing the traffic heading', async () => {
    const updated = sign({ trafficDirection: null, status: VerifiedSignStatus.STALE });
    repository.update.mockResolvedValue(updated);

    await expect(
      service.update('7c283c24-e758-4496-8df0-7b892ee4e1c1', {
        signTypeId: null as unknown as number,
        latitude: null as unknown as number,
        longitude: null as unknown as number,
        trafficDirection: null,
        status: VerifiedSignStatus.STALE,
      }),
    ).resolves.toBe(updated);
    expect(repository.update).toHaveBeenCalledWith(
      '7c283c24-e758-4496-8df0-7b892ee4e1c1',
      { trafficDirection: null, status: VerifiedSignStatus.STALE },
    );
    expect(catalog.getSignType).not.toHaveBeenCalled();
  });

  it('returns not found when the sign does not exist', async () => {
    repository.update.mockResolvedValue(null);

    await expect(
      service.update('7c283c24-e758-4496-8df0-7b892ee4e1c1', {
        status: VerifiedSignStatus.RETIRED,
      }),
    ).rejects.toEqual(
      new NotFoundException(
        'Verified sign 7c283c24-e758-4496-8df0-7b892ee4e1c1 was not found',
      ),
    );
  });

  it('returns active signs inside valid map bounds', async () => {
    repository.findActiveInBounds.mockResolvedValue([sign()]);

    await expect(service.findInBounds(10, 106, 11, 107, 50)).resolves.toMatchObject({
      count: 1,
      signs: [expect.objectContaining({ id: sign().id })],
    });
    expect(repository.findActiveInBounds).toHaveBeenCalledWith(10, 106, 11, 107, 50);
  });

  it('rejects inverted map bounds before querying storage', async () => {
    await expect(service.findInBounds(11, 107, 10, 106, 50)).rejects.toEqual(
      new BadRequestException('Minimum bounds must be less than maximum bounds'),
    );
    expect(repository.findActiveInBounds).not.toHaveBeenCalled();
  });

  it('maps duplicate candidate constraints to conflict', async () => {
    (catalog.getSignType as jest.Mock).mockResolvedValue({ id: 12, isActive: true });
    repository.create.mockRejectedValue(
      new QueryFailedError(
        'INSERT',
        [],
        Object.assign(new Error('duplicate key'), { code: '23505' }),
      ),
    );

    await expect(
      service.create({
        signTypeId: 12,
        originCandidateId: '7c283c24-e758-4496-8df0-7b892ee4e1c1',
        latitude: 10,
        longitude: 106,
        signCropUrl: 'sign.jpg',
      }),
    ).rejects.toEqual(
      new ConflictException(
        'A verified sign already exists for origin candidate 7c283c24-e758-4496-8df0-7b892ee4e1c1',
      ),
    );
  });

  describe('findNearbyCandidates', () => {
    it('rejects coordinates out of geographical range', async () => {
      await expect(service.findNearbyCandidates(95, 106)).rejects.toThrow(BadRequestException);
      await expect(service.findNearbyCandidates(10, 195)).rejects.toThrow(BadRequestException);
    });

    it('delegates to repository with clamped radius and returns candidates with count', async () => {
      const candidates = [{ sign: sign(), distanceMeters: 12.3 }];
      repository.findNearbyCandidates.mockResolvedValue(candidates);

      const result = await service.findNearbyCandidates(10.77, 106.69, 150, 90);
      // 150 should be clamped to 100
      expect(repository.findNearbyCandidates).toHaveBeenCalledWith(10.77, 106.69, 100, 90);
      expect(result).toEqual({ candidates, count: 1 });
    });
  });

  describe('confirmSign (anti-farming and verification)', () => {
    const dataSource = {
      query: jest.fn(),
    } as any;
    const walletService = {
      creditUser: jest.fn(),
    } as any;
    const revalidationService = {
      createOrEscalateDisputeTask: jest.fn(),
    } as any;
    const testService = new VerifiedSignService(
      repository,
      catalog,
      dataSource,
      walletService,
      revalidationService,
    );

    it('throws NotFoundException when sign does not exist', async () => {
      repository.findById.mockResolvedValue(null);
      await expect(
        testService.confirmSign('user-1', 'non-existent', { isPresent: true }),
      ).rejects.toThrow(NotFoundException);
    });

    it('awards credits based on age when sign is confirmed present and user is not on cooldown', async () => {
      const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
      const targetSign = sign({ id: 'target-sign', lastVerifiedAt: twentyDaysAgo });
      repository.findById.mockResolvedValue(targetSign);

      // No recent confirmations found for cooldown
      dataSource.query
        .mockResolvedValueOnce([]) // ensureTables
        .mockResolvedValueOnce([]) // cooldown check
        .mockResolvedValueOnce([]) // update verified_traffic_signs
        .mockResolvedValueOnce([]) // insert sign_confirmations
        .mockResolvedValueOnce([]); // insert sign_lifecycle_events

      const result = await testService.confirmSign('user-1', 'target-sign', {
        isPresent: true,
        latitude: 10.77,
        longitude: 106.69,
      });

      expect(result.success).toBe(true);
      expect(result.isPresent).toBe(true);
      expect(result.cooldownActive).toBe(false);
      // 20 days falls in [14, 30) -> 10 credits
      expect(result.creditsAwarded).toBe(10);
      expect(walletService.creditUser).toHaveBeenCalledWith(
        'user-1',
        10,
        'REVALIDATION_REWARD',
        'verified_sign',
        'target-sign',
        expect.stringContaining('P.102'),
      );
    });

    it('awards 0 credits when user confirms the same sign within 7-day cooldown', async () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const targetSign = sign({ id: 'target-sign', lastVerifiedAt: thirtyDaysAgo });
      repository.findById.mockResolvedValue(targetSign);

      dataSource.query
        .mockResolvedValueOnce([]) // ensureTables
        .mockResolvedValueOnce([{ id: 'recent-conf-id' }]) // cooldown check matches!
        .mockResolvedValueOnce([]) // update verified_traffic_signs
        .mockResolvedValueOnce([]) // insert sign_confirmations
        .mockResolvedValueOnce([]); // insert sign_lifecycle_events

      const result = await testService.confirmSign('user-1', 'target-sign', { isPresent: true });

      expect(result.success).toBe(true);
      expect(result.cooldownActive).toBe(true);
      expect(result.creditsAwarded).toBe(0);
      expect(walletService.creditUser).not.toHaveBeenCalled();
    });

    it('creates high-priority revalidation dispute task when isPresent is false', async () => {
      const targetSign = sign({ id: 'target-sign' });
      repository.findById.mockResolvedValue(targetSign);

      dataSource.query
        .mockResolvedValueOnce([]) // ensureTables
        .mockResolvedValueOnce([]) // insert sign_confirmations
        .mockResolvedValueOnce([]); // insert sign_lifecycle_events

      revalidationService.createOrEscalateDisputeTask.mockResolvedValue({ id: 'reval-task-999' });

      const result = await testService.confirmSign('user-1', 'target-sign', {
        isPresent: false,
        latitude: 10.77,
        longitude: 106.69,
        photoEvidenceUrl: 'crops/dispute.jpg',
        note: 'Sign was knocked down by construction',
      });

      expect(result.success).toBe(true);
      expect(result.isPresent).toBe(false);
      expect(result.creditsAwarded).toBe(0);
      expect(result.revalidationTaskId).toBe('reval-task-999');
      expect(revalidationService.createOrEscalateDisputeTask).toHaveBeenCalledWith(
        'target-sign',
        'user-1',
        'crops/dispute.jpg',
        { latitude: 10.77, longitude: 106.69 },
        'Sign was knocked down by construction',
      );
      expect(walletService.creditUser).not.toHaveBeenCalled();
    });
  });


  function sign(overrides: Partial<VerifiedSign> = {}): VerifiedSign {
    return {
      id: 'cd3b0990-e31e-47e9-ad45-b8423ddfc698',
      signType: {
        id: 1,
        categoryId: 1,
        signCode: 'P.102',
        nameVi: 'Cam di nguoc chieu',
        nameEn: 'No entry',
        description: null,
        labelingGuidelines: null,
        shape: null,
        colorScheme: null,
        isActive: true,
        category: { id: 1, code: 'PROHIBITORY', nameVi: 'Bien cam', nameEn: 'Prohibitory' },
      },
      latitude: 10,
      longitude: 106,
      trafficDirection: null,
      signCropUrl: 'sign.jpg',
      status: 'ACTIVE',
      freshnessScore: 1,
      lastVerifiedAt: new Date('2026-08-25T00:00:00Z'),
      createdAt: new Date('2026-08-25T00:00:00Z'),
      updatedAt: new Date('2026-08-25T00:00:00Z'),
      ...overrides,
    };
  }
});
