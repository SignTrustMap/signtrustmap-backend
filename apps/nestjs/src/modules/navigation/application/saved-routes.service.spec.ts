import { NotFoundException } from '@nestjs/common';
import { SavedRoutesService } from './saved-routes.service';
import { SavedRoute } from '../infrastructure/persistence/saved-route.entity';
import { encodePolyline } from '../domain/encoded-polyline';

describe('SavedRoutesService', () => {
  let service: SavedRoutesService;
  let mockRepo: any;
  let mockRouting: any;
  let mockRouteSigns: any;

  const sampleRoute: Partial<SavedRoute> = {
    id: 'route-uuid-1',
    userId: 'user-uuid-1',
    title: 'Work to Home',
    vehicleMode: 'MOTORCYCLE',
    originName: 'Office',
    originLatitude: 10.7769,
    originLongitude: 106.7009,
    destinationName: 'Home',
    destinationLatitude: 10.8500,
    destinationLongitude: 106.7720,
    distanceMeters: 12500,
    durationSeconds: 1500,
    encodedPolyline: encodePolyline([
      { latitude: 10.7769, longitude: 106.7009 },
      { latitude: 10.8500, longitude: 106.7720 },
    ]),
    filterRules: {
      onlyFixedSigns: true,
      categories: ['P', 'W', 'R', 'I'],
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    mockRepo = {
      find: jest.fn().mockResolvedValue([sampleRoute]),
      findOne: jest.fn().mockImplementation(({ where }) => {
        if (where.id === 'route-uuid-1' && where.userId === 'user-uuid-1') {
          return Promise.resolve({ ...sampleRoute });
        }
        return Promise.resolve(null);
      }),
      create: jest.fn().mockImplementation((dto) => ({ ...dto, id: 'new-route-id' })),
      save: jest.fn().mockImplementation((entity) => Promise.resolve({ ...entity })),
      remove: jest.fn().mockResolvedValue(true),
    };

    mockRouting = {
      findDirections: jest.fn().mockResolvedValue({
        shortestPath: {
          distanceMeters: 12500,
          durationSeconds: 1500,
          geometry: [
            { latitude: 10.7769, longitude: 106.7009 },
            { latitude: 10.8500, longitude: 106.7720 },
          ],
        },
      }),
    };

    mockRouteSigns = {
      findAlongRoute: jest.fn().mockResolvedValue({
        signCount: 2,
        signs: [
          { sign: { id: 'sign-1', signType: { signCode: 'P.103a' } }, distanceAlongRouteMeters: 500 },
          { sign: { id: 'sign-2', signType: { signCode: 'P.127' } }, distanceAlongRouteMeters: 1200 },
        ],
      }),
    };

    service = new SavedRoutesService(mockRepo, mockRouting, mockRouteSigns);
  });

  describe('listForUser', () => {
    it('returns all routes for the given user', async () => {
      const routes = await service.listForUser('user-uuid-1');
      expect(routes).toHaveLength(1);
      expect(mockRepo.find).toHaveBeenCalledWith({
        where: { userId: 'user-uuid-1' },
        order: { updatedAt: 'DESC' },
      });
    });

    it('filters by vehicleMode when specified', async () => {
      await service.listForUser('user-uuid-1', 'motorcycle');
      expect(mockRepo.find).toHaveBeenCalledWith({
        where: { userId: 'user-uuid-1', vehicleMode: 'MOTORCYCLE' },
        order: { updatedAt: 'DESC' },
      });
    });
  });

  describe('getById', () => {
    it('returns the route when found', async () => {
      const route = await service.getById('user-uuid-1', 'route-uuid-1');
      expect(route.id).toBe('route-uuid-1');
      expect(route.title).toBe('Work to Home');
    });

    it('throws NotFoundException when route is not found', async () => {
      await expect(service.getById('user-uuid-1', 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('creates and saves a route with provided polyline', async () => {
      const result = await service.create('user-uuid-1', {
        title: 'New Trip',
        vehicleMode: 'CAR',
        originName: 'Start',
        originLatitude: 10.7,
        originLongitude: 106.7,
        destinationName: 'End',
        destinationLatitude: 10.8,
        destinationLongitude: 106.8,
        encodedPolyline: 'dummy-polyline',
        distanceMeters: 10000,
        durationSeconds: 1200,
      });

      expect(result.title).toBe('New Trip');
      expect(result.vehicleMode).toBe('CAR');
      expect(mockRepo.save).toHaveBeenCalled();
    });

    it('computes polyline via routing engine if encodedPolyline is missing', async () => {
      await service.create('user-uuid-1', {
        title: 'Computed Trip',
        originName: 'Start',
        originLatitude: 10.7769,
        originLongitude: 106.7009,
        destinationName: 'End',
        destinationLatitude: 10.8500,
        destinationLongitude: 106.7720,
      });

      expect(mockRouting.findDirections).toHaveBeenCalled();
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          distanceMeters: 12500,
          durationSeconds: 1500,
          vehicleMode: 'MOTORCYCLE',
        }),
      );
    });
  });

  describe('update', () => {
    it('updates route fields and saves', async () => {
      const updated = await service.update('user-uuid-1', 'route-uuid-1', {
        title: 'Renamed Trip',
        vehicleMode: 'CAR',
        filterRules: { onlyFixedSigns: false },
      });

      expect(updated.title).toBe('Renamed Trip');
      expect(updated.vehicleMode).toBe('CAR');
      expect(mockRepo.save).toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('removes route from database', async () => {
      const result = await service.delete('user-uuid-1', 'route-uuid-1');
      expect(result.success).toBe(true);
      expect(mockRepo.remove).toHaveBeenCalled();
    });
  });

  describe('getSignsForSavedRoute', () => {
    it('decodes route polyline and queries corridor signs', async () => {
      const preview = await service.getSignsForSavedRoute('user-uuid-1', 'route-uuid-1');
      expect(preview.signCount).toBe(2);
      expect(preview.signs).toHaveLength(2);
      expect(mockRouteSigns.findAlongRoute).toHaveBeenCalledWith(
        expect.objectContaining({
          onlyFixedSigns: true,
          vehicleType: 'MOTORCYCLE',
        }),
      );
    });

    it('queries long saved routes in overlapping chunks without losing signs', async () => {
      const longGeometry = Array.from({ length: 5_001 }, (_, index) => ({
        latitude: 10.7 + index * 0.00001,
        longitude: 106.7 + index * 0.00001,
      }));
      mockRepo.findOne.mockResolvedValue({
        ...sampleRoute,
        encodedPolyline: encodePolyline(longGeometry),
      });
      mockRouteSigns.findAlongRoute.mockImplementation(async ({ geometry }: any) => ({
        routeDistanceMeters: 100,
        corridorWidthMeters: 30,
        signCount: 1,
        signs: [
          {
            sign: { id: 'sign-1', signType: { signCode: 'P.103a' } },
            distanceAlongRouteMeters: geometry.length === 5_000 ? 50 : 10,
          },
        ],
      }));

      const preview = await service.getSignsForSavedRoute('user-uuid-1', 'route-uuid-1');

      expect(mockRouteSigns.findAlongRoute).toHaveBeenCalledTimes(2);
      expect(mockRouteSigns.findAlongRoute.mock.calls.map(([request]: any) => request.geometry.length))
        .toEqual([5_000, 2]);
      expect(preview.signCount).toBe(1);
      expect(preview.signs[0].distanceAlongRouteMeters).toBe(50);
      expect(preview.distanceMeters).toBe(sampleRoute.distanceMeters);
    });
  });
});
