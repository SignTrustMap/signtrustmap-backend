import { NotFoundException } from '@nestjs/common';
import { CameraProfileService } from './camera-profile.service';
import { CameraCalibrationProfile } from '../infrastructure/persistence/camera-calibration-profile.entity';

describe('CameraProfileService', () => {
  let service: CameraProfileService;
  let mockProfileRepo: any;
  let mockDataSource: any;
  let mockManager: any;

  const mockUser = { id: 'user-001' };
  const mockProfile: Partial<CameraCalibrationProfile> = {
    id: 'prof-001',
    userId: mockUser.id,
    deviceModel: 'iPhone 15 Pro',
    cameraHeightMeters: 1.35,
    pitchAngleDegrees: -2.5,
    yawOffsetDegrees: 1.0,
    hfovDegrees: 65.0,
    focalLengthPx: 1200,
    isDefault: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  beforeEach(() => {
    mockProfileRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
    };

    mockManager = {
      count: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      remove: jest.fn(),
    };

    mockDataSource = {
      transaction: jest.fn(async (callback) => callback(mockManager)),
    };

    service = new CameraProfileService(mockProfileRepo, mockDataSource);
  });

  describe('getUserProfiles', () => {
    it('returns profiles sorted by isDefault DESC, createdAt DESC', async () => {
      mockProfileRepo.find.mockResolvedValue([mockProfile]);

      const result = await service.getUserProfiles(mockUser.id);
      expect(mockProfileRepo.find).toHaveBeenCalledWith({
        where: { userId: mockUser.id },
        order: { isDefault: 'DESC', createdAt: 'DESC' },
      });
      expect(result).toEqual([mockProfile]);
    });
  });

  describe('getProfileById', () => {
    it('returns profile if found and owned by user', async () => {
      mockProfileRepo.findOne.mockResolvedValue(mockProfile);

      const result = await service.getProfileById(mockUser.id, 'prof-001');
      expect(result).toEqual(mockProfile);
    });

    it('throws NotFoundException if profile does not exist', async () => {
      mockProfileRepo.findOne.mockResolvedValue(null);

      await expect(service.getProfileById(mockUser.id, 'prof-nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getDefaultProfile', () => {
    it('returns user default profile if found', async () => {
      mockProfileRepo.findOne.mockResolvedValue(mockProfile);

      const result = await service.getDefaultProfile(mockUser.id);
      expect(mockProfileRepo.findOne).toHaveBeenCalledWith({
        where: { userId: mockUser.id, isDefault: true },
      });
      expect(result).toEqual(mockProfile);
    });
  });

  describe('createProfile', () => {
    it('creates first profile as default if no existing profiles', async () => {
      mockManager.count.mockResolvedValue(0);
      mockManager.create.mockReturnValue({ ...mockProfile, isDefault: true });
      mockManager.save.mockResolvedValue({ ...mockProfile, isDefault: true });

      const result = await service.createProfile(mockUser.id, {
        deviceModel: 'iPhone 15 Pro',
        cameraHeightMeters: 1.4,
        pitchAngleDegrees: 0,
        yawOffsetDegrees: 0,
      });

      expect(mockManager.count).toHaveBeenCalledWith(CameraCalibrationProfile, {
        where: { userId: mockUser.id },
      });
      expect(result.isDefault).toBe(true);
    });

    it('unsets previous default if new profile is marked default', async () => {
      mockManager.count.mockResolvedValue(2);
      mockManager.create.mockReturnValue({ ...mockProfile, isDefault: true });
      mockManager.save.mockResolvedValue({ ...mockProfile, isDefault: true });

      await service.createProfile(mockUser.id, {
        deviceModel: 'Samsung Galaxy S24',
        isDefault: true,
      });

      expect(mockManager.update).toHaveBeenCalledWith(
        CameraCalibrationProfile,
        { userId: mockUser.id },
        { isDefault: false },
      );
    });
  });

  describe('setDefaultProfile', () => {
    it('sets specified profile as default and unsets others', async () => {
      const existing = { ...mockProfile, isDefault: false };
      mockManager.findOne.mockResolvedValue(existing);
      mockManager.save.mockResolvedValue({ ...existing, isDefault: true });

      const result = await service.setDefaultProfile(mockUser.id, 'prof-001');

      expect(mockManager.update).toHaveBeenCalledWith(
        CameraCalibrationProfile,
        { userId: mockUser.id },
        { isDefault: false },
      );
      expect(result.isDefault).toBe(true);
    });

    it('throws NotFoundException if profile not found', async () => {
      mockManager.findOne.mockResolvedValue(null);

      await expect(service.setDefaultProfile(mockUser.id, 'unknown')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deleteProfile', () => {
    it('deletes profile and promotes another if was default', async () => {
      const existing = { ...mockProfile, isDefault: true };
      const fallback = { ...mockProfile, id: 'prof-002', isDefault: false };
      mockManager.findOne
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(fallback);

      const result = await service.deleteProfile(mockUser.id, 'prof-001');

      expect(mockManager.remove).toHaveBeenCalledWith(CameraCalibrationProfile, existing);
      expect(mockManager.save).toHaveBeenCalledWith(CameraCalibrationProfile, expect.objectContaining({ isDefault: true }));
      expect(result).toEqual({ deleted: true });
    });
  });
});
