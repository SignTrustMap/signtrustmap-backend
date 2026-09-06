import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VerifiedSignRepository } from '../domain/verified-sign.repository';
import { RoutePoint, VerifiedSign } from '../domain/verified-sign';
import { RouteSignQueryService } from './route-sign-query.service';

describe('RouteSignQueryService', () => {
  const repository: jest.Mocked<VerifiedSignRepository> = {
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    findActiveInBounds: jest.fn(),
    findActiveAlongRoute: jest.fn(),
  };

  beforeEach(() => jest.resetAllMocks());

  function service(corridorWidthMeters = 30, headingToleranceDegrees = 45) {
    return new RouteSignQueryService(
      repository,
      new ConfigService({
        routing: { routeSigns: { corridorWidthMeters, headingToleranceDegrees } },
      }),
    );
  }

  it('returns direction-matched signs in encounter order', async () => {
    const early = sign('early', 10.00005, 106.002, 90);
    const directionAgnostic = sign('both', 10.00005, 106.008, null);
    const wrongDirection = sign('wrong', 10.00005, 106.006, 270);
    repository.findActiveAlongRoute.mockResolvedValue([
      directionAgnostic,
      wrongDirection,
      early,
    ]);

    const response = await service().findAlongRoute({
      geometry: route({ latitude: 10, longitude: 106 }, { latitude: 10, longitude: 106.01 }),
    });

    expect(response.signCount).toBe(2);
    expect(response.signs.map((item) => item.sign.id)).toEqual(['early', 'both']);
    expect(response.routeDistanceMeters).toBeGreaterThan(1_090);
    expect(response.routeDistanceMeters).toBeLessThan(1_100);
    expect(response.corridorWidthMeters).toBe(30);
    expect(response.signs.every((item) => item.distanceFromRouteMeters > 5)).toBe(true);
    expect(response.signs.every((item) => item.distanceFromRouteMeters < 6)).toBe(true);
    expect(repository.findActiveAlongRoute).toHaveBeenCalledWith(
      'LINESTRING (106 10, 106.01 10)',
      30,
    );
  });

  it('uses the configured corridor and heading tolerance', async () => {
    const withinTolerance = sign('within', 10, 106.002, 94);
    const outsideTolerance = sign('outside', 10, 106.004, 96);
    repository.findActiveAlongRoute.mockResolvedValue([outsideTolerance, withinTolerance]);

    const response = await service(50, 5).findAlongRoute({
      geometry: route({ latitude: 10, longitude: 106 }, { latitude: 10, longitude: 106.01 }),
    });

    expect(response.corridorWidthMeters).toBe(50);
    expect(response.signs.map((item) => item.sign.id)).toEqual(['within']);
    expect(repository.findActiveAlongRoute).toHaveBeenCalledWith(expect.any(String), 50);
  });

  it('accepts duplicate points when the route still has a valid segment', async () => {
    repository.findActiveAlongRoute.mockResolvedValue([]);

    const response = await service().findAlongRoute({
      geometry: route(
        { latitude: 10, longitude: 106 },
        { latitude: 10, longitude: 106 },
        { latitude: 10, longitude: 106.001 },
      ),
    });

    expect(response.routeDistanceMeters).toBeGreaterThan(100);
    expect(repository.findActiveAlongRoute).toHaveBeenCalled();
  });

  it('rejects a route without distinct points', async () => {
    await expect(
      service().findAlongRoute({
        geometry: route(
          { latitude: 10, longitude: 106 },
          { latitude: 10, longitude: 106 },
        ),
      }),
    ).rejects.toEqual(
      new BadRequestException('Route geometry must contain at least two distinct points'),
    );
    expect(repository.findActiveAlongRoute).not.toHaveBeenCalled();
  });

  it('rejects a route with more than five thousand points', async () => {
    await expect(
      service().findAlongRoute({
        geometry: Array.from({ length: 5_001 }, () => ({
          latitude: 10,
          longitude: 106,
        })),
      }),
    ).rejects.toEqual(
      new BadRequestException('Route geometry cannot contain more than 5000 points'),
    );
    expect(repository.findActiveAlongRoute).not.toHaveBeenCalled();
  });

  function route(...points: RoutePoint[]): RoutePoint[] {
    return points;
  }

  function sign(
    id: string,
    latitude: number,
    longitude: number,
    trafficDirection: number | null,
  ): VerifiedSign {
    return {
      id,
      latitude,
      longitude,
      trafficDirection,
      signCropUrl: `https://images.test/${id}.jpg`,
      status: 'ACTIVE',
      freshnessScore: 1,
      lastVerifiedAt: new Date('2026-08-25T00:00:00Z'),
      createdAt: new Date('2026-08-25T00:00:00Z'),
      updatedAt: new Date('2026-08-25T00:00:00Z'),
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
    };
  }
});
