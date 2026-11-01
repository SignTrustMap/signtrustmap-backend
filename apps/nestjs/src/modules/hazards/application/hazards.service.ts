import {
  Injectable,
  // NotFoundException,
  // BadRequestException,
  Logger,
  // ForbiddenException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
// import { randomUUID } from 'crypto';
import {
  RoadHazardEvent,
  HazardStatus,
} from '../infrastructure/persistence/road-hazard-event.entity';
import {
  HazardConfirmation,
  // HazardVoteType,
} from '../infrastructure/persistence/hazard-confirmation.entity';
// import { CreateHazardReportDto } from '../presentation/dto/create-hazard-report.dto';
// import { ConfirmHazardDto } from '../presentation/dto/confirm-hazard.dto';
// import { QueryHazardsDto } from '../presentation/dto/query-hazards.dto';
import { WalletService } from '../../wallet/application/wallet.service';
// import { TransactionType } from '../../wallet/infrastructure/persistence/credit-transaction.entity';
import { DailyTasksService } from '../../daily-tasks/daily-tasks.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { MinioStorageService } from '../../../integrations/minio/minio-storage.service';
// import { createHash } from 'crypto';
import { HazardEvidence /* , HazardEvidenceType */ } from '../infrastructure/persistence/hazard-evidence.entity';
// import { validateFileSignature } from '../../survey/domain/media-validator';
// import { MediaFileType, MEDIA_SIZE_LIMITS } from '../../survey/domain/submission-contract';

// const INITIAL_TTL_MINUTES = 45;
// const EXTENSION_TTL_MINUTES = 15;
// const MAX_TTL_MINUTES = 120;
// const DEDUPLICATION_RADIUS_METERS = 300;
// const CONSENSUS_THRESHOLD_K = 3;
// const DEFAULT_REPORT_REWARD = 10;
// const DEFAULT_CONFIRM_REWARD = 2;

export interface HazardEventResponse {
  id: string;
  reportedBy: string;
  hazardType: string;
  title: string | null;
  severity: string | null;
  description: string | null;
  status: HazardStatus;
  confirmationsCount: number;
  dismissalsCount: number;
  rewardPaid: boolean;
  latitude: number;
  longitude: number;
  distanceMeters?: number | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  isMerged?: boolean;
  evidence?: Array<{ id: string; mediaType: string; fileUrl: string; fileSizeBytes: number; contentType: string | null; uploadedAt: Date }>;
}

@Injectable()
export class HazardsService {
  private readonly logger = new Logger(HazardsService.name);

  constructor(
    @InjectRepository(RoadHazardEvent)
    private readonly hazardRepo: Repository<RoadHazardEvent>,
    @InjectRepository(HazardConfirmation)
    private readonly confirmRepo: Repository<HazardConfirmation>,
    private readonly dataSource: DataSource,
    private readonly walletService: WalletService,
    private readonly dailyTasksService: DailyTasksService,
    private readonly notificationsService: NotificationsService,
    @Optional() private readonly storageService?: MinioStorageService,
    @InjectRepository(HazardEvidence)
    @Optional() private readonly evidenceRepo?: Repository<HazardEvidence>,
  ) {}
// 
//   /**
//    * Report a roadside hazard with 300m PostGIS deduplication and micro-TTL initialization (45 min).
//    * If an active hazard exists within 300m, this request acts as an implicit confirmation.
//    */
//   async reportHazard(
//     userId: string,
//     dto: CreateHazardReportDto,
//   ): Promise<HazardEventResponse> {
//     const { hazardType, title, severity, latitude: lat, longitude: lon, description } = dto;
// 
//     if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
//       throw new BadRequestException('Invalid latitude or longitude');
//     }
// 
//     // 1. Spatial Deduplication Query: Active hazards within 300 meters
//     let existingRows: any[];
//     if (this.hazardRepo?.createQueryBuilder) {
//       try {
//         const qb = this.hazardRepo
//           .createQueryBuilder('h')
//           .select([
//             'h.id AS id',
//             'h.reported_by AS reported_by',
//             'h.hazard_type AS hazard_type',
//             'h.title AS title',
//             'h.severity AS severity',
//             'h.description AS description',
//             'h.status AS status',
//             'h.confirmations_count AS confirmations_count',
//             'h.dismissals_count AS dismissals_count',
//             'h.reward_paid AS reward_paid',
//             'h.expires_at AS expires_at',
//             'h.created_at AS created_at',
//             'h.updated_at AS updated_at',
//             'ST_Y(h.location::geometry) AS lat',
//             'ST_X(h.location::geometry) AS lon',
//             'ST_Distance(h.location::geography, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography) AS distance_meters',
//           ])
//           .where(
//             'ST_DWithin(h.location::geography, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography, :radius)',
//             { lon, lat, radius: DEDUPLICATION_RADIUS_METERS },
//           )
//           .andWhere("h.status IN ('UNCONFIRMED', 'CONFIRMED')")
//           .andWhere('h.expires_at > NOW()')
//           .orderBy('distance_meters', 'ASC')
//           .limit(1);
//         const qbRows = await qb.getRawMany();
//         existingRows = qbRows !== undefined && qbRows !== null ? qbRows : await this.dataSource.query(
//           `SELECT
//              id,
//              reported_by,
//              hazard_type, title, severity,
//              description,
//              status,
//              confirmations_count,
//              dismissals_count,
//              reward_paid,
//              expires_at,
//              created_at,
//              updated_at,
//              ST_Y(location::geometry) AS lat,
//              ST_X(location::geometry) AS lon,
//              ST_Distance(location::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS distance_meters
//            FROM road_hazard_events
//            WHERE ST_DWithin(location::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
//              AND status IN ('UNCONFIRMED', 'CONFIRMED')
//              AND expires_at > NOW()
//            ORDER BY distance_meters ASC
//            LIMIT 1`,
//           [lon, lat, DEDUPLICATION_RADIUS_METERS],
//         );
//       } catch {
//         existingRows = await this.dataSource.query(
//           `SELECT
//              id,
//              reported_by,
//              hazard_type, title, severity,
//              description,
//              status,
//              confirmations_count,
//              dismissals_count,
//              reward_paid,
//              expires_at,
//              created_at,
//              updated_at,
//              ST_Y(location::geometry) AS lat,
//              ST_X(location::geometry) AS lon,
//              ST_Distance(location::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS distance_meters
//            FROM road_hazard_events
//            WHERE ST_DWithin(location::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
//              AND status IN ('UNCONFIRMED', 'CONFIRMED')
//              AND expires_at > NOW()
//            ORDER BY distance_meters ASC
//            LIMIT 1`,
//           [lon, lat, DEDUPLICATION_RADIUS_METERS],
//         );
//       }
//     } else {
//       existingRows = await this.dataSource.query(
//         `SELECT
//            id,
//            reported_by,
//            hazard_type, title, severity,
//            description,
//            status,
//            confirmations_count,
//            dismissals_count,
//            reward_paid,
//            expires_at,
//            created_at,
//            updated_at,
//            ST_Y(location::geometry) AS lat,
//            ST_X(location::geometry) AS lon,
//            ST_Distance(location::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS distance_meters
//          FROM road_hazard_events
//          WHERE ST_DWithin(location::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)
//            AND status IN ('UNCONFIRMED', 'CONFIRMED')
//            AND expires_at > NOW()
//          ORDER BY distance_meters ASC
//          LIMIT 1`,
//         [lon, lat, DEDUPLICATION_RADIUS_METERS],
//       );
//     }
// 
//     if (existingRows.length > 0) {
//       const match = existingRows[0];
//       const hazardId = match.id;
// 
//       // Check if user already confirmed or reported this hazard
//       const existingVote = await this.confirmRepo.findOne({
//         where: { hazardId, userId },
//       });
// 
//       if (existingVote) {
//         return this.formatHazardRow(match, true);
//       }
// 
//       // Record implicit confirmation
//       if (this.confirmRepo?.createQueryBuilder) {
//         try {
//           const insertQb = this.confirmRepo.createQueryBuilder().insert();
//           if (typeof insertQb?.into === 'function') {
//             await insertQb
//               .into(HazardConfirmation)
//               .values({
//                 id: () => 'gen_random_uuid()',
//                 hazardId,
//                 userId,
//                 voteType: HazardVoteType.CONFIRM,
//                 location: () => `ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)`,
//                 createdAt: () => 'NOW()',
//               })
//               .execute();
//           } else {
//             throw new Error('insertQb.into not a function');
//           }
//         } catch {
//           await this.dataSource.query(
//             `INSERT INTO hazard_confirmations (id, hazard_id, user_id, vote_type, location, created_at)
//              VALUES (gen_random_uuid(), $1, $2, 'CONFIRM', ST_SetSRID(ST_MakePoint($3, $4), 4326), NOW())`,
//             [hazardId, userId, lon, lat],
//           );
//         }
//       } else {
//         await this.dataSource.query(
//           `INSERT INTO hazard_confirmations (id, hazard_id, user_id, vote_type, location, created_at)
//            VALUES (gen_random_uuid(), $1, $2, 'CONFIRM', ST_SetSRID(ST_MakePoint($3, $4), 4326), NOW())`,
//           [hazardId, userId, lon, lat],
//         );
//       }
// 
//       // Increment confirmations_count and extend TTL (+15 min up to 120 min max from creation)
//       if (this.hazardRepo?.createQueryBuilder) {
//         try {
//           const updateQb = this.hazardRepo.createQueryBuilder().update(RoadHazardEvent);
//           if (typeof updateQb?.set === 'function') {
//             await updateQb
//               .set({
//                 confirmationsCount: () => 'confirmations_count + 1',
//                 expiresAt: () => `LEAST(created_at + INTERVAL '${MAX_TTL_MINUTES} minutes', expires_at + INTERVAL '${EXTENSION_TTL_MINUTES} minutes')`,
//                 updatedAt: () => 'NOW()',
//               })
//               .where('id = :id', { id: hazardId })
//               .execute();
//           } else {
//             throw new Error('updateQb.set not a function');
//           }
//         } catch {
//           await this.dataSource.query(
//             `UPDATE road_hazard_events
//              SET confirmations_count = confirmations_count + 1,
//                  expires_at = LEAST(created_at + INTERVAL '${MAX_TTL_MINUTES} minutes', expires_at + INTERVAL '${EXTENSION_TTL_MINUTES} minutes'),
//                  updated_at = NOW()
//              WHERE id = $1`,
//             [hazardId],
//           );
//         }
//       } else {
//         await this.dataSource.query(
//           `UPDATE road_hazard_events
//            SET confirmations_count = confirmations_count + 1,
//                expires_at = LEAST(created_at + INTERVAL '${MAX_TTL_MINUTES} minutes', expires_at + INTERVAL '${EXTENSION_TTL_MINUTES} minutes'),
//                updated_at = NOW()
//            WHERE id = $1`,
//           [hazardId],
//         );
//       }
// 
//       try {
//         await this.dailyTasksService.recordProgress(userId, 'HAZARD', 1);
//       } catch (err: any) {
//         this.logger.warn(`Failed recording daily task for user ${userId}: ${err?.message}`);
//       }
// 
//       // Check consensus condition
//       await this.checkAndTriggerConsensus(hazardId);
// 
//       const updated = await this.getHazard(hazardId);
//       return { ...updated, isMerged: true };
//     }
// 
//     // 2. Create new road_hazard_events record
//     const hazardId = randomUUID();
//     if (this.hazardRepo?.createQueryBuilder) {
//       try {
//         const insertQb = this.hazardRepo.createQueryBuilder().insert();
//         if (typeof insertQb?.into === 'function') {
//           await insertQb
//             .into(RoadHazardEvent)
//             .values({
//               id: hazardId,
//               reportedBy: userId,
//               hazardType,
//               title: title ?? null,
//               severity: severity ?? null,
//               description: description ?? null,
//               location: () => `ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)`,
//               status: HazardStatus.UNCONFIRMED,
//               confirmationsCount: 1,
//               dismissalsCount: 0,
//               rewardPaid: false,
//               expiresAt: () => `NOW() + INTERVAL '${INITIAL_TTL_MINUTES} minutes'`,
//               createdAt: () => 'NOW()',
//               updatedAt: () => 'NOW()',
//             })
//             .execute();
//         } else {
//           throw new Error('insertQb.into not a function');
//         }
//       } catch {
//         await this.dataSource.query(
//           `INSERT INTO road_hazard_events
//              (id, reported_by, hazard_type, title, severity, description, location, status, confirmations_count, dismissals_count, reward_paid, expires_at, created_at, updated_at)
//            VALUES
//              ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326), 'UNCONFIRMED', 1, 0, false, NOW() + INTERVAL '${INITIAL_TTL_MINUTES} minutes', NOW(), NOW())`,
//           [hazardId, userId, hazardType, title ?? null, severity ?? null, description ?? null, lon, lat],
//         );
//       }
//     } else {
//       await this.dataSource.query(
//         `INSERT INTO road_hazard_events
//            (id, reported_by, hazard_type, title, severity, description, location, status, confirmations_count, dismissals_count, reward_paid, expires_at, created_at, updated_at)
//          VALUES
//            ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326), 'UNCONFIRMED', 1, 0, false, NOW() + INTERVAL '${INITIAL_TTL_MINUTES} minutes', NOW(), NOW())`,
//         [hazardId, userId, hazardType, title ?? null, severity ?? null, description ?? null, lon, lat],
//       );
//     }
// 
//     // Initial reporter also registers confirmation
//     if (this.confirmRepo?.createQueryBuilder) {
//       try {
//         const insertQb = this.confirmRepo.createQueryBuilder().insert();
//         if (typeof insertQb?.into === 'function') {
//           await insertQb
//             .into(HazardConfirmation)
//             .values({
//               id: () => 'gen_random_uuid()',
//               hazardId,
//               userId,
//               voteType: HazardVoteType.CONFIRM,
//               location: () => `ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)`,
//               createdAt: () => 'NOW()',
//             })
//             .execute();
//         } else {
//           throw new Error('insertQb.into not a function');
//         }
//       } catch {
//         await this.dataSource.query(
//           `INSERT INTO hazard_confirmations (id, hazard_id, user_id, vote_type, location, created_at)
//            VALUES (gen_random_uuid(), $1, $2, 'CONFIRM', ST_SetSRID(ST_MakePoint($3, $4), 4326), NOW())`,
//           [hazardId, userId, lon, lat],
//         );
//       }
//     } else {
//       await this.dataSource.query(
//         `INSERT INTO hazard_confirmations (id, hazard_id, user_id, vote_type, location, created_at)
//          VALUES (gen_random_uuid(), $1, $2, 'CONFIRM', ST_SetSRID(ST_MakePoint($3, $4), 4326), NOW())`,
//         [hazardId, userId, lon, lat],
//       );
//     }
// 
//     try {
//       await this.dailyTasksService.recordProgress(userId, 'HAZARD', 1);
//     } catch (err: any) {
//       this.logger.warn(`Failed recording daily task for user ${userId}: ${err?.message}`);
//     }
// 
//     return this.getHazard(hazardId);
//   }
// 
//   /**
//    * Vote to confirm or dismiss a roadside hazard.
//    * CONFIRM extends TTL (+15 min, max 120 min) and triggers consensus when K >= 3.
//    * DISMISS increments dismissal count; transitions to DISMISSED when dismissals > confirmations.
//    */
//   async confirmHazard(
//     hazardId: string,
//     userId: string,
//     dto: ConfirmHazardDto,
//   ): Promise<HazardEventResponse> {
//     const { voteType, latitude: lat, longitude: lon } = dto;
// 
//     let hazardRows: any[];
//     if (this.hazardRepo?.findOne) {
//       try {
//         const h = await this.hazardRepo.findOne({
//           where: { id: hazardId },
//           select: ['id', 'status', 'expiresAt', 'createdAt', 'confirmationsCount', 'dismissalsCount', 'rewardPaid'],
//         });
//         if (h) {
//           hazardRows = [{
//             id: h.id,
//             status: h.status,
//             expires_at: h.expiresAt,
//             created_at: h.createdAt,
//             confirmations_count: h.confirmationsCount,
//             dismissals_count: h.dismissalsCount,
//             reward_paid: h.rewardPaid,
//           }];
//         } else {
//           hazardRows = await this.dataSource.query(
//             `SELECT id, status, expires_at, created_at, confirmations_count, dismissals_count, reward_paid
//              FROM road_hazard_events
//              WHERE id = $1`,
//             [hazardId],
//           );
//         }
//       } catch {
//         hazardRows = await this.dataSource.query(
//           `SELECT id, status, expires_at, created_at, confirmations_count, dismissals_count, reward_paid
//            FROM road_hazard_events
//            WHERE id = $1`,
//           [hazardId],
//         );
//       }
//     } else {
//       hazardRows = await this.dataSource.query(
//         `SELECT id, status, expires_at, created_at, confirmations_count, dismissals_count, reward_paid
//          FROM road_hazard_events
//          WHERE id = $1`,
//         [hazardId],
//       );
//     }
// 
//     if (hazardRows.length === 0) {
//       throw new NotFoundException(`Hazard event ${hazardId} not found`);
//     }
// 
//     const hazard = hazardRows[0];
//     if (hazard.status === HazardStatus.DISMISSED || new Date(hazard.expires_at).getTime() <= Date.now()) {
//       throw new BadRequestException(`Hazard event ${hazardId} has expired or has been dismissed`);
//     }
// 
//     // Check unique voting constraint per user
//     const existing = await this.confirmRepo.findOne({
//       where: { hazardId, userId },
//     });
//     if (existing) {
//       throw new BadRequestException('You have already voted on this hazard');
//     }
// 
//     // Record confirmation vote
//     if (this.confirmRepo?.createQueryBuilder) {
//       try {
//         const insertQb = this.confirmRepo.createQueryBuilder().insert();
//         if (typeof insertQb?.into === 'function') {
//           await insertQb
//             .into(HazardConfirmation)
//             .values({
//               id: () => 'gen_random_uuid()',
//               hazardId,
//               userId,
//               voteType,
//               location: lat != null && lon != null ? () => `ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)` : null,
//               createdAt: () => 'NOW()',
//             })
//             .execute();
//         } else {
//           throw new Error('insertQb.into not a function');
//         }
//       } catch {
//         const locationSql =
//           lat != null && lon != null
//             ? 'ST_SetSRID(ST_MakePoint($3, $4), 4326)'
//             : 'NULL';
//         const params = lat != null && lon != null ? [hazardId, userId, lon, lat] : [hazardId, userId];
// 
//         await this.dataSource.query(
//           `INSERT INTO hazard_confirmations (id, hazard_id, user_id, vote_type, location, created_at)
//            VALUES (gen_random_uuid(), $1, $2, '${voteType}', ${locationSql}, NOW())`,
//           params,
//         );
//       }
//     } else {
//       const locationSql =
//         lat != null && lon != null
//           ? 'ST_SetSRID(ST_MakePoint($3, $4), 4326)'
//           : 'NULL';
//       const params = lat != null && lon != null ? [hazardId, userId, lon, lat] : [hazardId, userId];
// 
//       await this.dataSource.query(
//         `INSERT INTO hazard_confirmations (id, hazard_id, user_id, vote_type, location, created_at)
//          VALUES (gen_random_uuid(), $1, $2, '${voteType}', ${locationSql}, NOW())`,
//         params,
//       );
//     }
// 
//     if (voteType === HazardVoteType.CONFIRM) {
//       if (this.hazardRepo?.createQueryBuilder) {
//         try {
//           const updateQb = this.hazardRepo.createQueryBuilder().update(RoadHazardEvent);
//           if (typeof updateQb?.set === 'function') {
//             await updateQb
//               .set({
//                 confirmationsCount: () => 'confirmations_count + 1',
//                 expiresAt: () => `LEAST(created_at + INTERVAL '${MAX_TTL_MINUTES} minutes', expires_at + INTERVAL '${EXTENSION_TTL_MINUTES} minutes')`,
//                 updatedAt: () => 'NOW()',
//               })
//               .where('id = :id', { id: hazardId })
//               .execute();
//           } else {
//             throw new Error('updateQb.set not a function');
//           }
//         } catch {
//           await this.dataSource.query(
//             `UPDATE road_hazard_events
//              SET confirmations_count = confirmations_count + 1,
//                  expires_at = LEAST(created_at + INTERVAL '${MAX_TTL_MINUTES} minutes', expires_at + INTERVAL '${EXTENSION_TTL_MINUTES} minutes'),
//                  updated_at = NOW()
//              WHERE id = $1`,
//             [hazardId],
//           );
//         }
//       } else {
//         await this.dataSource.query(
//           `UPDATE road_hazard_events
//            SET confirmations_count = confirmations_count + 1,
//                expires_at = LEAST(created_at + INTERVAL '${MAX_TTL_MINUTES} minutes', expires_at + INTERVAL '${EXTENSION_TTL_MINUTES} minutes'),
//                updated_at = NOW()
//            WHERE id = $1`,
//           [hazardId],
//         );
//       }
// 
//       try {
//         await this.dailyTasksService.recordProgress(userId, 'HAZARD', 1);
//       } catch (err: any) {
//         this.logger.warn(`Failed recording daily task for user ${userId}: ${err?.message}`);
//       }
// 
//       await this.checkAndTriggerConsensus(hazardId);
//     } else {
//       // DISMISS
//       if (this.hazardRepo?.createQueryBuilder) {
//         try {
//           const updateQb = this.hazardRepo.createQueryBuilder().update(RoadHazardEvent);
//           if (typeof updateQb?.set === 'function') {
//             await updateQb
//               .set({
//                 dismissalsCount: () => 'dismissals_count + 1',
//                 status: () => "CASE WHEN (dismissals_count + 1) > confirmations_count THEN 'DISMISSED' ELSE status END",
//                 updatedAt: () => 'NOW()',
//               })
//               .where('id = :id', { id: hazardId })
//               .execute();
//           } else {
//             throw new Error('updateQb.set not a function');
//           }
//         } catch {
//           await this.dataSource.query(
//             `UPDATE road_hazard_events
//              SET dismissals_count = dismissals_count + 1,
//                  status = CASE WHEN (dismissals_count + 1) > confirmations_count THEN 'DISMISSED' ELSE status END,
//                  updated_at = NOW()
//              WHERE id = $1`,
//             [hazardId],
//           );
//         }
//       } else {
//         await this.dataSource.query(
//           `UPDATE road_hazard_events
//            SET dismissals_count = dismissals_count + 1,
//                status = CASE WHEN (dismissals_count + 1) > confirmations_count THEN 'DISMISSED' ELSE status END,
//                updated_at = NOW()
//            WHERE id = $1`,
//           [hazardId],
//         );
//       }
//     }
// 
//     return this.getHazard(hazardId);
//   }
// 
//   /**
//    * Check consensus threshold (K >= 3).
//    * When reached: update status to CONFIRMED, pay reporter + confirmers, notify reporter.
//    */
//   async checkAndTriggerConsensus(hazardId: string): Promise<boolean> {
//     let rows: any[];
//     if (this.hazardRepo?.findOne) {
//       try {
//         const h = await this.hazardRepo.findOne({
//           where: { id: hazardId },
//           select: ['id', 'reportedBy', 'hazardType', 'confirmationsCount', 'status', 'rewardPaid'],
//         });
//         if (h) {
//           rows = [{
//             id: h.id,
//             reported_by: h.reportedBy,
//             hazard_type: h.hazardType,
//             confirmations_count: h.confirmationsCount,
//             status: h.status,
//             reward_paid: h.rewardPaid,
//           }];
//         } else {
//           rows = await this.dataSource.query(
//             `SELECT id, reported_by, hazard_type, confirmations_count, status, reward_paid
//              FROM road_hazard_events
//              WHERE id = $1`,
//             [hazardId],
//           );
//         }
//       } catch {
//         rows = await this.dataSource.query(
//           `SELECT id, reported_by, hazard_type, confirmations_count, status, reward_paid
//            FROM road_hazard_events
//            WHERE id = $1`,
//           [hazardId],
//         );
//       }
//     } else {
//       rows = await this.dataSource.query(
//         `SELECT id, reported_by, hazard_type, confirmations_count, status, reward_paid
//          FROM road_hazard_events
//          WHERE id = $1`,
//         [hazardId],
//       );
//     }
// 
//     if (rows.length === 0) return false;
//     const hazard = rows[0];
// 
//     if (hazard.confirmations_count >= CONSENSUS_THRESHOLD_K && !hazard.reward_paid) {
//       // 1. Transition status to CONFIRMED and mark reward_paid = true
//       if (this.hazardRepo?.update) {
//         try {
//           await this.hazardRepo.update(hazardId, {
//             status: HazardStatus.CONFIRMED,
//             rewardPaid: true,
//             updatedAt: new Date(),
//           });
//         } catch {
//           await this.dataSource.query(
//             `UPDATE road_hazard_events
//              SET status = 'CONFIRMED',
//                  reward_paid = TRUE,
//                  updated_at = NOW()
//              WHERE id = $1`,
//             [hazardId],
//           );
//         }
//       } else {
//         await this.dataSource.query(
//           `UPDATE road_hazard_events
//            SET status = 'CONFIRMED',
//                reward_paid = TRUE,
//                updated_at = NOW()
//            WHERE id = $1`,
//           [hazardId],
//         );
//       }
// 
//       // 2. Resolve reward amounts from dynamic reward rules
//       const reportReward = await this.walletService.resolveRewardAmount(
//         TransactionType.HAZARD_REPORT_REWARD,
//         DEFAULT_REPORT_REWARD,
//       );
//       const confirmReward = await this.walletService.resolveRewardAmount(
//         TransactionType.HAZARD_CONFIRM_REWARD,
//         DEFAULT_CONFIRM_REWARD,
//       );
// 
//       // 3. Credit initial reporter
//       try {
//         await this.walletService.creditUser(
//           hazard.reported_by,
//           reportReward,
//           TransactionType.HAZARD_REPORT_REWARD,
//           'road_hazard_event',
//           hazardId,
//           `Roadside hazard verified by consensus (${hazard.hazard_type})`,
//         );
//       } catch (err: any) {
//         this.logger.warn(`Failed crediting reporter ${hazard.reported_by}: ${err?.message}`);
//       }
// 
//       // 4. Credit confirming peers (excluding initial reporter)
//       let confirmers: any[];
//       if (this.confirmRepo?.createQueryBuilder) {
//         try {
//           const qb = this.confirmRepo
//             .createQueryBuilder('c')
//             .select('DISTINCT c.user_id', 'user_id')
//             .where('c.hazard_id = :hazardId', { hazardId })
//             .andWhere('c.vote_type = :voteType', { voteType: HazardVoteType.CONFIRM })
//             .andWhere('c.user_id != :reportedBy', { reportedBy: hazard.reported_by });
//           const res = await qb.getRawMany();
//           confirmers = res !== undefined && res.length > 0 ? res : await this.dataSource.query(
//             `SELECT DISTINCT user_id
//              FROM hazard_confirmations
//              WHERE hazard_id = $1 AND vote_type = 'CONFIRM' AND user_id != $2`,
//             [hazardId, hazard.reported_by],
//           );
//         } catch {
//           confirmers = await this.dataSource.query(
//             `SELECT DISTINCT user_id
//              FROM hazard_confirmations
//              WHERE hazard_id = $1 AND vote_type = 'CONFIRM' AND user_id != $2`,
//             [hazardId, hazard.reported_by],
//           );
//         }
//       } else {
//         confirmers = await this.dataSource.query(
//           `SELECT DISTINCT user_id
//            FROM hazard_confirmations
//            WHERE hazard_id = $1 AND vote_type = 'CONFIRM' AND user_id != $2`,
//           [hazardId, hazard.reported_by],
//         );
//       }
// 
//       for (const c of confirmers) {
//         try {
//           await this.walletService.creditUser(
//             c.user_id,
//             confirmReward,
//             TransactionType.HAZARD_CONFIRM_REWARD,
//             'road_hazard_event',
//             hazardId,
//             `Roadside hazard confirmation bonus (${hazard.hazard_type})`,
//           );
//         } catch (err: any) {
//           this.logger.warn(`Failed crediting confirmer ${c.user_id}: ${err?.message}`);
//         }
//       }
// 
//       // 5. Notify initial reporter
//       try {
//         await this.notificationsService.create(
//           hazard.reported_by,
//           'HAZARD_CONFIRMED',
//           'Đã xác nhận cảnh báo nguy hiểm',
//           `Cảnh báo nguy hiểm (${hazard.hazard_type}) do bạn báo cáo đã được cộng đồng xác nhận (+${reportReward} credits).`,
//           'road_hazard_event',
//           hazardId,
//         );
//       } catch (err: any) {
//         this.logger.warn(`Failed sending notification: ${err?.message}`);
//       }
// 
//       await this.recordApprovedAnomalyMission(hazardId);
//       return true;
//     }
// 
//     await this.recordApprovedAnomalyMission(hazardId);
//     return false;
//   }
// 
//   private async recordApprovedAnomalyMission(hazardId: string): Promise<void> {
//     try {
//       let rows: Array<{ reported_by: string; status: string }>;
//       if (this.hazardRepo?.findOne) {
//         try {
//           const h = await this.hazardRepo.findOne({
//             where: { id: hazardId },
//             select: ['reportedBy', 'status'],
//           });
//           if (h) {
//             rows = [{ reported_by: h.reportedBy, status: h.status }];
//           } else {
//             rows = await this.dataSource.query(
//               'SELECT reported_by, status FROM road_hazard_events WHERE id = $1',
//               [hazardId],
//             );
//           }
//         } catch {
//           rows = await this.dataSource.query(
//             'SELECT reported_by, status FROM road_hazard_events WHERE id = $1',
//             [hazardId],
//           );
//         }
//       } else {
//         rows = await this.dataSource.query(
//           'SELECT reported_by, status FROM road_hazard_events WHERE id = $1',
//           [hazardId],
//         );
//       }
//       if (!rows.length || rows[0].status !== HazardStatus.CONFIRMED) return;
// 
//       let hasEvidence = false;
//       if (this.evidenceRepo?.count) {
//         try {
//           const count = await this.evidenceRepo.count({ where: { hazardId } });
//           hasEvidence = count > 0;
//         } catch {
//           const evidenceRows: Array<{ has_evidence: boolean }> = await this.dataSource.query(
//             'SELECT EXISTS (SELECT 1 FROM hazard_evidence WHERE hazard_id = $1) AS has_evidence',
//             [hazardId],
//           );
//           hasEvidence = Boolean(evidenceRows[0]?.has_evidence);
//         }
//       } else {
//         const evidenceRows: Array<{ has_evidence: boolean }> = await this.dataSource.query(
//           'SELECT EXISTS (SELECT 1 FROM hazard_evidence WHERE hazard_id = $1) AS has_evidence',
//           [hazardId],
//         );
//         hasEvidence = Boolean(evidenceRows[0]?.has_evidence);
//       }
//       if (!hasEvidence) return;
// 
//       await this.dailyTasksService.recordApprovedAnomaly(rows[0].reported_by, hazardId);
//     } catch (error: any) {
//       this.logger.warn(`Failed recording approved-anomaly mission for ${hazardId}: ${error?.message}`);
//     }
//   }
// 
//   /**
//    * Retrieve active hazards with optional bbox or spatial proximity radius filtering.
//    */
//   async listHazards(query: QueryHazardsDto) {
//     const page = Math.max(1, query.page ?? 1);
//     const pageSize = Math.min(Math.max(1, query.pageSize ?? 20), 100);
//     const skip = (page - 1) * pageSize;
// 
//     const qb = this.hazardRepo
//       .createQueryBuilder('h')
//       .where("h.status IN ('UNCONFIRMED', 'CONFIRMED')")
//       .andWhere('h.expires_at > NOW()');
// 
//     if (query.status) {
//       qb.andWhere('h.status = :status', { status: query.status });
//     }
// 
//     qb.select([
//       'h.id AS id',
//       'h.reported_by AS reported_by',
//       'h.hazard_type AS hazard_type',
//       'h.title AS title',
//       'h.severity AS severity',
//       'h.description AS description',
//       'h.status AS status',
//       'h.confirmations_count AS confirmations_count',
//       'h.dismissals_count AS dismissals_count',
//       'h.reward_paid AS reward_paid',
//       'h.expires_at AS expires_at',
//       'h.created_at AS created_at',
//       'h.updated_at AS updated_at',
//       'ST_Y(h.location::geometry) AS lat',
//       'ST_X(h.location::geometry) AS lon',
//     ]);
// 
//     if (query.lat != null && query.lon != null) {
//       const radius = query.radiusMeters ?? 10000;
//       qb.andWhere(
//         'ST_DWithin(h.location::geography, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography, :radius)',
//         { lon: query.lon, lat: query.lat, radius },
//       );
//       qb.addSelect(
//         'ST_Distance(h.location::geography, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography)',
//         'distance_meters',
//       );
//       qb.orderBy('distance_meters', 'ASC');
//     } else if (
//       query.minLat != null &&
//       query.minLon != null &&
//       query.maxLat != null &&
//       query.maxLon != null
//     ) {
//       qb.andWhere(
//         'ST_Within(h.location, ST_MakeEnvelope(:minLon, :minLat, :maxLon, :maxLat, 4326))',
//         {
//           minLon: query.minLon,
//           minLat: query.minLat,
//           maxLon: query.maxLon,
//           maxLat: query.maxLat,
//         },
//       );
//       qb.addSelect('NULL', 'distance_meters');
//       qb.orderBy('h.created_at', 'DESC');
//     } else {
//       qb.addSelect('NULL', 'distance_meters');
//       qb.orderBy('h.created_at', 'DESC');
//     }
// 
//     const total = await qb.getCount();
//     const rows = await qb.offset(skip).limit(pageSize).getRawMany();
// 
//     const items = rows.map((r) => this.formatHazardRow(r));
//     return {
//       items,
//       total,
//       page,
//       pageSize,
//       totalPages: Math.ceil(total / pageSize),
//     };
//   }
// 
//   /**
//    * Get single hazard detail
//    */
//   async getHazard(id: string): Promise<HazardEventResponse> {
//     let rows: any[];
//     if (this.hazardRepo?.createQueryBuilder) {
//       try {
//         const qb = this.hazardRepo
//           .createQueryBuilder('h')
//           .select([
//             'h.id AS id',
//             'h.reported_by AS reported_by',
//             'h.hazard_type AS hazard_type',
//             'h.title AS title',
//             'h.severity AS severity',
//             'h.description AS description',
//             'h.status AS status',
//             'h.confirmations_count AS confirmations_count',
//             'h.dismissals_count AS dismissals_count',
//             'h.reward_paid AS reward_paid',
//             'h.expires_at AS expires_at',
//             'h.created_at AS created_at',
//             'h.updated_at AS updated_at',
//             'ST_Y(h.location::geometry) AS lat',
//             'ST_X(h.location::geometry) AS lon',
//           ])
//           .where('h.id = :id', { id });
//         const raw = await qb.getRawOne();
//         rows = raw ? [raw] : await this.dataSource.query(
//           `SELECT
//              id,
//              reported_by,
//              hazard_type, title, severity,
//              description,
//              status,
//              confirmations_count,
//              dismissals_count,
//              reward_paid,
//              expires_at,
//              created_at,
//              updated_at,
//              ST_Y(location::geometry) AS lat,
//              ST_X(location::geometry) AS lon
//            FROM road_hazard_events
//            WHERE id = $1`,
//           [id],
//         );
//       } catch {
//         rows = await this.dataSource.query(
//           `SELECT
//              id,
//              reported_by,
//              hazard_type, title, severity,
//              description,
//              status,
//              confirmations_count,
//              dismissals_count,
//              reward_paid,
//              expires_at,
//              created_at,
//              updated_at,
//              ST_Y(location::geometry) AS lat,
//              ST_X(location::geometry) AS lon
//            FROM road_hazard_events
//            WHERE id = $1`,
//           [id],
//         );
//       }
//     } else {
//       rows = await this.dataSource.query(
//         `SELECT
//            id,
//            reported_by,
//            hazard_type, title, severity,
//            description,
//            status,
//            confirmations_count,
//            dismissals_count,
//            reward_paid,
//            expires_at,
//            created_at,
//            updated_at,
//            ST_Y(location::geometry) AS lat,
//            ST_X(location::geometry) AS lon
//          FROM road_hazard_events
//          WHERE id = $1`,
//         [id],
//       );
//     }
// 
//     if (rows.length === 0) {
//       throw new NotFoundException(`Hazard event ${id} not found`);
//     }
// 
//     const response = this.formatHazardRow(rows[0]);
//     response.evidence = await this.getEvidence(id);
//     return response;
//   }
// 
//   async uploadEvidence(userId: string, hazardId: string, mediaType: HazardEvidenceType, file: Express.Multer.File) {
//     if (!file?.buffer) throw new BadRequestException('Evidence file is required');
//     let hazardRows: any[];
//     if (this.hazardRepo?.findOne) {
//       try {
//         const h = await this.hazardRepo.findOne({
//           where: { id: hazardId },
//           select: ['id', 'reportedBy'],
//         });
//         if (h) {
//           hazardRows = [{ id: h.id, reported_by: h.reportedBy }];
//         } else {
//           hazardRows = await this.dataSource.query('SELECT id, reported_by FROM road_hazard_events WHERE id = $1', [hazardId]);
//         }
//       } catch {
//         hazardRows = await this.dataSource.query('SELECT id, reported_by FROM road_hazard_events WHERE id = $1', [hazardId]);
//       }
//     } else {
//       hazardRows = await this.dataSource.query('SELECT id, reported_by FROM road_hazard_events WHERE id = $1', [hazardId]);
//     }
//     if (!hazardRows.length) throw new NotFoundException(`Hazard event ${hazardId} not found`);
//     if (hazardRows[0].reported_by !== userId) throw new ForbiddenException('Only the report owner can attach evidence');
// 
//     const type = mediaType === HazardEvidenceType.IMAGE ? MediaFileType.IMAGE : MediaFileType.VIDEO;
//     const limits = MEDIA_SIZE_LIMITS[type];
//     if (file.size < limits.minBytes || file.size > limits.maxBytes) {
//       throw new BadRequestException(`Evidence file size is invalid for ${mediaType}`);
//     }
//     const signature = validateFileSignature(type, file.buffer);
//     if (!signature.valid) throw new BadRequestException(signature.error ?? 'Unsupported evidence format');
// 
//     const digest = createHash('sha256').update(file.buffer).digest('hex');
//     const bucket = this.storageService.bucketForMediaType(mediaType);
//     const safeName = (file.originalname || `${mediaType.toLowerCase()}.bin`).replace(/[^a-zA-Z0-9._-]/g, '_');
//     const objectName = `hazards/${hazardId}/${digest.slice(0, 16)}_${safeName}`;
//     const storageKey = `${bucket}/${objectName}`;
//     const existing = await this.evidenceRepo.findOne({ where: { hazardId, storageKey } });
//     if (existing) {
//       await this.recordApprovedAnomalyMission(hazardId);
//       return this.serializeEvidence(existing);
//     }
//     await this.storageService.putObject(bucket, objectName, file.buffer, file.mimetype);
//     const evidence = this.evidenceRepo.create({
//       hazardId,
//       uploadedBy: userId,
//       mediaType,
//       fileUrl: storageKey,
//       storageKey,
//       fileSizeBytes: String(file.size),
//       contentType: file.mimetype || null,
//     });
//     try {
//       const saved = await this.evidenceRepo.save(evidence);
//       await this.recordApprovedAnomalyMission(hazardId);
//       return this.serializeEvidence(saved);
//     } catch (error) {
//       // A concurrent identical upload may have committed the same unique row.
//       // Never remove an object that an existing evidence row now references.
//       const committed = await this.evidenceRepo.findOne({ where: { hazardId, storageKey } }).catch(() => null);
//       if (committed) {
//         await this.recordApprovedAnomalyMission(hazardId);
//         return this.serializeEvidence(committed);
//       }
//       await this.storageService.removeObject({ bucket, objectName }).catch(() => undefined);
//       throw error;
//     }
//   }
// 
//   private async getEvidence(hazardId: string) {
//     if (!this.evidenceRepo) return [];
//     const rows = (await this.evidenceRepo.find({ where: { hazardId }, order: { uploadedAt: 'ASC' } })) ?? [];
//     return Promise.all(rows.map((row) => this.serializeEvidence(row)));
//   }
// 
//   private async serializeEvidence(row: HazardEvidence) {
//     const separator = row.storageKey.indexOf('/');
//     const bucket = separator >= 0 ? row.storageKey.slice(0, separator) : row.storageKey;
//     const objectName = separator >= 0 ? row.storageKey.slice(separator + 1) : '';
//     const fileUrl = await this.storageService.presignedGetObject(bucket, objectName, 3600);
//     return { id: row.id, mediaType: row.mediaType, fileUrl, fileSizeBytes: Number(row.fileSizeBytes), contentType: row.contentType, uploadedAt: row.uploadedAt };
//   }
// 
//   private formatHazardRow(row: any, isMerged = false): HazardEventResponse {
//     return {
//       id: row.id,
//       reportedBy: row.reported_by,
//       hazardType: row.hazard_type,
//       title: row.title ?? null,
//       severity: row.severity ?? null,
//       description: row.description,
//       status: row.status as HazardStatus,
//       confirmationsCount: Number(row.confirmations_count),
//       dismissalsCount: Number(row.dismissals_count),
//       rewardPaid: Boolean(row.reward_paid),
//       latitude: Number(row.lat),
//       longitude: Number(row.lon),
//       distanceMeters:
//         row.distance_meters != null
//           ? Math.round(Number(row.distance_meters) * 10) / 10
//           : null,
//       expiresAt: row.expires_at,
//       createdAt: row.created_at,
//       updatedAt: row.updated_at,
//       isMerged,
//     };
//   }
}
