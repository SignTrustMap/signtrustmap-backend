import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { WalletService } from '../wallet/application/wallet.service';

describe('AdminController (Phase 1 Ledger Adjustments & Admin Operations)', () => {
  let controller: AdminController;
  let adminService: jest.Mocked<AdminService>;
  let walletService: jest.Mocked<WalletService>;

  const mockAdmin = { id: 'admin-uuid-1', email: 'admin@stm.dev' };
  const mockReq = { ip: '127.0.0.1', headers: {} };

  beforeEach(() => {
    adminService = {
      listUsers: jest.fn(),
      updateUserStatus: jest.fn(),
      assignRole: jest.fn(),
      listAuditLogs: jest.fn(),
      exportSigns: jest.fn(),
      getConsensusConfig: jest.fn(),
      updateConsensusConfig: jest.fn(),
      getRouteMatrix: jest.fn(),
      updateRouteMatrix: jest.fn(),
      listFreshnessRules: jest.fn(),
      getFreshnessRule: jest.fn(),
      createFreshnessRule: jest.fn(),
      updateFreshnessRule: jest.fn(),
      deleteFreshnessRule: jest.fn(),
      listRewardRules: jest.fn(),
      getRewardRule: jest.fn(),
      updateRewardRule: jest.fn(),
      getUserStatistics: jest.fn(),
      getUsersSummaryStatistics: jest.fn(),
      getTaskHistory: jest.fn(),
      listTaskHistory: jest.fn(),
    } as unknown as jest.Mocked<AdminService>;

    walletService = {
      manualAdjustment: jest.fn(),
      freezeWallet: jest.fn(),
    } as unknown as jest.Mocked<WalletService>;

    const systemSwitchService = {
      getAllFlags: jest.fn().mockResolvedValue([]),
      setFlag: jest.fn().mockResolvedValue({ key: 'DEMO_MODE_ACTIVE', isEnabled: true }),
      enableDemoMode: jest.fn().mockResolvedValue([]),
      disableDemoMode: jest.fn().mockResolvedValue([]),
    } as any;

    controller = new AdminController(adminService, walletService, systemSwitchService);
  });

  it('enforces ADMIN role restriction on AdminController', () => {
    const roles = Reflect.getMetadata('roles', AdminController);
    expect(roles).toEqual(['ADMIN']);
  });

  it('adjustWallet delegates to walletService.manualAdjustment with IP capture', async () => {
    const dto = {
      amount: 100,
      reason: 'Compensation for verified bug report',
    };
    const expected = {
      id: 'tx-uuid-1',
      walletId: 'wallet-uuid-1',
      amount: 100,
      balanceAfter: '1100',
    };
    walletService.manualAdjustment.mockResolvedValue(expected as any);

    const result = await controller.adjustWallet('wallet-uuid-1', dto, mockAdmin, mockReq);

    expect(walletService.manualAdjustment).toHaveBeenCalledWith(
      mockAdmin.id,
      'wallet-uuid-1',
      dto,
      '127.0.0.1',
    );
    expect(result).toBe(expected);
  });

  it('freezeWallet delegates to walletService.freezeWallet with IP capture', async () => {
    const dto = {
      freeze: true,
      reason: 'Investigating suspected fraud',
    };
    const expected = {
      id: 'wallet-uuid-1',
      isFrozen: true,
    };
    walletService.freezeWallet.mockResolvedValue(expected as any);

    const result = await controller.freezeWallet('wallet-uuid-1', dto, mockAdmin, mockReq);

    expect(walletService.freezeWallet).toHaveBeenCalledWith(
      mockAdmin.id,
      'wallet-uuid-1',
      true,
      'Investigating suspected fraud',
      '127.0.0.1',
    );
    expect(result).toBe(expected);
  });

  it('listUsers delegates to adminService.listUsers with pagination parameters and includeStats', async () => {
    const expected = { items: [], total: 0, page: 1, pageSize: 20 };
    adminService.listUsers.mockResolvedValue(expected as any);

    const result = await controller.listUsers(undefined, undefined, undefined, '2', '10');

    expect(adminService.listUsers).toHaveBeenCalledWith({
      role: undefined,
      status: undefined,
      search: undefined,
      page: 2,
      pageSize: 10,
      includeStats: true,
    });
    expect(result).toBe(expected);
  });

  it('listUsers passes includeStats=false when requested', async () => {
    const expected = { items: [], total: 0, page: 1, pageSize: 20 };
    adminService.listUsers.mockResolvedValue(expected as any);

    await controller.listUsers(undefined, undefined, undefined, '1', '20', 'false');

    expect(adminService.listUsers).toHaveBeenCalledWith({
      role: undefined,
      status: undefined,
      search: undefined,
      page: 1,
      pageSize: 20,
      includeStats: false,
    });
  });

  it('getUsersSummaryStatistics delegates to adminService.getUsersSummaryStatistics', async () => {
    const expected = { totalUsers: 10 } as any;
    adminService.getUsersSummaryStatistics.mockResolvedValue(expected);

    const result = await controller.getUsersSummaryStatistics();

    expect(adminService.getUsersSummaryStatistics).toHaveBeenCalled();
    expect(result).toBe(expected);
  });

  it('getUserStatistics delegates to adminService.getUserStatistics with UUID', async () => {
    const expected = { userId: 'u1' } as any;
    adminService.getUserStatistics.mockResolvedValue(expected);

    const result = await controller.getUserStatistics('u1');

    expect(adminService.getUserStatistics).toHaveBeenCalledWith('u1');
    expect(result).toBe(expected);
  });

  it('updateStatus delegates to adminService.updateUserStatus', async () => {
    const dto = { status: 'BANNED' as any, reason: 'Repeated spam submissions' };
    const expected = { id: 'user-uuid-2', status: 'BANNED' };
    adminService.updateUserStatus.mockResolvedValue(expected as any);

    const result = await controller.updateStatus('user-uuid-2', dto, mockAdmin, mockReq);

    expect(adminService.updateUserStatus).toHaveBeenCalledWith(
      'user-uuid-2',
      'BANNED',
      'Repeated spam submissions',
      mockAdmin.id,
      '127.0.0.1',
    );
    expect(result).toBe(expected);
  });

  it('assignRole delegates to adminService.assignRole', async () => {
    const dto = { roleCode: 'SURVEYOR', isActive: true };
    const expected = { userId: 'user-uuid-3', roleCode: 'SURVEYOR' };
    adminService.assignRole.mockResolvedValue(expected as any);

    const result = await controller.assignRole('user-uuid-3', dto, mockAdmin);

    expect(adminService.assignRole).toHaveBeenCalledWith(
      'user-uuid-3',
      'SURVEYOR',
      mockAdmin.id,
      true,
    );
    expect(result).toBe(expected);
  });

  it('listAuditLogs delegates to adminService.listAuditLogs', async () => {
    const expected = { items: [], total: 0 };
    adminService.listAuditLogs.mockResolvedValue(expected as any);

    const result = await controller.listAuditLogs();

    expect(adminService.listAuditLogs).toHaveBeenCalledWith({
      action: undefined,
      resourceName: undefined,
      userId: undefined,
      page: 1,
      pageSize: 20,
    });
    expect(result).toBe(expected);
  });

  it('exportSigns delegates to adminService.exportSigns', async () => {
    const expected = { type: 'FeatureCollection', features: [] };
    adminService.exportSigns.mockResolvedValue(expected as any);

    const result = await controller.exportSigns('geojson', 'ACTIVE');

    expect(adminService.exportSigns).toHaveBeenCalledWith('geojson', 'ACTIVE');
    expect(result).toBe(expected);
  });

  it('exportSigns sets CSV download headers when res is provided', async () => {
    const expected = 'id,sign_code\n1,W.201';
    adminService.exportSigns.mockResolvedValue(expected as any);
    const mockRes = { setHeader: jest.fn() };

    const result = await controller.exportSigns('csv', 'ACTIVE', mockRes);

    expect(adminService.exportSigns).toHaveBeenCalledWith('csv', 'ACTIVE');
    expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
    expect(mockRes.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="signtrustmap-signs.csv"',
    );
    expect(result).toBe(expected);
  });

  it('getConsensusConfig delegates to adminService.getConsensusConfig', async () => {
    const expected = { approvalThreshold: 2.0, rejectionThreshold: -2.0 };
    adminService.getConsensusConfig.mockResolvedValue(expected as any);

    const result = await controller.getConsensusConfig();

    expect(adminService.getConsensusConfig).toHaveBeenCalled();
    expect(result).toBe(expected);
  });

  it('updateConsensusConfig delegates to adminService.updateConsensusConfig with IP capture', async () => {
    const dto = { approvalThreshold: 2.5, minVotesRequired: 4 };
    const expected = { id: 2, approvalThreshold: 2.5, minVotesRequired: 4 };
    adminService.updateConsensusConfig.mockResolvedValue(expected as any);

    const result = await controller.updateConsensusConfig(dto, mockAdmin, mockReq);

    expect(adminService.updateConsensusConfig).toHaveBeenCalledWith(
      dto,
      mockAdmin.id,
      '127.0.0.1',
    );
    expect(result).toBe(expected);
  });

  it('getRouteMatrix delegates to adminService.getRouteMatrix', async () => {
    const expected = [{ id: 1, name: 'motorway', roadType: 'motorway' }];
    adminService.getRouteMatrix.mockResolvedValue(expected as any);

    const result = await controller.getRouteMatrix();

    expect(adminService.getRouteMatrix).toHaveBeenCalled();
    expect(result).toBe(expected);
  });

  it('updateRouteMatrix delegates to adminService.updateRouteMatrix with IP capture', async () => {
    const dto = { defaultLifetimeDays: 120, spatialBufferMeters: 30 };
    const expected = { id: 1, defaultLifetimeDays: 120, spatialBufferMeters: 30, updated: true };
    adminService.updateRouteMatrix.mockResolvedValue(expected as any);

    const result = await controller.updateRouteMatrix(1, dto, mockAdmin, mockReq);

    expect(adminService.updateRouteMatrix).toHaveBeenCalledWith(
      1,
      dto,
      mockAdmin.id,
      '127.0.0.1',
    );
    expect(result).toBe(expected);
  });

  describe('Freshness Rules Management', () => {
    it('listFreshnessRules delegates to adminService.listFreshnessRules', async () => {
      const expected = [{ id: 1, freshnessPeriodDays: 30, maxProximityMeters: 50, dailySubmissionLimit: 3 }];
      adminService.listFreshnessRules.mockResolvedValue(expected as any);

      const result = await controller.listFreshnessRules();

      expect(adminService.listFreshnessRules).toHaveBeenCalled();
      expect(result).toBe(expected);
    });

    it('getFreshnessRule delegates to adminService.getFreshnessRule', async () => {
      const expected = { id: 1, freshnessPeriodDays: 30 };
      adminService.getFreshnessRule.mockResolvedValue(expected as any);

      const result = await controller.getFreshnessRule(1);

      expect(adminService.getFreshnessRule).toHaveBeenCalledWith(1);
      expect(result).toBe(expected);
    });

    it('createFreshnessRule delegates to adminService.createFreshnessRule', async () => {
      const dto = { freshnessPeriodDays: 30, maxProximityMeters: 60 };
      const expected = { id: 2, ...dto };
      adminService.createFreshnessRule.mockResolvedValue(expected as any);

      const result = await controller.createFreshnessRule(dto as any, mockAdmin, mockReq);

      expect(adminService.createFreshnessRule).toHaveBeenCalledWith(dto, mockAdmin.id, '127.0.0.1');
      expect(result).toBe(expected);
    });

    it('updateFreshnessRule delegates to adminService.updateFreshnessRule', async () => {
      const dto = { maxProximityMeters: 75 };
      const expected = { id: 1, maxProximityMeters: 75, updated: true };
      adminService.updateFreshnessRule.mockResolvedValue(expected as any);

      const result = await controller.updateFreshnessRule(1, dto, mockAdmin, mockReq);

      expect(adminService.updateFreshnessRule).toHaveBeenCalledWith(1, dto, mockAdmin.id, '127.0.0.1');
      expect(result).toBe(expected);
    });

    it('deleteFreshnessRule delegates to adminService.deleteFreshnessRule', async () => {
      const expected = { id: 1, deactivated: true };
      adminService.deleteFreshnessRule.mockResolvedValue(expected as any);

      const result = await controller.deleteFreshnessRule(1, mockAdmin, mockReq);

      expect(adminService.deleteFreshnessRule).toHaveBeenCalledWith(1, mockAdmin.id, '127.0.0.1');
      expect(result).toBe(expected);
    });
  });

  describe('Reward Rules Management', () => {
    it('listRewardRules delegates to adminService.listRewardRules', async () => {
      const expected = [{ id: 1, activityType: 'REVALIDATION_REWARD', baseAmount: 20 }];
      adminService.listRewardRules.mockResolvedValue(expected as any);

      const result = await controller.listRewardRules();

      expect(adminService.listRewardRules).toHaveBeenCalled();
      expect(result).toBe(expected);
    });

    it('getRewardRule delegates to adminService.getRewardRule', async () => {
      const expected = { id: 1, activityType: 'REVALIDATION_REWARD', baseAmount: 20 };
      adminService.getRewardRule.mockResolvedValue(expected as any);

      const result = await controller.getRewardRule('REVALIDATION_REWARD');

      expect(adminService.getRewardRule).toHaveBeenCalledWith('REVALIDATION_REWARD');
      expect(result).toBe(expected);
    });

    it('updateRewardRule delegates to adminService.updateRewardRule', async () => {
      const dto = { baseAmount: 25, dailyLimit: 15 };
      const expected = { id: 1, activityType: 'REVALIDATION_REWARD', baseAmount: 25, updated: true };
      adminService.updateRewardRule.mockResolvedValue(expected as any);

      const result = await controller.updateRewardRule('REVALIDATION_REWARD', dto, mockAdmin, mockReq);

      expect(adminService.updateRewardRule).toHaveBeenCalledWith('REVALIDATION_REWARD', dto, mockAdmin.id, '127.0.0.1');
      expect(result).toBe(expected);
    });

    it('listSystemSwitches delegates to systemSwitchService.getAllFlags', async () => {
      const result = await controller.listSystemSwitches();
      expect(Array.isArray(result)).toBe(true);
    });

    it('updateSystemSwitch delegates to systemSwitchService.setFlag', async () => {
      const dto = { isEnabled: true, reason: 'Testing presentation' };
      const result = await controller.updateSystemSwitch('DEMO_MODE_ACTIVE', dto, mockAdmin, mockReq);
      expect(result).toEqual({ key: 'DEMO_MODE_ACTIVE', isEnabled: true });
    });

    it('enableDemoMode and disableDemoMode delegate to systemSwitchService', async () => {
      const dto = { targetEmail: 'demo@stm.dev' };
      const enabledResult = await controller.enableDemoMode(dto, mockAdmin, mockReq);
      expect(Array.isArray(enabledResult)).toBe(true);

      const disabledResult = await controller.disableDemoMode(dto, mockAdmin, mockReq);
      expect(Array.isArray(disabledResult)).toBe(true);
    });

    it('getTaskHistory delegates to adminService.getTaskHistory', async () => {
      const taskId = '7b925b4b-8486-4ba2-b2ee-1ff7d1cfae33';
      const expected = {
        taskId,
        taskType: 'REVALIDATION',
        status: 'OPEN',
        surveyor: { id: 'user-1', fullName: 'Nguyen Van A', email: 'a@stm.dev' },
        surveyorRequests: [],
        reviews: [],
        timeline: [],
      };
      (adminService.getTaskHistory as jest.Mock).mockResolvedValue(expected as any);

      const result = await controller.getTaskHistory(taskId);
      expect(adminService.getTaskHistory).toHaveBeenCalledWith(taskId);
      expect(result).toBe(expected);
    });

    it('listTaskHistory delegates to adminService.listTaskHistory', async () => {
      const query = { page: 1, pageSize: 10, taskType: 'REVALIDATION' as const };
      const expected = {
        items: [],
        total: 0,
        page: 1,
        pageSize: 10,
        totalPages: 0,
      };
      (adminService.listTaskHistory as jest.Mock).mockResolvedValue(expected as any);

      const result = await controller.listTaskHistory(query);
      expect(adminService.listTaskHistory).toHaveBeenCalledWith(query);
      expect(result).toBe(expected);
    });
  });
});
