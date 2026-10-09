import { SavedRoutesController } from './saved-routes.controller';

describe('SavedRoutesController', () => {
  let controller: SavedRoutesController;
  let mockService: any;
  const mockUser = { id: 'user-uuid-1' };

  beforeEach(() => {
    mockService = {
      listForUser: jest.fn().mockResolvedValue([{ id: 'r1', title: 'Route 1' }]),
      getById: jest.fn().mockResolvedValue({ id: 'r1', title: 'Route 1' }),
      create: jest.fn().mockResolvedValue({ id: 'r2', title: 'Route 2' }),
      update: jest.fn().mockResolvedValue({ id: 'r1', title: 'Route 1 Renamed' }),
      delete: jest.fn().mockResolvedValue({ success: true, id: 'r1' }),
      getSignsForSavedRoute: jest.fn().mockResolvedValue({ routeId: 'r1', signCount: 5, signs: [] }),
    };

    controller = new SavedRoutesController(mockService);
  });

  it('delegates list to service.listForUser', async () => {
    const result = await controller.list(mockUser, 'MOTORCYCLE');
    expect(mockService.listForUser).toHaveBeenCalledWith('user-uuid-1', 'MOTORCYCLE');
    expect(result).toHaveLength(1);
  });

  it('delegates getOne to service.getById', async () => {
    const result = await controller.getOne(mockUser, 'r1');
    expect(mockService.getById).toHaveBeenCalledWith('user-uuid-1', 'r1');
    expect(result.id).toBe('r1');
  });

  it('delegates create to service.create', async () => {
    const dto: any = {
      title: 'Route 2',
      originName: 'A',
      originLatitude: 10,
      originLongitude: 106,
      destinationName: 'B',
      destinationLatitude: 11,
      destinationLongitude: 107,
    };
    const result = await controller.create(mockUser, dto);
    expect(mockService.create).toHaveBeenCalledWith('user-uuid-1', dto);
    expect(result.id).toBe('r2');
  });

  it('delegates update to service.update', async () => {
    const result = await controller.update(mockUser, 'r1', { title: 'Route 1 Renamed' });
    expect(mockService.update).toHaveBeenCalledWith('user-uuid-1', 'r1', { title: 'Route 1 Renamed' });
    expect(result.title).toBe('Route 1 Renamed');
  });

  it('delegates remove to service.delete', async () => {
    const result = await controller.remove(mockUser, 'r1');
    expect(mockService.delete).toHaveBeenCalledWith('user-uuid-1', 'r1');
    expect(result.success).toBe(true);
  });

  it('delegates getSignPreview to service.getSignsForSavedRoute', async () => {
    const result = await controller.getSignPreview(mockUser, 'r1');
    expect(mockService.getSignsForSavedRoute).toHaveBeenCalledWith('user-uuid-1', 'r1');
    expect(result.signCount).toBe(5);
  });
});
