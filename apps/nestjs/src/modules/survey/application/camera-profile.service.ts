import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CameraCalibrationProfile } from '../infrastructure/persistence/camera-calibration-profile.entity';
import { CreateCameraProfileDto } from '../presentation/dto/create-camera-profile.dto';
import { UpdateCameraProfileDto } from '../presentation/dto/update-camera-profile.dto';

@Injectable()
export class CameraProfileService {
  constructor(
    @InjectRepository(CameraCalibrationProfile)
    private readonly profileRepo: Repository<CameraCalibrationProfile>,
    private readonly dataSource: DataSource,
  ) {}

  async getUserProfiles(userId: string): Promise<CameraCalibrationProfile[]> {
    return this.profileRepo.find({
      where: { userId },
      order: { isDefault: 'DESC', createdAt: 'DESC' },
    });
  }

  async getProfileById(userId: string, profileId: string): Promise<CameraCalibrationProfile> {
    const profile = await this.profileRepo.findOne({
      where: { id: profileId, userId },
    });
    if (!profile) {
      throw new NotFoundException(`Camera calibration profile ${profileId} not found`);
    }
    return profile;
  }

  async getDefaultProfile(userId: string): Promise<CameraCalibrationProfile | null> {
    return this.profileRepo.findOne({
      where: { userId, isDefault: true },
    });
  }

  async createProfile(userId: string, dto: CreateCameraProfileDto): Promise<CameraCalibrationProfile> {
    return this.dataSource.transaction(async (manager) => {
      const existingCount = await manager.count(CameraCalibrationProfile, {
        where: { userId },
      });

      const shouldBeDefault = dto.isDefault ?? (existingCount === 0);

      if (shouldBeDefault && existingCount > 0) {
        await manager.update(CameraCalibrationProfile, { userId }, { isDefault: false });
      }

      const profile = manager.create(CameraCalibrationProfile, {
        userId,
        deviceModel: dto.deviceModel,
        cameraHeightMeters: dto.cameraHeightMeters ?? 1.35,
        pitchAngleDegrees: dto.pitchAngleDegrees ?? 0.0,
        yawOffsetDegrees: dto.yawOffsetDegrees ?? 0.0,
        hfovDegrees: dto.hfovDegrees ?? 60.0,
        focalLengthPx: dto.focalLengthPx ?? null,
        isDefault: shouldBeDefault,
      });

      return manager.save(CameraCalibrationProfile, profile);
    });
  }

  async updateProfile(
    userId: string,
    profileId: string,
    dto: UpdateCameraProfileDto,
  ): Promise<CameraCalibrationProfile> {
    return this.dataSource.transaction(async (manager) => {
      const profile = await manager.findOne(CameraCalibrationProfile, {
        where: { id: profileId, userId },
      });
      if (!profile) {
        throw new NotFoundException(`Camera calibration profile ${profileId} not found`);
      }

      if (dto.isDefault === true && !profile.isDefault) {
        await manager.update(CameraCalibrationProfile, { userId }, { isDefault: false });
        profile.isDefault = true;
      } else if (dto.isDefault !== undefined) {
        profile.isDefault = dto.isDefault;
      }

      if (dto.deviceModel !== undefined) profile.deviceModel = dto.deviceModel;
      if (dto.cameraHeightMeters !== undefined) profile.cameraHeightMeters = dto.cameraHeightMeters;
      if (dto.pitchAngleDegrees !== undefined) profile.pitchAngleDegrees = dto.pitchAngleDegrees;
      if (dto.yawOffsetDegrees !== undefined) profile.yawOffsetDegrees = dto.yawOffsetDegrees;
      if (dto.hfovDegrees !== undefined) profile.hfovDegrees = dto.hfovDegrees;
      if (dto.focalLengthPx !== undefined) profile.focalLengthPx = dto.focalLengthPx;

      return manager.save(CameraCalibrationProfile, profile);
    });
  }

  async setDefaultProfile(userId: string, profileId: string): Promise<CameraCalibrationProfile> {
    return this.dataSource.transaction(async (manager) => {
      const profile = await manager.findOne(CameraCalibrationProfile, {
        where: { id: profileId, userId },
      });
      if (!profile) {
        throw new NotFoundException(`Camera calibration profile ${profileId} not found`);
      }

      await manager.update(CameraCalibrationProfile, { userId }, { isDefault: false });
      profile.isDefault = true;
      return manager.save(CameraCalibrationProfile, profile);
    });
  }

  async deleteProfile(userId: string, profileId: string): Promise<{ deleted: boolean }> {
    return this.dataSource.transaction(async (manager) => {
      const profile = await manager.findOne(CameraCalibrationProfile, {
        where: { id: profileId, userId },
      });
      if (!profile) {
        throw new NotFoundException(`Camera calibration profile ${profileId} not found`);
      }

      const wasDefault = profile.isDefault;
      await manager.remove(CameraCalibrationProfile, profile);

      if (wasDefault) {
        const nextProfile = await manager.findOne(CameraCalibrationProfile, {
          where: { userId },
          order: { createdAt: 'DESC' },
        });
        if (nextProfile) {
          nextProfile.isDefault = true;
          await manager.save(CameraCalibrationProfile, nextProfile);
        }
      }

      return { deleted: true };
    });
  }
}
