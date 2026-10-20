import { DataSource } from 'typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { User } from '../auth/infrastructure/persistence/user.entity';
import { AuditLog } from './audit-log.entity';

describe('AdminService', () => {
  let service: AdminService;
  let dataSource: any;
  let mockUserQueryBuilder: any;
  let mockAuditQueryBuilder: any;

  beforeEach(() => {
    mockUserQueryBuilder = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn(),
    };

    mockAuditQueryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn(),
    };

    dataSource = {
      query: jest.fn(),
      getRepository: jest.fn().mockImplementation((entity) => {
        if (entity === User) {
          return {
            createQueryBuilder: jest.fn().mockReturnValue(mockUserQueryBuilder),
          };
        }
        if (entity === AuditLog) {
          return {
            createQueryBuilder: jest.fn().mockReturnValue(mockAuditQueryBuilder),
          };
        }
        return {
          createQueryBuilder: jest.fn().mockReturnValue(mockUserQueryBuilder),
        };
      }),
    };
    service = new AdminService(dataSource as unknown as DataSource);
  });

  describe('listUsers', () => {
    it('returns paginated users without filters', async () => {
      mockUserQueryBuilder.getManyAndCount.mockResolvedValueOnce([
        [
          { id: 'u1', email: 'user1@stm.dev', fullName: 'User 1', userRoles: [{ isActive: true, role: { code: 'ADMIN' } }] },
          { id: 'u2', email: 'user2@stm.dev', fullName: 'User 2', userRoles: [{ isActive: true, role: { code: 'DRIVER' } }] },
        ],
        2,
      ]);

      const result = await service.listUsers({});
      expect(result.total).toBe(2);
      expect(result.items.length).toBe(2);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
      expect(result.items[0].roles).toEqual(['ADMIN']);
      expect(result.items[1].roles).toEqual(['DRIVER']);
    });

    it('applies status, search, and role filters', async () => {
      mockUserQueryBuilder.getManyAndCount.mockResolvedValueOnce([
        [
          { id: 'u1', email: 'test@stm.dev', fullName: 'Test User', userRoles: [{ isActive: true, role: { code: 'STAFF' } }] },
        ],
        1,
      ]);

      const result = await service.listUsers({
        status: 'ACTIVE',
        search: 'test',
        role: 'STAFF',
        page: 2,
        pageSize: 10,
      });

      expect(result.total).toBe(1);
      expect(result.page).toBe(2);
      expect(result.pageSize).toBe(10);
      expect(mockUserQueryBuilder.andWhere).toHaveBeenCalledWith('u.status = :status', { status: 'ACTIVE' });
      expect(mockUserQueryBuilder.andWhere).toHaveBeenCalledWith(
        '(u.email ILIKE :search OR u.fullName ILIKE :search)',
        { search: '%test%' },
      );
      expect(mockUserQueryBuilder.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('EXISTS'),
        { role: 'STAFF' },
      );
    });
  });

  describe('updateUserStatus', () => {
    it('throws NotFoundException if user not found', async () => {
      dataSource.query.mockResolvedValueOnce([]);
      await expect(
        service.updateUserStatus('non-existent', 'BANNED', 'Spam', 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException if user already has the new status', async () => {
      dataSource.query.mockResolvedValueOnce([{ id: 'u1', status: 'ACTIVE' }]);
      await expect(
        service.updateUserStatus('u1', 'ACTIVE', 'Same status', 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('updates status and logs audit entry', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ id: 'u1', status: 'ACTIVE' }])
        .mockResolvedValueOnce([]) // update users
        .mockResolvedValueOnce([]) // insert user_status_history
        .mockResolvedValueOnce([]); // insert audit_logs

      const result = await service.updateUserStatus('u1', 'BANNED', 'Cheating', 'admin-1', '127.0.0.1');
      expect(result).toEqual({ userId: 'u1', oldStatus: 'ACTIVE', newStatus: 'BANNED' });
      expect(dataSource.query).toHaveBeenCalledTimes(4);
    });
  });

  describe('assignRole', () => {
    it('throws NotFoundException if user not found', async () => {
      dataSource.query.mockResolvedValueOnce([]);
      await expect(service.assignRole('u-none', 'STAFF', 'admin-1')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException if role not found', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ id: 'u1' }])
        .mockResolvedValueOnce([]);
      await expect(service.assignRole('u1', 'NON_EXISTENT', 'admin-1')).rejects.toThrow(NotFoundException);
    });

    it('updates existing role assignment if already present', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ id: 'u1' }])
        .mockResolvedValueOnce([{ id: 2, code: 'STAFF' }])
        .mockResolvedValueOnce([{ id: 10, is_active: false }]) // existing
        .mockResolvedValueOnce([]) // update
        .mockResolvedValueOnce([]); // audit log

      const result = await service.assignRole('u1', 'STAFF', 'admin-1', true);
      expect(result).toEqual({ userId: 'u1', roleCode: 'STAFF', roleId: 2, isActive: true });
    });

    it('inserts new role assignment if not already present', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ id: 'u1' }])
        .mockResolvedValueOnce([{ id: 3, code: 'REVIEWER' }])
        .mockResolvedValueOnce([]) // not existing
        .mockResolvedValueOnce([]) // insert
        .mockResolvedValueOnce([]); // audit log

      const result = await service.assignRole('u1', 'REVIEWER', 'admin-1', true);
      expect(result).toEqual({ userId: 'u1', roleCode: 'REVIEWER', roleId: 3, isActive: true });
    });
  });

  describe('listAuditLogs', () => {
    it('returns filtered audit logs', async () => {
      mockAuditQueryBuilder.getManyAndCount.mockResolvedValueOnce([
        [{ id: '1', action: 'UPDATE_STATUS', resourceName: 'users', userId: 'admin-1', createdAt: new Date() }],
        1,
      ]);

      const result = await service.listAuditLogs({
        action: 'UPDATE_STATUS',
        resourceName: 'users',
        userId: 'admin-1',
        page: 1,
        pageSize: 10,
      });

      expect(result.total).toBe(1);
      expect(result.items.length).toBe(1);
      expect(result.items[0].action).toBe('UPDATE_STATUS');
      expect(mockAuditQueryBuilder.andWhere).toHaveBeenCalledWith('a.action = :action', { action: 'UPDATE_STATUS' });
      expect(mockAuditQueryBuilder.andWhere).toHaveBeenCalledWith('a.resourceName = :resourceName', { resourceName: 'users' });
      expect(mockAuditQueryBuilder.andWhere).toHaveBeenCalledWith('a.userId = :userId', { userId: 'admin-1' });
    });
  });

  describe('exportSigns', () => {
    it('returns raw rows when format is json', async () => {
      const mockRows = [{ id: 's1', sign_code: 'W.201', location: 'POINT(106 10)' }];
      dataSource.query.mockResolvedValueOnce(mockRows);

      const result = await service.exportSigns('json', 'ACTIVE');
      expect(result).toEqual(mockRows);
    });

    it('returns GeoJSON FeatureCollection when format is geojson', async () => {
      const mockRows = [
        {
          id: 's1',
          sign_type_id: 1,
          sign_code: 'W.201',
          name_en: 'Curve Right',
          name_vi: 'Cho ngoat ben phai',
          category_code: 'WARNING',
          status: 'ACTIVE',
          freshness_score: 0.9,
          traffic_direction: 45,
          sign_crop_url: 'https://s3/crop.jpg',
          last_verified_at: '2026-10-01',
          geojson: { type: 'Point', coordinates: [106.7, 10.8] },
        },
      ];
      dataSource.query.mockResolvedValueOnce(mockRows);

      const result: any = await service.exportSigns('geojson');
      expect(result.type).toBe('FeatureCollection');
      expect(result.features.length).toBe(1);
      expect(result.features[0].geometry).toEqual({ type: 'Point', coordinates: [106.7, 10.8] });
      expect(result.features[0].properties.signCode).toBe('W.201');
    });
  });

  describe('getConsensusConfig & updateConsensusConfig', () => {
    it('returns default consensus config if no active row exists', async () => {
      dataSource.query.mockResolvedValueOnce([]);
      const config = await service.getConsensusConfig();
      expect(config.approvalThreshold).toBe(2.0);
      expect(config.minVotesRequired).toBe(3);
    });

    it('returns existing consensus config when present', async () => {
      dataSource.query.mockResolvedValueOnce([
        {
          id: 5,
          approval_threshold: 2.5,
          rejection_threshold: -2.5,
          min_votes_required: 4,
          alpha_smoothing_factor: 0.1,
          weight_correct: 1.0,
          penalty_false: 2.0,
          min_sample_baseline: 5,
          min_reliability_threshold: 60.0,
          consecutive_error_limit: 3,
          suspension_cooldown_days: 7,
          provisional_vote_weight: 0.5,
          created_by: 'admin-1',
          is_active: true,
          effective_from: '2026-10-01',
        },
      ]);
      const config = await service.getConsensusConfig();
      expect(config.id).toBe(5);
      expect(config.approvalThreshold).toBe(2.5);
      expect(config.minVotesRequired).toBe(4);
    });

    it('updates consensus config and audits changes', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ id: 1, approval_threshold: 2.0, rejection_threshold: -2.0 }])
        .mockResolvedValueOnce([]) // deactivate previous
        .mockResolvedValueOnce([
          {
            id: 2,
            approval_threshold: 3.0,
            rejection_threshold: -3.0,
            min_votes_required: 5,
            alpha_smoothing_factor: 0.1,
            weight_correct: 1.0,
            penalty_false: 2.0,
            min_sample_baseline: 5,
            min_reliability_threshold: 50.0,
            consecutive_error_limit: 3,
            suspension_cooldown_days: 7,
            provisional_vote_weight: 0.5,
            created_by: 'admin-1',
            is_active: true,
            effective_from: new Date(),
          },
        ]) // insert returning
        .mockResolvedValueOnce([]); // audit log

      const result = await service.updateConsensusConfig(
        { approvalThreshold: 3.0, minVotesRequired: 5 },
        'admin-1',
        '10.0.0.1',
      );

      expect(result.id).toBe(2);
      expect(result.approvalThreshold).toBe(3.0);
      expect(result.minVotesRequired).toBe(5);
    });
  });

  describe('getRouteMatrix & updateRouteMatrix', () => {
    it('returns mapped route matrix items', async () => {
      dataSource.query.mockResolvedValueOnce([
        {
          id: 1,
          name: 'Primary Highway',
          road_type: 'PRIMARY',
          default_lifetime_days: 90,
          revalidation_threshold_days: 60,
          spatial_buffer_meters: 15,
          created_at: new Date(),
        },
      ]);

      const matrix = await service.getRouteMatrix();
      expect(matrix.length).toBe(1);
      expect(matrix[0].name).toBe('Primary Highway');
      expect(matrix[0].spatialBufferMeters).toBe(15);
    });

    it('throws NotFoundException if route classification does not exist', async () => {
      dataSource.query.mockResolvedValueOnce([]);
      await expect(
        service.updateRouteMatrix(999, { defaultLifetimeDays: 120 }, 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('updates route matrix item and audits changes', async () => {
      dataSource.query
        .mockResolvedValueOnce([
          {
            id: 1,
            name: 'Motorway',
            road_type: 'MOTORWAY',
            default_lifetime_days: 60,
            revalidation_threshold_days: 45,
            spatial_buffer_meters: 20,
          },
        ])
        .mockResolvedValueOnce([]) // update
        .mockResolvedValueOnce([]); // audit log

      const result = await service.updateRouteMatrix(1, { defaultLifetimeDays: 120 }, 'admin-1', '127.0.0.1');
      expect(result.updated).toBe(true);
      expect(result.defaultLifetimeDays).toBe(120);
    });
  });

  describe('exportSigns (Multi-Format Exporter)', () => {
    const mockSignRows = [
      {
        id: 'sign-1',
        sign_type_id: 1,
        origin_candidate_id: 'cand-1',
        wkt: 'POINT(106.70 10.77)',
        geojson: { type: 'Point', coordinates: [106.70, 10.77] },
        lat: 10.77,
        lon: 106.70,
        traffic_direction: 90,
        sign_crop_url: 'https://s3/crop1.jpg',
        status: 'ACTIVE',
        freshness_score: 1.0,
        last_verified_at: new Date('2026-09-24T00:00:00Z'),
        created_at: new Date('2026-09-20T00:00:00Z'),
        sign_code: 'P.102',
        name_en: 'No Entry, Strictly Prohibited',
        name_vi: 'Cấm đi ngược chiều',
        category_code: 'PROHIBITORY',
      },
    ];

    it('exports signs in GeoJSON format', async () => {
      dataSource.query.mockResolvedValueOnce(mockSignRows);

      const res: any = await service.exportSigns('geojson', 'ACTIVE');
      expect(res.type).toBe('FeatureCollection');
      expect(res.features.length).toBe(1);
      expect(res.features[0].properties.signCode).toBe('P.102');
      expect(res.features[0].geometry.coordinates).toEqual([106.70, 10.77]);
      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE v.status = $1'),
        ['ACTIVE'],
      );
    });

    it('exports signs in CSV format escaping commas and retaining diacritics', async () => {
      dataSource.query.mockResolvedValueOnce(mockSignRows);

      const csv: any = await service.exportSigns('csv');
      expect(typeof csv).toBe('string');
      expect(csv).toContain('id,sign_code,name_en,name_vi,category_code');
      expect(csv).toContain('"No Entry, Strictly Prohibited"');
      expect(csv).toContain('Cấm đi ngược chiều');
      expect(csv).toContain('10.77,106.7');
    });

    it('exports signs in OSM XML format', async () => {
      dataSource.query.mockResolvedValueOnce(mockSignRows);

      const xml: any = await service.exportSigns('osm');
      expect(typeof xml).toBe('string');
      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain('<osm version="0.6"');
      expect(xml).toContain('<node id="-1" lat="10.77" lon="106.7"');
      expect(xml).toContain('<tag k="traffic_sign" v="P.102"/>');
      expect(xml).toContain('<tag k="direction" v="90"/>');
    });

    it('exports signs in JSON format by default', async () => {
      dataSource.query.mockResolvedValueOnce(mockSignRows);

      const json: any = await service.exportSigns('json');
      expect(Array.isArray(json)).toBe(true);
      expect(json[0].id).toBe('sign-1');
    });
  });
});
