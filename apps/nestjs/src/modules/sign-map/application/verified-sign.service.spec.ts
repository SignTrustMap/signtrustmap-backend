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
