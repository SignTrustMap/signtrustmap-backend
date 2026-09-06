import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { CatalogService } from '../../catalog/catalog.service';
import {
  VERIFIED_SIGN_REPOSITORY,
  VerifiedSignRepository,
} from '../domain/verified-sign.repository';
import {
  CreateVerifiedSignRequest,
  UpdateVerifiedSign,
  VerifiedSign,
} from '../domain/verified-sign';

interface PostgreSqlError {
  code?: string;
  constraint?: string;
}

@Injectable()
export class VerifiedSignService {
  constructor(
    @Inject(VERIFIED_SIGN_REPOSITORY)
    private readonly repository: VerifiedSignRepository,
    private readonly catalog: CatalogService,
  ) {}

  async create(request: CreateVerifiedSignRequest): Promise<VerifiedSign> {
    await this.requireActiveSignType(request.signTypeId);
    try {
      return await this.repository.create({
        signTypeId: request.signTypeId,
        originCandidateId: request.originCandidateId,
        latitude: request.latitude,
        longitude: request.longitude,
        trafficDirection: request.trafficDirection ?? null,
        signCropUrl: request.signCropUrl.trim(),
        lastVerifiedAt: request.lastVerifiedAt ?? new Date(),
      });
    } catch (error) {
      this.rethrowConstraintError(error, request.originCandidateId);
    }
  }

  async update(id: string, request: UpdateVerifiedSign): Promise<VerifiedSign> {
    if ((request.latitude == null) !== (request.longitude == null)) {
      throw new BadRequestException('Latitude and longitude must be updated together');
    }
    if (request.signTypeId != null) {
      await this.requireActiveSignType(request.signTypeId);
    }
    const changes: UpdateVerifiedSign = {};
    if (request.signTypeId != null) changes.signTypeId = request.signTypeId;
    if (request.latitude != null && request.longitude != null) {
      changes.latitude = request.latitude;
      changes.longitude = request.longitude;
    }
    if (request.trafficDirection !== undefined) {
      changes.trafficDirection = request.trafficDirection;
    }
    if (request.signCropUrl != null) changes.signCropUrl = request.signCropUrl.trim();
    if (request.lastVerifiedAt != null) changes.lastVerifiedAt = request.lastVerifiedAt;
    if (request.status != null) changes.status = request.status;

    const updated = await this.repository.update(id, changes);
    if (!updated) throw new NotFoundException(`Verified sign ${id} was not found`);
    return updated;
  }

  private async requireActiveSignType(id: number): Promise<void> {
    const signType = await this.catalog.getSignType(id);
    if (!signType.isActive) {
      throw new ConflictException('Verified signs cannot use an inactive sign type');
    }
  }

  private rethrowConstraintError(error: unknown, originCandidateId: string): never {
    if (error instanceof QueryFailedError) {
      const driverError = error.driverError as PostgreSqlError;
      if (driverError.code === '23505') {
        throw new ConflictException(
          `A verified sign already exists for origin candidate ${originCandidateId}`,
        );
      }
      if (driverError.code === '23503') {
        throw new BadRequestException('The sign type or origin candidate does not exist');
      }
    }
    throw error;
  }
}
