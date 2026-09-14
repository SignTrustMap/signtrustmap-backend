import { CameraProfileController } from './camera-profile.controller';
import { CameraProfileService } from '../application/camera-profile.service';

describe('CameraProfileController', () => {
  let controller: CameraProfileController;
  let service: jest.Mocked<CameraProfileService>;

  const mockUser = { id: 'user-001' };
  const mockProfile = {
    id: 'prof-001',
    userId: mockUser.id,
    deviceModel: 'iPhone 15 Pro',
    cameraHeightMeters: 1.35,
    pitchAngleDegrees: 0.0,
    yawOffsetDegrees: 0.0,
    hfovDegrees: 60.0,
    focalLengthPx: null,
    isDefault: true,
  };

  beforeEach(() => {
    service = {
      getUserProfiles: jest.fn(),
      getProfileById: jest.fn(),
      getDefaultProfile: jest.fn(),
      createProfile: jest.fn(),
      updateProfile: jest.fn(),
      setDefaultProfile: jest.fn(),
      deleteProfile: jest.fn(),
    } as unknown as jest.Mocked<CameraProfileService>;

    controller = new CameraProfileController(service);
  });

  it('listProfiles returns user profiles', async () => {
    service.getUserProfiles.mockResolvedValue([mockProfile as any]);
    const result = await controller.listProfiles(mockUser);
    expect(service.getUserProfiles).toHaveBeenCalledWith(mockUser.id);
    expect(result).toEqual([mockProfile]);
  });

  it('createProfile creates and returns profile', async () => {
    const dto = {
      deviceModel: 'iPhone 15 Pro',
      cameraHeightMeters: 1.4,
    };
    service.createProfile.mockResolvedValue(mockProfile as any);
    const result = await controller.createProfile(mockUser, dto as any);
    expect(service.createProfile).toHaveBeenCalledWith(mockUser.id, dto);
    expect(result).toEqual(mockProfile);
  });

  it('getProfile returns single profile details', async () => {
    service.getProfileById.mockResolvedValue(mockProfile as any);
    const result = await controller.getProfile(mockUser, 'prof-001');
    expect(service.getProfileById).toHaveBeenCalledWith(mockUser.id, 'prof-001');
    expect(result).toEqual(mockProfile);
  });

  it('updateProfile modifies and returns profile', async () => {
    const dto = { cameraHeightMeters: 1.5 };
    service.updateProfile.mockResolvedValue({ ...mockProfile, cameraHeightMeters: 1.5 } as any);
    const result = await controller.updateProfile(mockUser, 'prof-001', dto);
    expect(service.updateProfile).toHaveBeenCalledWith(mockUser.id, 'prof-001', dto);
    expect(result.cameraHeightMeters).toBe(1.5);
  });

  it('setDefault sets default profile', async () => {
    service.setDefaultProfile.mockResolvedValue(mockProfile as any);
    const result = await controller.setDefault(mockUser, 'prof-001');
    expect(service.setDefaultProfile).toHaveBeenCalledWith(mockUser.id, 'prof-001');
    expect(result).toEqual(mockProfile);
  });

  it('deleteProfile removes profile', async () => {
    service.deleteProfile.mockResolvedValue({ deleted: true });
    const result = await controller.deleteProfile(mockUser, 'prof-001');
    expect(service.deleteProfile).toHaveBeenCalledWith(mockUser.id, 'prof-001');
    expect(result).toEqual({ deleted: true });
  });
});
