import { NavigationController } from './navigation.controller';
import { RoutePreviewService } from '../application/route-preview.service';
import { NavigationCreditGateService } from '../application/navigation-credit-gate.service';

describe('NavigationController (Phase 7 Credit Sinks & Turn-by-Turn Billing)', () => {
  let controller: NavigationController;
  let routePreviewService: jest.Mocked<RoutePreviewService>;
  let dataSource: any;
  let creditGateService: jest.Mocked<NavigationCreditGateService>;

  const mockUser = { id: 'd0000000-0000-0000-0000-000000000001', email: 'driver@stm.dev' };

  beforeEach(() => {
    routePreviewService = {
      previewRoute: jest.fn(),
    } as unknown as jest.Mocked<RoutePreviewService>;

    dataSource = {
      query: jest.fn().mockResolvedValue([]),
    };

    creditGateService = {
      initiateSession: jest.fn(),
      endSession: jest.fn(),
      listSessions: jest.fn(),
      createAlertProfile: jest.fn(),
      listAlertProfiles: jest.fn(),
      activateAlertProfile: jest.fn(),
      deleteAlertProfile: jest.fn(),
    } as unknown as jest.Mocked<NavigationCreditGateService>;

    controller = new NavigationController(routePreviewService, dataSource, creditGateService);
  });

  describe('Turn-by-Turn Session Endpoints', () => {
    it('initiateSession delegates to creditGate.initiateSession', async () => {
      const dto = {
        origin: { latitude: 10.7769, longitude: 106.7009 },
        destination: { latitude: 10.7800, longitude: 106.7050 },
      };
      const expected = { sessionId: 'sess-1', creditsDeducted: 5, status: 'ACTIVE' };
      creditGateService.initiateSession.mockResolvedValue(expected as any);

      const result = await controller.initiateSession(mockUser, dto);

      expect(creditGateService.initiateSession).toHaveBeenCalledWith(mockUser.id, dto);
      expect(result).toBe(expected);
    });

    it('endSession delegates to creditGate.endSession', async () => {
      const expected = { sessionId: 'sess-1', status: 'COMPLETED' };
      creditGateService.endSession.mockResolvedValue(expected as any);

      const result = await controller.endSession(mockUser, 'sess-1');

      expect(creditGateService.endSession).toHaveBeenCalledWith(mockUser.id, 'sess-1');
      expect(result).toBe(expected);
    });

    it('listSessions delegates to creditGate.listSessions with pagination numbers', async () => {
      const expected = { items: [], total: 0, page: 2, pageSize: 15 };
      creditGateService.listSessions.mockResolvedValue(expected as any);

      const result = await controller.listSessions(mockUser, 2, 15);

      expect(creditGateService.listSessions).toHaveBeenCalledWith(mockUser.id, 2, 15);
      expect(result).toBe(expected);
    });
  });

  describe('Custom Alert Profile Endpoints', () => {
    it('createProfile delegates to creditGate.createAlertProfile', async () => {
      const dto = {
        name: 'Highways Only',
        filterRules: { categories: ['SPEED_LIMIT'] },
      };
      const expected = { profile: { id: 'prof-1' }, creditsDeducted: 20 };
      creditGateService.createAlertProfile.mockResolvedValue(expected as any);

      const result = await controller.createProfile(mockUser, dto);

      expect(creditGateService.createAlertProfile).toHaveBeenCalledWith(mockUser.id, dto);
      expect(result).toBe(expected);
    });

    it('listProfiles delegates to creditGate.listAlertProfiles', async () => {
      const expected = [{ id: 'prof-1', name: 'Highways Only' }];
      creditGateService.listAlertProfiles.mockResolvedValue(expected as any);

      const result = await controller.listProfiles(mockUser);

      expect(creditGateService.listAlertProfiles).toHaveBeenCalledWith(mockUser.id);
      expect(result).toBe(expected);
    });

    it('activateProfile delegates to creditGate.activateAlertProfile', async () => {
      const expected = { profileId: 'prof-1', isActive: true };
      creditGateService.activateAlertProfile.mockResolvedValue(expected as any);

      const result = await controller.activateProfile(mockUser, 'prof-1');

      expect(creditGateService.activateAlertProfile).toHaveBeenCalledWith(mockUser.id, 'prof-1');
      expect(result).toBe(expected);
    });

    it('deleteProfile delegates to creditGate.deleteAlertProfile', async () => {
      const expected = { profileId: 'prof-1', deleted: true };
      creditGateService.deleteAlertProfile.mockResolvedValue(expected as any);

      const result = await controller.deleteProfile(mockUser, 'prof-1');

      expect(creditGateService.deleteAlertProfile).toHaveBeenCalledWith(mockUser.id, 'prof-1');
      expect(result).toBe(expected);
    });
  });
});
