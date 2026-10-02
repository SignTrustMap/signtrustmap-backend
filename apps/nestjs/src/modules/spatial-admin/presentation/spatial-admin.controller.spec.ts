import { BadRequestException } from '@nestjs/common';
import { SpatialAdminController } from './spatial-admin.controller';
import { SpatialAdminService } from '../application/spatial-admin.service';
import { SpatialAdminBackfillService } from '../application/spatial-admin-backfill.service';

describe('SpatialAdminController', () => {
  let controller: SpatialAdminController;
  let spatialService: {
    resolveLocation: jest.Mock;
    search: jest.Mock;
  };
  let backfillService: {
    runBackfill: jest.Mock;
  };

  beforeEach(() => {
    spatialService = {
      resolveLocation: jest.fn(),
      search: jest.fn(),
    };
    backfillService = {
      runBackfill: jest.fn(),
    };

    controller = new SpatialAdminController(
      spatialService as unknown as SpatialAdminService,
      backfillService as unknown as SpatialAdminBackfillService,
    );
  });

  describe('resolve', () => {
    it('throws BadRequestException for invalid latitude or longitude', async () => {
      await expect(controller.resolve('abc', '106.7')).rejects.toThrow(BadRequestException);
      await expect(controller.resolve('10.8', 'xyz')).rejects.toThrow(BadRequestException);
    });

    it('calls spatialService.resolveLocation with parsed numbers', async () => {
      const mockResult = { roadName: 'Nguyen Hue', commune: 'Ben Nghe', province: 'TP.HCM' };
      spatialService.resolveLocation.mockResolvedValue(mockResult);

      const res = await controller.resolve('10.7769', '106.7009');
      expect(res).toEqual(mockResult);
      expect(spatialService.resolveLocation).toHaveBeenCalledWith(10.7769, 106.7009);
    });
  });

  describe('search', () => {
    it('calls spatialService.search with parsed limit', async () => {
      spatialService.search.mockResolvedValue([{ id: 1, name: 'Ben Nghe' }]);
      const res = await controller.search('Ben Nghe', '5');
      expect(res).toEqual([{ id: 1, name: 'Ben Nghe' }]);
      expect(spatialService.search).toHaveBeenCalledWith('Ben Nghe', 5);
    });

    it('defaults limit to 10 when not specified', async () => {
      spatialService.search.mockResolvedValue([]);
      await controller.search('District 1');
      expect(spatialService.search).toHaveBeenCalledWith('District 1', 10);
    });
  });

  describe('backfill', () => {
    it('calls backfillService.runBackfill with parsed parameters', async () => {
      backfillService.runBackfill.mockResolvedValue({ processed: 25, updated: 24 });
      const res = await controller.backfill('25', '1000');
      expect(res).toEqual({ processed: 25, updated: 24 });
      expect(backfillService.runBackfill).toHaveBeenCalledWith(25, 1000);
    });

    it('defaults batchSize and maxTotal when omitted', async () => {
      backfillService.runBackfill.mockResolvedValue({ processed: 50, updated: 50 });
      await controller.backfill();
      expect(backfillService.runBackfill).toHaveBeenCalledWith(50, 5000);
    });
  });
});
