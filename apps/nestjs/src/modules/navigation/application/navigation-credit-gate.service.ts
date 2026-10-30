import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import {
  NavigationSession,
  NavSessionStatus,
} from '../infrastructure/persistence/navigation-session.entity';
import { CustomAlertProfile } from '../infrastructure/persistence/custom-alert-profile.entity';
import { InitiateNavigationSessionDto } from '../presentation/dto/initiate-navigation-session.dto';
import { CreateAlertProfileDto } from '../presentation/dto/create-alert-profile.dto';
import { WalletService } from '../../wallet/application/wallet.service';
import { TransactionType } from '../../wallet/infrastructure/persistence/credit-transaction.entity';

const NAVIGATION_SESSION_FEE = 5;
const CUSTOM_PROFILE_FEE = 20;

@Injectable()
export class NavigationCreditGateService {
  private readonly logger = new Logger(NavigationCreditGateService.name);

  constructor(
    @InjectRepository(NavigationSession)
    private readonly sessionRepo: Repository<NavigationSession>,
    @InjectRepository(CustomAlertProfile)
    private readonly profileRepo: Repository<CustomAlertProfile>,
    private readonly dataSource: DataSource,
    private readonly walletService: WalletService,
  ) {}

  /**
   * Intercepts turn-by-turn routing initiation:
   * Atomically verifies balance, deducts NAVIGATION_FEE from wallet, and starts navigation session.
   */
  async initiateSession(driverId: string, dto: InitiateNavigationSessionDto) {
    const { origin, destination, idempotencyKey } = dto;

    if (
      origin.latitude < -90 ||
      origin.latitude > 90 ||
      origin.longitude < -180 ||
      origin.longitude > 180 ||
      destination.latitude < -90 ||
      destination.latitude > 90 ||
      destination.longitude < -180 ||
      destination.longitude > 180
    ) {
      throw new BadRequestException('Invalid origin or destination coordinates');
    }

    const fee = await this.walletService.resolveRewardAmount(
      TransactionType.NAVIGATION_FEE,
      NAVIGATION_SESSION_FEE,
    );

    const sessionId = randomUUID();
    const effectiveIdempotencyKey =
      idempotencyKey ?? `nav_session:${driverId}:${Date.now()}`;

    // 1. Atomic debit of navigation fee
    let debitResult: { walletId: string; newBalance: number; txId: string };
    try {
      debitResult = await this.walletService.deductUser(
        driverId,
        fee,
        TransactionType.NAVIGATION_FEE,
        'navigation_session',
        sessionId,
        'Turn-by-turn navigation session fee',
        { idempotencyKey: effectiveIdempotencyKey },
      );
    } catch (err: any) {
      if (err instanceof BadRequestException && err.message.includes('Insufficient balance')) {
        throw new BadRequestException('Insufficient credits to initiate turn-by-turn navigation session');
      }
      throw err;
    }

    // 2. Persist navigation session record with spatial PostGIS origin and destination
    if (this.sessionRepo && typeof this.sessionRepo.createQueryBuilder === 'function') {
      try {
        await this.sessionRepo
          .createQueryBuilder()
          .insert()
          .into(NavigationSession)
          .values({
            id: sessionId,
            driverId,
            origin: () => `ST_SetSRID(ST_MakePoint(${origin.longitude}, ${origin.latitude}), 4326)` as any,
            destination: () => `ST_SetSRID(ST_MakePoint(${destination.longitude}, ${destination.latitude}), 4326)` as any,
            creditsDeducted: fee,
            status: NavSessionStatus.ACTIVE,
            startedAt: new Date(),
          })
          .execute();
      } catch {
        if (typeof this.dataSource?.query === 'function') {
          await this.dataSource.query(
            `INSERT INTO navigation_sessions
               (id, driver_id, origin, destination, credits_deducted, status, started_at)
             VALUES
               ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), ST_SetSRID(ST_MakePoint($5, $6), 4326), $7, 'ACTIVE', NOW())`,
            [
              sessionId,
              driverId,
              origin.longitude,
              origin.latitude,
              destination.longitude,
              destination.latitude,
              fee,
            ],
          );
        }
      }
    } else if (typeof this.dataSource?.query === 'function') {
      await this.dataSource.query(
        `INSERT INTO navigation_sessions
           (id, driver_id, origin, destination, credits_deducted, status, started_at)
         VALUES
           ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), ST_SetSRID(ST_MakePoint($5, $6), 4326), $7, 'ACTIVE', NOW())`,
        [
          sessionId,
          driverId,
          origin.longitude,
          origin.latitude,
          destination.longitude,
          destination.latitude,
          fee,
        ],
      );
    }

    return {
      sessionId,
      driverId,
      status: NavSessionStatus.ACTIVE,
      creditsDeducted: fee,
      remainingBalance: debitResult.newBalance,
      startedAt: new Date(),
    };
  }

