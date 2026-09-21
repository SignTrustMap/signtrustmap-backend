import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SpatialAdminService } from './spatial-admin.service';
import { GeocodingService } from '../../geocoding/application/geocoding.service';

describe('SpatialAdminService', () => {
  let dataSource: jest.Mocked<Partial<DataSource>>;
  let geocodingService: jest.Mocked<Partial<GeocodingService>>;
  let service: SpatialAdminService;

  beforeEach(() => {
    dataSource = {
      query: jest.fn(),
    };
    geocodingService = {
      reverse: jest.fn(),
      search: jest.fn(),
    };
    service = new SpatialAdminService(
      dataSource as unknown as DataSource,
      geocodingService as unknown as GeocodingService,
    );
  });

  describe('resolveLocation', () => {
    it('resolves location with internal PostGIS PiP and OSM road name', async () => {
      // 1. First query: ST_Intersects on admin_communes
      (dataSource.query as jest.Mock)
        .mockResolvedValueOnce([
          {
            commune_code: '26801',
            commune_name: 'Phường Thủ Đức',
            commune_type: 'WARD',
            boundary_version: '2025-07-01',
            province_code: '79',
            province_name: 'Thành phố Hồ Chí Minh',
            province_type: 'MUNICIPALITY',
          },
        ])
        // 2. Second query: Nearest road in osm_roads
        .mockResolvedValueOnce([
          {
            name: 'Đường Võ Văn Ngân',
            ref: 'Đ. Võ Văn Ngân',
          },
        ]);

      const result = await service.resolveLocation(10.8505, 106.7719);

      expect(result).toEqual({
        latitude: 10.8505,
        longitude: 106.7719,
        roadName: 'Đường Võ Văn Ngân',
        communeCode: '26801',
        communeName: 'Phường Thủ Đức',
        communeType: 'WARD',
        provinceCode: '79',
        provinceName: 'Thành phố Hồ Chí Minh',
        provinceType: 'MUNICIPALITY',
        displayAddress: 'Đường Võ Văn Ngân, Phường Thủ Đức, Thành phố Hồ Chí Minh',
        boundaryVersion: '2025-07-01',
        source: 'INTERNAL_SPATIAL',
      });
      expect(geocodingService.reverse).not.toHaveBeenCalled();
    });

    it('falls back to boundary tolerance when point is on border gap', async () => {
      // 1. ST_Intersects returns empty (boundary gap)
      (dataSource.query as jest.Mock)
        .mockResolvedValueOnce([])
        // 2. ST_DWithin tolerance returns commune
        .mockResolvedValueOnce([
          {
            commune_code: '26802',
            commune_name: 'Phường Linh Trung',
            commune_type: 'WARD',
            boundary_version: '2025-07-01',
            province_code: '79',
            province_name: 'Thành phố Hồ Chí Minh',
            province_type: 'MUNICIPALITY',
          },
        ])
        // 3. osm_roads nearest road
        .mockResolvedValueOnce([
          {
            name: 'Xa lộ Hà Nội',
            ref: 'QL52',
          },
        ]);

      const result = await service.resolveLocation(10.855, 106.78);

      expect(result.communeCode).toBe('26802');
      expect(result.communeName).toBe('Phường Linh Trung');
      expect(result.roadName).toBe('Xa lộ Hà Nội');
      expect(result.displayAddress).toBe('Xa lộ Hà Nội, Phường Linh Trung, Thành phố Hồ Chí Minh');
    });

    it('discovers road via Geocoding reverse when no road line exists in osm_roads', async () => {
      // 1. ST_Intersects succeeds
      (dataSource.query as jest.Mock)
        .mockResolvedValueOnce([
          {
            commune_code: '26806',
            commune_name: 'Phường Bến Nghé',
            commune_type: 'WARD',
            boundary_version: '2025-07-01',
            province_code: '79',
            province_name: 'Thành phố Hồ Chí Minh',
            province_type: 'MUNICIPALITY',
          },
        ])
        // 2. osm_roads returns empty
        .mockResolvedValueOnce([])
        // 3. ensureRoad query: SELECT id FROM osm_roads
        .mockResolvedValueOnce([])
        // 4. ensureRoad insert
        .mockResolvedValueOnce([]);

      // 5. Geocoding reverse discovery
      (geocodingService.reverse as jest.Mock).mockResolvedValueOnce({
        roadName: 'Đường Nguyễn Huệ',
        communeName: 'Phường Bến Nghé',
        provinceName: 'Thành phố Hồ Chí Minh',
        displayLocation: 'Đường Nguyễn Huệ, Phường Bến Nghé, Hồ Chí Minh',
      });

      const result = await service.resolveLocation(10.772, 106.702);

      expect(result.roadName).toBe('Đường Nguyễn Huệ');
      expect(result.source).toBe('GEOCODER_DISCOVERED');
      expect(result.displayAddress).toBe('Đường Nguyễn Huệ, Phường Bến Nghé, Thành phố Hồ Chí Minh');
      expect(geocodingService.reverse).toHaveBeenCalledWith(10.772, 106.702);
    });

    it('discovers and auto-registers commune and road when outside initial seed boundaries', async () => {
      // 1. ST_Intersects misses
      (dataSource.query as jest.Mock)
        .mockResolvedValueOnce([])
        // 2. ST_DWithin tolerance misses
        .mockResolvedValueOnce([])
        // 3. osm_roads misses
        .mockResolvedValueOnce([])
        // 4. ensureRoad: check existing
        .mockResolvedValueOnce([])
        // 5. ensureRoad: insert
        .mockResolvedValueOnce([])
        // 6. ensureCommune: query province
        .mockResolvedValueOnce([{ code: '79', name: 'Thành phố Hồ Chí Minh', type: 'MUNICIPALITY' }])
        // 7. ensureCommune: check existing
        .mockResolvedValueOnce([])
        // 8. ensureCommune: MAX code
        .mockResolvedValueOnce([{ max_code: '26808' }])
        // 9. ensureCommune: insert
        .mockResolvedValueOnce([]);

      (geocodingService.reverse as jest.Mock).mockResolvedValueOnce({
        roadName: 'Đường Nguyễn Thị Thập',
        communeName: 'Phường Tân Phú',
        provinceName: 'Thành phố Hồ Chí Minh',
        displayLocation: 'Đường Nguyễn Thị Thập, Phường Tân Phú, Thành phố Hồ Chí Minh',
      });

      const result = await service.resolveLocation(10.738, 106.721);

      expect(result.roadName).toBe('Đường Nguyễn Thị Thập');
      expect(result.communeName).toBe('Phường Tân Phú');
      expect(result.communeCode).toBe('26900');
      expect(result.provinceName).toBe('Thành phố Hồ Chí Minh');
      expect(result.displayAddress).toBe('Đường Nguyễn Thị Thập, Phường Tân Phú, Thành phố Hồ Chí Minh');
    });

    it('throws BadRequestException on invalid coordinates', async () => {
      await expect(service.resolveLocation(95, 106.77)).rejects.toThrow(BadRequestException);
      await expect(service.resolveLocation(10.85, 200)).rejects.toThrow(BadRequestException);
    });
  });

  describe('search', () => {
    it('returns administrative units matching query including legacy district name', async () => {
      (dataSource.query as jest.Mock).mockResolvedValueOnce([
        {
          commune_code: '26806',
          commune_name: 'Phường Bến Nghé',
          commune_type: 'WARD',
          province_code: '79',
          province_name: 'Thành phố Hồ Chí Minh',
          legacy_district_name: 'Quận 1',
          legacy_ward_name: 'Phường Bến Nghé',
          latitude: 10.775,
          longitude: 106.7,
        },
      ]);

      const results = await service.search('Quận 1', 5);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        communeCode: '26806',
        communeName: 'Phường Bến Nghé',
        communeType: 'WARD',
        provinceCode: '79',
        provinceName: 'Thành phố Hồ Chí Minh',
        legacyDistrictName: 'Quận 1',
        legacyWardName: 'Phường Bến Nghé',
        displayName: 'Phường Bến Nghé, Thành phố Hồ Chí Minh (Trước đây: Quận 1)',
        latitude: 10.775,
        longitude: 106.7,
      });
    });

    it('returns empty array when query is too short', async () => {
      const results = await service.search('a');
      expect(results).toEqual([]);
      expect(dataSource.query).not.toHaveBeenCalled();
    });
  });
});
