import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { SavedPlace } from './saved-place.entity';
import { RecentSearch } from './recent-search.entity';
import { PlacesService } from './places.service';

describe('PlacesService', () => {
  let service: PlacesService;
  let placesRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
  };
  let searchesRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
  };

  beforeEach(() => {
    placesRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      create: jest.fn((dto) => dto),
      save: jest.fn(async (row) => row),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    searchesRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      create: jest.fn((dto) => dto),
      save: jest.fn(async (row) => row),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    service = new PlacesService(
      placesRepo as unknown as Repository<SavedPlace>,
      searchesRepo as unknown as Repository<RecentSearch>,
    );
  });

  describe('Saved Places', () => {
    it('listSavedPlaces returns records for user', async () => {
      placesRepo.find.mockResolvedValueOnce([{ id: 'p-1', label: 'Home' }]);
      const res = await service.listSavedPlaces('u-1');
      expect(res).toEqual([{ id: 'p-1', label: 'Home' }]);
      expect(placesRepo.find).toHaveBeenCalledWith({
        where: { userId: 'u-1' },
        order: { createdAt: 'ASC' },
      });
    });

    it('addSavedPlace validates required inputs', async () => {
      await expect(service.addSavedPlace('u-1', { label: '', address: 'addr', latitude: 10, longitude: 106 })).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.addSavedPlace('u-1', { label: 'lbl', address: '', latitude: 10, longitude: 106 })).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.addSavedPlace('u-1', { label: 'lbl', address: 'addr', latitude: null as any, longitude: 106 })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('addSavedPlace creates and saves valid saved place', async () => {
      const res = await service.addSavedPlace('u-1', {
        label: ' Office ',
        address: ' 123 Main St ',
        latitude: 10.77,
        longitude: 106.70,
        placeType: 'work',
      });
      expect(placesRepo.create).toHaveBeenCalledWith({
        userId: 'u-1',
        label: 'Office',
        address: '123 Main St',
        latitude: 10.77,
        longitude: 106.70,
        placeType: 'WORK',
      });
      expect(placesRepo.save).toHaveBeenCalled();
      expect((res as any).label).toBe('Office');
    });

    it('removeSavedPlace throws if place not found or belongs to another user', async () => {
      placesRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.removeSavedPlace('u-1', 'p-missing')).rejects.toThrow(NotFoundException);

      placesRepo.findOne.mockResolvedValueOnce({ id: 'p-1', userId: 'u-other' });
      await expect(service.removeSavedPlace('u-1', 'p-1')).rejects.toThrow(BadRequestException);
    });

    it('removeSavedPlace successfully deletes when valid', async () => {
      placesRepo.findOne.mockResolvedValueOnce({ id: 'p-1', userId: 'u-1' });
      const res = await service.removeSavedPlace('u-1', 'p-1');
      expect(placesRepo.delete).toHaveBeenCalledWith({ id: 'p-1' });
      expect(res).toEqual({ deleted: true, id: 'p-1' });
    });
  });

  describe('Recent Searches', () => {
    it('listRecentSearches fetches searches bounded by limit', async () => {
      await service.listRecentSearches('u-1', 10);
      expect(searchesRepo.find).toHaveBeenCalledWith({
        where: { userId: 'u-1' },
        order: { createdAt: 'DESC' },
        take: 10,
      });

      await service.listRecentSearches('u-1', 100);
      expect(searchesRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 }),
      );
    });

    it('addRecentSearch rejects empty query', async () => {
      await expect(service.addRecentSearch('u-1', { query: '' })).rejects.toThrow(BadRequestException);
    });

    it('addRecentSearch dedups against recent search with same query and saves', async () => {
      searchesRepo.find.mockResolvedValueOnce([
        { id: 's-old', query: 'Ben Thanh' },
      ]);
      const res = await service.addRecentSearch('u-1', {
        query: 'ben thanh',
        address: 'District 1',
        latitude: 10.77,
        longitude: 106.69,
      });
      expect(searchesRepo.delete).toHaveBeenCalledWith({ id: 's-old' });
      expect(searchesRepo.create).toHaveBeenCalledWith({
        userId: 'u-1',
        query: 'ben thanh',
        address: 'District 1',
        latitude: 10.77,
        longitude: 106.69,
      });
      expect(searchesRepo.save).toHaveBeenCalled();
      expect((res as any).query).toBe('ben thanh');
    });

    it('clearRecentSearches deletes all searches for user', async () => {
      const res = await service.clearRecentSearches('u-1');
      expect(searchesRepo.delete).toHaveBeenCalledWith({ userId: 'u-1' });
      expect(res).toEqual({ cleared: true });
    });

    it('deleteRecentSearch checks existence, ownership, and deletes', async () => {
      searchesRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.deleteRecentSearch('u-1', 's-missing')).rejects.toThrow(NotFoundException);

      searchesRepo.findOne.mockResolvedValueOnce({ id: 's-1', userId: 'u-other' });
      await expect(service.deleteRecentSearch('u-1', 's-1')).rejects.toThrow(BadRequestException);

      searchesRepo.findOne.mockResolvedValueOnce({ id: 's-1', userId: 'u-1' });
      const res = await service.deleteRecentSearch('u-1', 's-1');
      expect(searchesRepo.delete).toHaveBeenCalledWith({ id: 's-1' });
      expect(res).toEqual({ deleted: true, id: 's-1' });
    });
  });
});
