import { SpatialAdminBackfillService } from './spatial-admin-backfill.service';
import { SpatialAdminService } from './spatial-admin.service';
import { DataSource } from 'typeorm';

describe('SpatialAdminBackfillService', () => {
  let service: SpatialAdminBackfillService;
  let dataSource: jest.Mocked<Partial<DataSource>>;
  let spatialAdminService: jest.Mocked<Partial<SpatialAdminService>>;

  beforeEach(() => {
    dataSource = {
      query: jest.fn(),
    };
    spatialAdminService = {
      resolveLocation: jest.fn(),
    };
    service = new SpatialAdminBackfillService(
      dataSource as unknown as DataSource,
      spatialAdminService as unknown as SpatialAdminService,
    );
  });

  it('backfills signs with road name and 2-tier display address', async () => {
    // 1st query: returns 1 sign needing address
    (dataSource.query as jest.Mock).mockResolvedValueOnce([
      { id: 'sign-1', latitude: 10.84, longitude: 106.82 },
    ]);
    // 2nd query: returns no more signs
    (dataSource.query as jest.Mock).mockResolvedValueOnce([]);

    (spatialAdminService.resolveLocation as jest.Mock).mockResolvedValueOnce({
      communeCode: '26830',
      communeName: 'Phường Long Thạnh Mỹ',
      provinceCode: '79',
      provinceName: 'Thành phố Hồ Chí Minh',
      roadName: 'Đường Nguyễn Xiển',
      displayAddress: 'Đường Nguyễn Xiển, Phường Long Thạnh Mỹ, Thành phố Hồ Chí Minh',
      boundaryVersion: 'QD_19_2025_QD_TTG',
      source: 'INTERNAL_SPATIAL',
    });

    const result = await service.runBackfill(50, 100);

    expect(result.processed).toBe(1);
    expect(result.success).toBe(1);

    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE verified_traffic_signs'),
      ['26830', 'Đường Nguyễn Xiển', 'Đường Nguyễn Xiển, Phường Long Thạnh Mỹ, Thành phố Hồ Chí Minh', 'sign-1'],
    );
  });

  it('backfills signs with null road name when outside 50m tolerance', async () => {
    (dataSource.query as jest.Mock).mockResolvedValueOnce([
      { id: 'sign-2', latitude: 10.85, longitude: 106.83 },
    ]);
    (dataSource.query as jest.Mock).mockResolvedValueOnce([]);

    (spatialAdminService.resolveLocation as jest.Mock).mockResolvedValueOnce({
      communeCode: '26830',
      communeName: 'Phường Long Thạnh Mỹ',
      provinceCode: '79',
      provinceName: 'Thành phố Hồ Chí Minh',
      roadName: null,
      displayAddress: 'Phường Long Thạnh Mỹ, Thành phố Hồ Chí Minh',
      boundaryVersion: 'QD_19_2025_QD_TTG',
      source: 'INTERNAL_SPATIAL',
    });

    const result = await service.runBackfill(50, 100);

    expect(result.processed).toBe(1);
    expect(result.success).toBe(1);

    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE verified_traffic_signs'),
      ['26830', null, 'Phường Long Thạnh Mỹ, Thành phố Hồ Chí Minh', 'sign-2'],
    );
  });

  it('stops cleanly when no signs require backfill', async () => {
    (dataSource.query as jest.Mock).mockResolvedValueOnce([]);

    const result = await service.runBackfill(50, 100);

    expect(result.processed).toBe(0);
    expect(result.success).toBe(0);
    expect(spatialAdminService.resolveLocation).not.toHaveBeenCalled();
  });
});