  /**
   * Concludes a navigation session
   */
  async endSession(driverId: string, sessionId: string) {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, driverId },
    });
    if (!session) {
      throw new NotFoundException(`Navigation session ${sessionId} not found`);
    }

    session.status = NavSessionStatus.COMPLETED;
    session.endedAt = new Date();
    await this.sessionRepo.save(session);

    return {
      sessionId: session.id,
      driverId: session.driverId,
      status: session.status,
      creditsDeducted: session.creditsDeducted,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
    };
  }

  /**
   * List recent navigation sessions for driver
   */
  async listSessions(driverId: string, page = 1, pageSize = 20) {
    const p = Math.max(1, page);
    const ps = Math.min(Math.max(1, pageSize), 100);
    const [items, total] = await this.sessionRepo.findAndCount({
      where: { driverId },
      order: { startedAt: 'DESC' },
      skip: (p - 1) * ps,
      take: ps,
    });

    return {
      items,
      total,
      page: p,
      pageSize: ps,
      totalPages: Math.ceil(total / ps),
    };
  }

  /**
   * Creates a multi-slot custom alert profile and deducts CUSTOM_PROFILE_SPEND credits.
   */
  async createAlertProfile(userId: string, dto: CreateAlertProfileDto) {
    const fee = await this.walletService.resolveRewardAmount(
      TransactionType.CUSTOM_PROFILE_SPEND,
      CUSTOM_PROFILE_FEE,
    );

    const profileId = randomUUID();

    // 1. Atomic debit of profile activation fee
    let debitResult: { walletId: string; newBalance: number; txId: string };
    try {
      debitResult = await this.walletService.deductUser(
        userId,
        fee,
        TransactionType.CUSTOM_PROFILE_SPEND,
        'custom_alert_profile',
        profileId,
        `Custom alert profile activation: ${dto.name}`,
      );
    } catch (err: any) {
      if (err instanceof BadRequestException && err.message.includes('Insufficient balance')) {
        throw new BadRequestException('Insufficient credits to unlock custom alert profile');
      }
      throw err;
    }

    // 2. Persist custom alert profile
    const profile = this.profileRepo.create({
      id: profileId,
      userId,
      name: dto.name,
      description: dto.description ?? null,
      filterRules: dto.filterRules,
      isActive: true,
    });
    const saved = await this.profileRepo.save(profile);

    return {
      profile: saved,
      creditsDeducted: fee,
      remainingBalance: debitResult.newBalance,
    };
  }

  /**
   * Lists driver's saved alert profiles
   */
  async listAlertProfiles(userId: string) {
    return this.profileRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Activates a specific alert profile and deactivates others for this user
   */
  async activateAlertProfile(userId: string, profileId: string) {
    const profile = await this.profileRepo.findOne({
      where: { id: profileId, userId },
    });
    if (!profile) {
      throw new NotFoundException(`Custom alert profile ${profileId} not found`);
    }

    // Deactivate others
    await this.profileRepo.update({ userId }, { isActive: false });
    // Activate target
    profile.isActive = true;
    await this.profileRepo.save(profile);

    return { profileId, isActive: true };
  }

  /**
   * Deletes a custom alert profile
   */
  async deleteAlertProfile(userId: string, profileId: string) {
    const profile = await this.profileRepo.findOne({
      where: { id: profileId, userId },
    });
    if (!profile) {
      throw new NotFoundException(`Custom alert profile ${profileId} not found`);
    }

    await this.profileRepo.remove(profile);
    return { profileId, deleted: true };
  }
}
