import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import { CatalogService } from '../../catalog/catalog.service';
import {
  VERIFIED_SIGN_REPOSITORY,
  VerifiedSignRepository,
} from '../domain/verified-sign.repository';
import {
  ConfirmSignRequest,
  ConfirmSignResponse,
  CreateVerifiedSignRequest,
  NearbySignCandidate,
  UpdateVerifiedSign,
  VerifiedSign,
} from '../domain/verified-sign';
import { calculateConfirmationReward } from '../domain/sign-freshness';
import { WalletService } from '../../wallet/application/wallet.service';
import { TransactionType } from '../../wallet/infrastructure/persistence/credit-transaction.entity';
import { RevalidationService } from '../../revalidation/application/revalidation.service';
import { SpatialAdminService } from '../../spatial-admin/application/spatial-admin.service';

interface PostgreSqlError {
  code?: string;
  constraint?: string;
}

@Injectable()
export class VerifiedSignService {
  private readonly logger = new Logger(VerifiedSignService.name);

  constructor(
    @Inject(VERIFIED_SIGN_REPOSITORY)
    private readonly repository: VerifiedSignRepository,
    private readonly catalog: CatalogService,
    @Optional()
    private readonly dataSource?: DataSource,
    @Optional()
    private readonly walletService?: WalletService,
    @Optional()
    private readonly revalidationService?: RevalidationService,
    @Optional()
    private readonly spatialAdminService?: SpatialAdminService,
  ) {}

