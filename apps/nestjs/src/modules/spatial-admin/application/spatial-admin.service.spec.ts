import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SpatialAdminService } from './spatial-admin.service';

describe('SpatialAdminService', () => {
  let dataSource: jest.Mocked<Partial<DataSource>>;
  let service: SpatialAdminService;

  beforeEach(() => {
    dataSource = {
      query: jest.fn(),
    };
    service = new SpatialAdminService(dataSource as unknown as DataSource);
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

    it('returns 2-tier commune and province with roadName=null when no road exists within tolerance', async () => {
      // 1. ST_Intersects succeeds
      (dataSource.query as jest.Mock)
        .mockResolvedValueOnce([
          {
            commune_code: '26919',
            commune_name: 'Phường Long Phước',
            commune_type: 'WARD',
            boundary_version: '2025-07-01',
            province_code: '79',
            province_name: 'Thành phố Hồ Chí Minh',
            province_type: 'MUNICIPALITY',
          },
        ])
        // 2. osm_roads returns empty (no named road in vicinity)
        .mockResolvedValueOnce([]);

      const result = await service.resolveLocation(10.791, 106.818);

      expect(result.roadName).toBeNull();
      expect(result.communeCode).toBe('26919');
      expect(result.communeName).toBe('Phường Long Phước');
      expect(result.provinceName).toBe('Thành phố Hồ Chí Minh');
      expect(result.displayAddress).toBe('Phường Long Phước, Thành phố Hồ Chí Minh');
      expect(result.source).toBe('INTERNAL_SPATIAL');
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
          latitude: '10.778',
          longitude: '106.702',
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
        latitude: 10.778,
        longitude: 106.702,
      });
    });
  });
});
