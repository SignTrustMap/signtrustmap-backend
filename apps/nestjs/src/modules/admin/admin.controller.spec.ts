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
    } as unknown as jest.Mocked<AdminService>;

    walletService = {
      manualAdjustment: jest.fn(),
      freezeWallet: jest.fn(),
    } as unknown as jest.Mocked<WalletService>;

    controller = new AdminController(adminService, walletService);
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

  it('listUsers delegates to adminService.listUsers with pagination parameters', async () => {
    const expected = { items: [], total: 0, page: 1, pageSize: 20 };
    adminService.listUsers.mockResolvedValue(expected as any);

    const result = await controller.listUsers(undefined, undefined, undefined, '2', '10');

    expect(adminService.listUsers).toHaveBeenCalledWith({
      role: undefined,
      status: undefined,
      search: undefined,
      page: 2,
      pageSize: 10,
    });
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
});