  async create(request: CreateVerifiedSignRequest): Promise<VerifiedSign> {
    await this.requireActiveSignType(request.signTypeId);
    try {
      let communeCode = request.communeCode ?? null;
      let roadName = request.roadName ?? null;
      let displayAddress = request.displayAddress ?? null;

      if (!displayAddress && this.spatialAdminService) {
        try {
          const resolved = await this.spatialAdminService.resolveLocation(
            request.latitude,
            request.longitude,
          );
          communeCode = resolved.communeCode && resolved.communeCode !== '00000' ? resolved.communeCode : null;
          roadName = resolved.roadName;
          displayAddress = resolved.displayAddress;
        } catch (spatialErr: any) {
          this.logger.warn(`Failed to resolve spatial address for sign: ${spatialErr?.message}`);
        }
      }

      return await this.repository.create({
        signTypeId: request.signTypeId,
        originCandidateId: request.originCandidateId,
        latitude: request.latitude,
        longitude: request.longitude,
        trafficDirection: request.trafficDirection ?? null,
        signCropUrl: request.signCropUrl.trim(),
        lastVerifiedAt: request.lastVerifiedAt ?? new Date(),
        communeCode,
        roadName,
        displayAddress,
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
      if (request.displayAddress === undefined && this.spatialAdminService) {
        try {
          const resolved = await this.spatialAdminService.resolveLocation(
            request.latitude,
            request.longitude,
          );
          changes.communeCode = resolved.communeCode;
          changes.roadName = resolved.roadName;
          changes.displayAddress = resolved.displayAddress;
        } catch (spatialErr: any) {
          this.logger.warn(`Failed to resolve spatial address on update: ${spatialErr?.message}`);
        }
      }
    }
    if (request.communeCode !== undefined) changes.communeCode = request.communeCode;
    if (request.roadName !== undefined) changes.roadName = request.roadName;
    if (request.displayAddress !== undefined) changes.displayAddress = request.displayAddress;
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

  async findInBounds(
    minLatitude: number,
    minLongitude: number,
    maxLatitude: number,
    maxLongitude: number,
    limit: number,
  ) {
    if (minLatitude >= maxLatitude || minLongitude >= maxLongitude) {
      throw new BadRequestException('Minimum bounds must be less than maximum bounds');
    }
    const signs = await this.repository.findActiveInBounds(
      minLatitude,
      minLongitude,
      maxLatitude,
      maxLongitude,
      limit,
    );
    return { signs, count: signs.length };
  }

  async findNearbyCandidates(
    latitude: number,
    longitude: number,
    radiusMeters = 20,
    headingDegrees?: number,
  ): Promise<{ candidates: NearbySignCandidate[]; count: number }> {
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      throw new BadRequestException('Invalid latitude or longitude coordinates');
    }
    const radius = Math.min(Math.max(1, radiusMeters), 100);
    const candidates = await this.repository.findNearbyCandidates(
      latitude,
      longitude,
      radius,
      headingDegrees,
    );
    return { candidates, count: candidates.length };
  }

  async confirmSign(
    userId: string,
    signId: string,
    request: ConfirmSignRequest,
  ): Promise<ConfirmSignResponse> {
    const sign = await this.repository.findById(signId);
    if (!sign) {
      throw new NotFoundException(`Verified sign ${signId} was not found`);
    }

    if (!this.dataSource) {
      throw new Error('DataSource is not configured in VerifiedSignService');
    }

    if (request.isPresent) {
      // 7-day user cooldown for same sign confirmation
      const cooldownCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const recentRows: any[] = await this.dataSource.query(
        `SELECT id FROM sign_confirmations
         WHERE sign_id = $1 AND user_id = $2 AND created_at >= $3
         LIMIT 1`,
        [signId, userId, cooldownCutoff],
      );

      const cooldownActive = recentRows.length > 0;
      const creditsAwarded = cooldownActive
        ? 0
        : calculateConfirmationReward(sign.lastVerifiedAt, sign.createdAt);

      // Update verified traffic sign freshness score and confirmation count
      await this.dataSource.query(
        `UPDATE verified_traffic_signs
         SET last_verified_at = NOW(),
             freshness_score = 1,
             confirmation_count = COALESCE(confirmation_count, 0) + 1,
             updated_at = NOW()
         WHERE id = $1`,
        [signId],
      );

      // Record confirmation record
      await this.dataSource.query(
        `INSERT INTO sign_confirmations (id, sign_id, user_id, is_present, credits_awarded, created_at)
         VALUES (gen_random_uuid(), $1, $2, TRUE, $3, NOW())`,
        [signId, userId, creditsAwarded],
      );

      // Log sign lifecycle event
      const note = request.note ?? `Sign confirmed present by user (+${creditsAwarded} credits)`;
      try {
        await this.dataSource.query(
          `INSERT INTO sign_lifecycle_events (verified_sign_id, event_type, triggered_by, note)
           VALUES ($1, 'CONFIRMED', $2, $3)`,
          [signId, userId, note],
        );
      } catch (e: any) {
        this.logger.warn(`Lifecycle event logging failed: ${e?.message}`);
      }

      // Award credits to user if applicable
      if (creditsAwarded > 0 && this.walletService) {
        try {
          await this.walletService.creditUser(
            userId,
            creditsAwarded,
            TransactionType.REVALIDATION_REWARD,
            'verified_sign',
            sign.id,
            `Sign presence confirmed (${sign.signType.signCode || sign.id.slice(0, 8)})`,
          );
        } catch (e: any) {
          this.logger.warn(`Failed to credit user ${userId}: ${e?.message}`);
        }
      }

      return {
        success: true,
        signId,
        isPresent: true,
        creditsAwarded,
        cooldownActive,
        message: cooldownActive
          ? 'Sign confirmed. No credits awarded due to 7-day confirmation cooldown.'
          : `Sign confirmed. Awarded ${creditsAwarded} credits.`,
      };
    } else {
      // isPresent === false: report missing / dispute
      await this.dataSource.query(
        `INSERT INTO sign_confirmations (id, sign_id, user_id, is_present, credits_awarded, created_at)
         VALUES (gen_random_uuid(), $1, $2, FALSE, 0, NOW())`,
        [signId, userId],
      );

      // Log sign lifecycle dispute event
      const disputeNote = request.note ?? 'Sign reported missing by user confirmation';
      try {
        await this.dataSource.query(
          `INSERT INTO sign_lifecycle_events (verified_sign_id, event_type, triggered_by, note)
           VALUES ($1, 'DISPUTED', $2, $3)`,
          [signId, userId, disputeNote],
        );
      } catch (e: any) {
        this.logger.warn(`Lifecycle event logging failed: ${e?.message}`);
      }

      let revalidationTaskId: string | undefined;
      if (this.revalidationService) {
        const location =
          request.latitude !== undefined && request.longitude !== undefined
            ? { latitude: request.latitude, longitude: request.longitude }
            : undefined;

        const task = await this.revalidationService.createOrEscalateDisputeTask(
          signId,
          userId,
          request.photoEvidenceUrl,
          location,
          request.note,
        );
        revalidationTaskId = task.id;
      }

      return {
        success: true,
        signId,
        isPresent: false,
        creditsAwarded: 0,
        cooldownActive: false,
        revalidationTaskId,
        message: 'Sign reported as missing. High-priority revalidation task created.',
      };
    }
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
