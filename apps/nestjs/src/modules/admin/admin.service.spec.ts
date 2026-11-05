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
      expect(result.items[0].statistics).toBeDefined();
      expect(result.items[0].statistics.reviews.total).toBe(0);
      expect(result.items[0].statistics.surveys.accepted).toBe(0);
      expect(result.items[0].statistics.surveys.rejected).toBe(0);
      expect(result.items[0].statistics.surveys.failed).toBe(0);
      expect(result.items[0].statistics.surveys.noSignsDetected).toBe(0);
    });

    it('omits statistics when includeStats is false', async () => {
      mockUserQueryBuilder.getManyAndCount.mockResolvedValueOnce([
        [
          { id: 'u1', email: 'user1@stm.dev', fullName: 'User 1', userRoles: [] },
        ],
        1,
      ]);

      const result = await service.listUsers({ includeStats: false });
      expect(result.items[0].statistics).toBeUndefined();
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
      expect(config.maxVotesLimit).toBe(9);
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

  describe('Freshness Rules Management', () => {
    it('listFreshnessRules returns mapped rules with category info', async () => {
      dataSource.query.mockResolvedValueOnce([
        {
          id: 1,
          signCategoryId: 2,
          categoryCode: 'WARNING',
          categoryNameEn: 'Warning Signs',
          categoryNameVi: 'Biển cảnh báo',
          freshnessPeriodDays: 30,
          defaultPriority: 'MEDIUM',
          maxProximityMeters: 50,
          dailySubmissionLimit: 3,
          isActive: true,
          createdAt: new Date(),
        },
      ]);

      const rules = await service.listFreshnessRules();
      expect(rules.length).toBe(1);
      expect(rules[0].id).toBe(1);
      expect(rules[0].categoryCode).toBe('WARNING');
      expect(rules[0].maxProximityMeters).toBe(50);
      expect(rules[0].dailySubmissionLimit).toBe(3);
    });

    it('getFreshnessRule returns rule by ID or throws NotFoundException', async () => {
      dataSource.query.mockResolvedValueOnce([
        {
          id: 1,
          signCategoryId: 2,
          categoryCode: 'WARNING',
          freshnessPeriodDays: 30,
          defaultPriority: 'MEDIUM',
          maxProximityMeters: 50,
          dailySubmissionLimit: 3,
          isActive: true,
          createdAt: new Date(),
        },
      ]);

      const rule = await service.getFreshnessRule(1);
      expect(rule.id).toBe(1);

      dataSource.query.mockResolvedValueOnce([]);
      await expect(service.getFreshnessRule(999)).rejects.toThrow(NotFoundException);
    });

    it('createFreshnessRule inserts new rule and records audit log', async () => {
      dataSource.query
        .mockResolvedValueOnce([
          {
            id: 2,
            sign_category_id: 3,
            freshness_period_days: 60,
            default_priority: 'HIGH',
            max_proximity_meters: 60,
            daily_submission_limit: 5,
            is_active: true,
            created_at: new Date(),
          },
        ]) // insert returning
        .mockResolvedValueOnce([]); // audit log

      const result = await service.createFreshnessRule(
        {
          signCategoryId: 3,
          freshnessPeriodDays: 60,
          defaultPriority: 'HIGH' as any,
          maxProximityMeters: 60,
          dailySubmissionLimit: 5,
        },
        'admin-1',
        '127.0.0.1',
      );

      expect(result.id).toBe(2);
      expect(result.freshnessPeriodDays).toBe(60);
      expect(result.maxProximityMeters).toBe(60);
      expect(result.dailySubmissionLimit).toBe(5);
    });

    it('updateFreshnessRule updates parameters and records audit log', async () => {
      dataSource.query
        .mockResolvedValueOnce([
          {
            id: 1,
            sign_category_id: 2,
            freshness_period_days: 30,
            default_priority: 'MEDIUM',
            max_proximity_meters: 50,
            daily_submission_limit: 3,
            is_active: true,
          },
        ]) // select current
        .mockResolvedValueOnce([]) // update
        .mockResolvedValueOnce([]); // audit log

      const result = await service.updateFreshnessRule(
        1,
        { maxProximityMeters: 75, dailySubmissionLimit: 4 },
        'admin-1',
        '127.0.0.1',
      );

      expect(result.updated).toBe(true);
      expect(result.maxProximityMeters).toBe(75);
      expect(result.dailySubmissionLimit).toBe(4);
    });

    it('deleteFreshnessRule deactivates rule and records audit log', async () => {
      dataSource.query
        .mockResolvedValueOnce([{ id: 1, is_active: true }])
        .mockResolvedValueOnce([]) // update is_active = false
        .mockResolvedValueOnce([]); // audit log

      const result = await service.deleteFreshnessRule(1, 'admin-1', '127.0.0.1');
      expect(result.deactivated).toBe(true);
    });
  });

  describe('Reward Rules Management', () => {
    it('listRewardRules returns mapped reward items', async () => {
      dataSource.query.mockResolvedValueOnce([
        {
          id: 1,
          activity_type: 'REVALIDATION_REWARD',
          base_amount: 20,
          daily_limit: 10,
          multiplier_config: { urgency_bonus: true },
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]);

      const rules = await service.listRewardRules();
      expect(rules.length).toBe(1);
      expect(rules[0].activityType).toBe('REVALIDATION_REWARD');
      expect(rules[0].baseAmount).toBe(20);
    });

    it('getRewardRule returns rule by activity type or throws NotFoundException', async () => {
      dataSource.query.mockResolvedValueOnce([
        {
          id: 1,
          activity_type: 'REVALIDATION_REWARD',
          base_amount: 20,
          daily_limit: 10,
          multiplier_config: {},
          is_active: true,
        },
      ]);

      const rule = await service.getRewardRule('REVALIDATION_REWARD');
      expect(rule.activityType).toBe('REVALIDATION_REWARD');

      dataSource.query.mockResolvedValueOnce([]);
      await expect(service.getRewardRule('NON_EXISTENT')).rejects.toThrow(NotFoundException);
    });

    it('updateRewardRule updates rule and records audit log', async () => {
      dataSource.query
        .mockResolvedValueOnce([
          {
            id: 1,
            activity_type: 'REVALIDATION_REWARD',
            base_amount: 20,
            daily_limit: 10,
            multiplier_config: {},
            is_active: true,
          },
        ]) // select current
        .mockResolvedValueOnce([]) // update
        .mockResolvedValueOnce([]); // audit log

      const result = await service.updateRewardRule(
        'REVALIDATION_REWARD',
        { baseAmount: 25, dailyLimit: 15 },
        'admin-1',
        '127.0.0.1',
      );

      expect(result.updated).toBe(true);
      expect(result.baseAmount).toBe(25);
      expect(result.dailyLimit).toBe(15);
    });
  });

  describe('getUserStatistics', () => {
    it('throws NotFoundException if user does not exist', async () => {
      dataSource.getRepository.mockReturnValueOnce({
        findOne: jest.fn().mockResolvedValue(null),
      });

      await expect(service.getUserStatistics('missing-id')).rejects.toThrow(NotFoundException);
    });

    it('returns full user statistics breakdown when user exists', async () => {
      const mockUser = {
        id: 'u1',
        fullName: 'Test User',
        email: 'test@stm.dev',
        status: 'ACTIVE',
        userRoles: [{ isActive: true, role: { code: 'SURVEYOR' } }],
        createdAt: new Date('2026-01-01'),
      };
      dataSource.getRepository.mockReturnValueOnce({
        findOne: jest.fn().mockResolvedValue(mockUser),
      });

      dataSource.query.mockResolvedValue([]);

      const result = await service.getUserStatistics('u1');
      expect(result.userId).toBe('u1');
      expect(result.fullName).toBe('Test User');
      expect(result.roles).toEqual(['SURVEYOR']);
      expect(result.reviews).toBeDefined();
      expect(result.surveys).toBeDefined();
      expect(result.hazards).toBeDefined();
      expect(result.navigation).toBeDefined();
    });
  });

  describe('getUsersSummaryStatistics', () => {
    it('aggregates platform metrics across users, reviews, and surveys', async () => {
      dataSource.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM users GROUP BY status')) {
          return Promise.resolve([
            { status: 'ACTIVE', cnt: 10 },
            { status: 'SUSPENDED', cnt: 2 },
          ]);
        }
        if (sql.includes('FROM user_roles ur')) {
          return Promise.resolve([
            { code: 'SURVEYOR', cnt: 5 },
            { code: 'REVIEWER', cnt: 6 },
          ]);
        }
        return Promise.resolve([]);
      });

      const summary = await service.getUsersSummaryStatistics();
      expect(summary.totalUsers).toBe(12);
      expect(summary.usersByStatus.active).toBe(10);
      expect(summary.usersByStatus.suspended).toBe(2);
      expect(summary.usersByRole.surveyor).toBe(5);
      expect(summary.usersByRole.reviewer).toBe(6);
    });
  });

  describe('getTaskHistory', () => {
    const validTaskId = '7b925b4b-8486-4ba2-b2ee-1ff7d1cfae33';

    it('throws BadRequestException for invalid UUID format', async () => {
      await expect(service.getTaskHistory('not-a-uuid')).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when task is not in revalidation or candidate tables', async () => {
      dataSource.query.mockResolvedValue([]);
      await expect(service.getTaskHistory(validTaskId)).rejects.toThrow(NotFoundException);
    });

    it('returns full participant history for a REVALIDATION task', async () => {
      dataSource.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM revalidation_tasks rt')) {
          return Promise.resolve([
            {
              id: validTaskId,
              status: 'OPEN',
              priority: 'HIGH',
              reward_credits: 50,
              created_at: new Date('2026-03-01T10:00:00Z'),
              updated_at: new Date('2026-03-01T12:00:00Z'),
              verified_sign_id: 'sign-1',
              sign_code: 'W.201',
              sign_name_vi: 'Chỗ ngoặt nguy hiểm vòng bên trái',
            },
          ]);
        }
        if (sql.includes('FROM revalidation_evidences ev')) {
          return Promise.resolve([
            {
              id: 'ev-1',
              evidence_type: 'STILL_ACTIVE',
              media_url: 'https://s3/evidence-1.jpg',
              user_id: 'surveyor-uuid-1',
              surveyor_name: 'Nguyen Van Surveyor',
              surveyor_email: 'surveyor@stm.dev',
              submitted_at: new Date('2026-03-01T10:30:00Z'),
            },
          ]);
        }
        if (sql.includes('FROM revalidation_decisions rd')) {
          return Promise.resolve([
            {
              id: 'dec-1',
              evidence_id: 'ev-1',
              decision: 'STILL_ACTIVE',
              note: 'Sign is clearly visible and undamaged',
              reviewer_id: 'reviewer-uuid-1',
              reviewer_name: 'Tran Reviewer',
              reviewer_email: 'reviewer@stm.dev',
              decided_at: new Date('2026-03-01T11:00:00Z'),
            },
          ]);
        }
        return Promise.resolve([]);
      });

      const result = await service.getTaskHistory(validTaskId);

      expect(result.taskId).toBe(validTaskId);
      expect(result.taskType).toBe('REVALIDATION');
      expect(result.status).toBe('OPEN');
      expect(result.surveyor).toEqual({
        id: 'surveyor-uuid-1',
        fullName: 'Nguyen Van Surveyor',
        email: 'surveyor@stm.dev',
      });
      expect(result.surveyorName).toBe('Nguyen Van Surveyor');
      expect(result.surveyorId).toBe('surveyor-uuid-1');
      expect(result.reviewer).toEqual({
        id: 'reviewer-uuid-1',
        fullName: 'Tran Reviewer',
        email: 'reviewer@stm.dev',
      });
      expect(result.reviewerName).toBe('Tran Reviewer');
      expect(result.reviewerId).toBe('reviewer-uuid-1');
      expect(result.surveyorRequests).toHaveLength(1);
      expect(result.reviews).toHaveLength(1);
      expect(result.timeline).toHaveLength(2);
      expect(result.timeline[0].actorRole).toBe('SURVEYOR');
      expect(result.timeline[1].actorRole).toBe('REVIEWER');
    });

    it('returns full participant history for a CANDIDATE verification task', async () => {
      dataSource.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM revalidation_tasks rt')) {
          return Promise.resolve([]);
        }
        if (sql.includes('FROM unverified_sign_candidates c')) {
          return Promise.resolve([
            {
              id: validTaskId,
              status: 'PENDING_REVIEW',
              confidence_score: 0.95,
              created_at: new Date('2026-03-02T08:00:00Z'),
              submission_id: 'sub-1',
              surveyor_id: 'surveyor-uuid-2',
              surveyor_name: 'Le Surveyor',
              surveyor_email: 'le@stm.dev',
            },
          ]);
        }
        if (sql.includes('FROM candidate_recapture_requests crr')) {
          return Promise.resolve([
            {
              id: 'crr-1',
              reason: 'BLURRY',
              note: 'Capture too dark',
              reviewer_id: 'reviewer-uuid-2',
              reviewer_name: 'Pham Reviewer',
              reviewer_email: 'pham@stm.dev',
              surveyor_id: 'surveyor-uuid-2',
              surveyor_name: 'Le Surveyor',
              surveyor_email: 'le@stm.dev',
              created_at: new Date('2026-03-02T09:00:00Z'),
              completed_at: null,
            },
          ]);
        }
        if (sql.includes('FROM candidate_reviews cr')) {
          return Promise.resolve([
            {
              id: 'cr-1',
              vote: 1,
              comment: 'Approved candidate',
              reviewer_id: 'reviewer-uuid-2',
              reviewer_name: 'Pham Reviewer',
              reviewer_email: 'pham@stm.dev',
              reviewed_at: new Date('2026-03-02T10:00:00Z'),
            },
          ]);
        }
        return Promise.resolve([]);
      });

      const result = await service.getTaskHistory(validTaskId);

      expect(result.taskId).toBe(validTaskId);
      expect(result.taskType).toBe('CANDIDATE');
      expect(result.surveyor).toEqual({
        id: 'surveyor-uuid-2',
        fullName: 'Le Surveyor',
        email: 'le@stm.dev',
      });
      expect(result.reviewer).toEqual({
        id: 'reviewer-uuid-2',
        fullName: 'Pham Reviewer',
        email: 'pham@stm.dev',
      });
      expect(result.surveyorRequests).toHaveLength(2); // initial submission + recapture request
      expect(result.reviews).toHaveLength(1);
    });
  });

  describe('listTaskHistory', () => {
    it('aggregates and paginates history across candidate and revalidation tasks', async () => {
      dataSource.query.mockImplementation((sql: string) => {
        if (sql.includes('candidate_recapture_requests crr')) {
          return Promise.resolve([
            {
              id: 'req-1',
              task_id: 'cand-uuid-1',
              task_type: 'CANDIDATE',
              action_type: 'RECAPTURE_REQUEST',
              reason: 'BLURRY',
              note: 'Request recapture',
              created_at: new Date('2026-03-01T12:00:00Z'),
              surveyor_id: 'surv-1',
              surveyor_name: 'Surveyor One',
              surveyor_email: 'surv1@stm.dev',
              reviewer_id: 'rev-1',
              reviewer_name: 'Reviewer One',
              reviewer_email: 'rev1@stm.dev',
            },
          ]);
        }
        if (sql.includes('revalidation_evidences ev')) {
          return Promise.resolve([
            {
              id: 'ev-1',
              task_id: 'reval-uuid-1',
              task_type: 'REVALIDATION',
              action_type: 'EVIDENCE_SUBMISSION',
              reason: null,
              note: null,
              created_at: new Date('2026-03-01T11:00:00Z'),
              surveyor_id: 'surv-2',
              surveyor_name: 'Surveyor Two',
              surveyor_email: 'surv2@stm.dev',
              reviewer_id: null,
              reviewer_name: null,
              reviewer_email: null,
            },
          ]);
        }
        return Promise.resolve([]);
      });

      const result = await service.listTaskHistory({ page: 1, pageSize: 10 });

      expect(result.total).toBe(2);
      expect(result.items).toHaveLength(2);
      expect(result.items[0].surveyor).toEqual({
        id: 'surv-1',
        fullName: 'Surveyor One',
        email: 'surv1@stm.dev',
      });
      expect(result.items[0].reviewer).toEqual({
        id: 'rev-1',
        fullName: 'Reviewer One',
        email: 'rev1@stm.dev',
      });
      expect(result.items[0].surveyorName).toBe('Surveyor One');
      expect(result.items[0].reviewerName).toBe('Reviewer One');
    });
  });
});
