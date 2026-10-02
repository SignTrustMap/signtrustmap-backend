import { PlacesController } from './places.controller';
import { PlacesService } from './places.service';

describe('PlacesController', () => {
  let controller: PlacesController;
  let service: {
    listSavedPlaces: jest.Mock;
    addSavedPlace: jest.Mock;
    removeSavedPlace: jest.Mock;
    listRecentSearches: jest.Mock;
    addRecentSearch: jest.Mock;
    clearRecentSearches: jest.Mock;
    deleteRecentSearch: jest.Mock;
  };

  const mockUser = { id: 'u-user', role: 'driver' };

  beforeEach(() => {
    service = {
      listSavedPlaces: jest.fn().mockResolvedValue([]),
      addSavedPlace: jest.fn().mockResolvedValue({ id: 'p-1' }),
      removeSavedPlace: jest.fn().mockResolvedValue({ deleted: true }),
      listRecentSearches: jest.fn().mockResolvedValue([]),
      addRecentSearch: jest.fn().mockResolvedValue({ id: 's-1' }),
      clearRecentSearches: jest.fn().mockResolvedValue({ cleared: true }),
      deleteRecentSearch: jest.fn().mockResolvedValue({ deleted: true }),
    };
    controller = new PlacesController(service as unknown as PlacesService);
  });

  it('listSaved calls service.listSavedPlaces', async () => {
    const res = await controller.listSaved(mockUser);
    expect(res).toEqual([]);
    expect(service.listSavedPlaces).toHaveBeenCalledWith(mockUser.id);
  });

  it('addSaved calls service.addSavedPlace', async () => {
    const dto = { label: 'Gym', address: '123 Fit St', latitude: 10.7, longitude: 106.6 };
    const res = await controller.addSaved(mockUser, dto);
    expect(res).toEqual({ id: 'p-1' });
    expect(service.addSavedPlace).toHaveBeenCalledWith(mockUser.id, dto);
  });

  it('removeSaved calls service.removeSavedPlace', async () => {
    const res = await controller.removeSaved(mockUser, 'p-1');
    expect(res).toEqual({ deleted: true });
    expect(service.removeSavedPlace).toHaveBeenCalledWith(mockUser.id, 'p-1');
  });

  it('listRecent parses limit query parameter and calls service', async () => {
    await controller.listRecent(mockUser, '15');
    expect(service.listRecentSearches).toHaveBeenCalledWith(mockUser.id, 15);

    await controller.listRecent(mockUser, 'invalid');
    expect(service.listRecentSearches).toHaveBeenCalledWith(mockUser.id, 20);
  });

  it('addRecent calls service.addRecentSearch', async () => {
    const dto = { query: 'Landmark 81' };
    const res = await controller.addRecent(mockUser, dto);
    expect(res).toEqual({ id: 's-1' });
    expect(service.addRecentSearch).toHaveBeenCalledWith(mockUser.id, dto);
  });

  it('clearRecent calls service.clearRecentSearches', async () => {
    const res = await controller.clearRecent(mockUser);
    expect(res).toEqual({ cleared: true });
    expect(service.clearRecentSearches).toHaveBeenCalledWith(mockUser.id);
  });

  it('deleteRecent calls service.deleteRecentSearch', async () => {
    const res = await controller.deleteRecent(mockUser, 's-1');
    expect(res).toEqual({ deleted: true });
    expect(service.deleteRecentSearch).toHaveBeenCalledWith(mockUser.id, 's-1');
  });
});
