import { HazardsController } from './hazards.controller';
import { HazardsService } from '../application/hazards.service';
import { HazardStatus } from '../infrastructure/persistence/road-hazard-event.entity';
import { HazardVoteType } from '../infrastructure/persistence/hazard-confirmation.entity';

describe('HazardsController', () => {
  let controller: HazardsController;
  let service: jest.Mocked<HazardsService>;

  beforeEach(() => {
    service = {
      reportHazard: jest.fn(),
      confirmHazard: jest.fn(),
      listHazards: jest.fn(),
      getHazard: jest.fn(),
    } as unknown as jest.Mocked<HazardsService>;

    controller = new HazardsController(service);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('reportHazard', () => {
    it('delegates reportHazard to HazardsService with current user and dto', async () => {
      const user = { id: 'user-uuid' };
      const dto = {
        hazardType: 'POTHOLE',
        latitude: 10.7769,
        longitude: 106.7009,
        description: 'Dangerous pothole',
      };
      const expectedResponse: any = {
        id: 'hazard-uuid',
        reportedBy: user.id,
        hazardType: dto.hazardType,
        status: HazardStatus.UNCONFIRMED,
        confirmationsCount: 1,
        dismissalsCount: 0,
        rewardPaid: false,
        latitude: dto.latitude,
        longitude: dto.longitude,
        expiresAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      service.reportHazard.mockResolvedValue(expectedResponse);

      const result = await controller.reportHazard(user, dto);
      expect(result).toBe(expectedResponse);
      expect(service.reportHazard).toHaveBeenCalledWith(user.id, dto);
    });
  });

  describe('confirmHazard', () => {
    it('delegates confirmHazard to HazardsService with hazard ID, user ID, and vote type', async () => {
      const user = { id: 'user-uuid' };
      const hazardId = 'hazard-uuid';
      const dto = {
        voteType: HazardVoteType.CONFIRM,
        latitude: 10.7769,
        longitude: 106.7009,
      };
      const expectedResponse: any = {
        id: hazardId,
        status: HazardStatus.CONFIRMED,
        confirmationsCount: 3,
      };

      service.confirmHazard.mockResolvedValue(expectedResponse);

      const result = await controller.confirmHazard(hazardId, user, dto);
      expect(result).toBe(expectedResponse);
      expect(service.confirmHazard).toHaveBeenCalledWith(hazardId, user.id, dto);
    });
  });

  describe('listHazards', () => {
    it('delegates listHazards to HazardsService with query parameters', async () => {
      const query = {
        lat: 10.7769,
        lon: 106.7009,
        radiusMeters: 5000,
        page: 1,
        pageSize: 20,
      };
      const expectedResponse: any = {
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        totalPages: 0,
      };

      service.listHazards.mockResolvedValue(expectedResponse);

      const result = await controller.listHazards(query);
      expect(result).toBe(expectedResponse);
      expect(service.listHazards).toHaveBeenCalledWith(query);
    });
  });

  describe('getHazard', () => {
    it('delegates getHazard to HazardsService with hazard ID', async () => {
      const hazardId = 'hazard-uuid';
      const expectedResponse: any = {
        id: hazardId,
        hazardType: 'SPEED_CHECK',
        status: HazardStatus.UNCONFIRMED,
      };

      service.getHazard.mockResolvedValue(expectedResponse);

      const result = await controller.getHazard(hazardId);
      expect(result).toBe(expectedResponse);
      expect(service.getHazard).toHaveBeenCalledWith(hazardId);
    });
  });
});
