import { Injectable, NotFoundException, BadRequestException, ForbiddenException, HttpException, HttpStatus, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager, In } from 'typeorm';
import { RevalidationDecision, RevalDecision } from '../infrastructure/persistence/revalidation-decision.entity';
import { RevalidationEvidence } from '../infrastructure/persistence/revalidation-evidence.entity';
import { RevalidationTask, TaskPriority, TaskStatus } from '../infrastructure/persistence/revalidation-task.entity';
import { FreshnessRule } from '../infrastructure/persistence/freshness-rule.entity';
import { MinioStorageService } from '../../../integrations/minio/minio-storage.service';
import { WalletService } from '../../wallet/application/wallet.service';
import { TransactionType } from '../../wallet/infrastructure/persistence/credit-transaction.entity';
import { NotificationsService } from '../../notifications/notifications.service';
import { DailyTasksService } from '../../daily-tasks/daily-tasks.service';
import { randomUUID } from 'crypto';
import { AiInferenceService, EarlyClassificationResult } from '../../../integrations/ai-inference/ai-inference.service';

const DEFAULT_MIN_VOTES_REQUIRED = 1;
const DEFAULT_MAX_PROXIMITY_METERS = 50;
const DEFAULT_DAILY_SUBMISSION_LIMIT = 3;

interface RevalDecisionRow {
  decision: string;
  reviewer_id: string;
  evidence_id: string;
  suggested_sign_type_id: number | null;
}

interface EvidenceRow {
  id: string;
  user_id: string;
  media_url?: string;
  evidence_type?: string;
  submitted_at?: Date | string;
  latitude?: number | string | null;
  longitude?: number | string | null;
}

export interface RevalidationConsensusSummary {
  evaluated: boolean;
  reason?: string;
  totalVotes?: number;
  minVotesRequired?: number;
  winningDecision?: string;
  voteCounts?: Record<string, number>;
  signAction?: string;
  escalatedToModeration?: boolean;
  creditedSubmitters?: number;
  creditedReviewers?: number;
  rewardPerSubmitter?: number;
  taskId?: string;
  earlyClassification?: EarlyClassificationResult | null;
}

@Injectable()
export class RevalidationService {
  private readonly logger = new Logger(RevalidationService.name);
  constructor(
    @InjectRepository(RevalidationTask) private tasks: Repository<RevalidationTask>,
    @InjectRepository(RevalidationEvidence) private evidences: Repository<RevalidationEvidence>,
    @InjectRepository(RevalidationDecision) private decisions: Repository<RevalidationDecision>,
    private readonly dataSource: DataSource,
    private readonly storage: MinioStorageService,
    private readonly walletService: WalletService,
    private readonly notificationsService: NotificationsService,
    @InjectRepository(FreshnessRule) private readonly freshnessRules?: Repository<FreshnessRule>,
    @Optional() private readonly dailyTasksService?: DailyTasksService,
    @Optional() private readonly aiInferenceService?: AiInferenceService,
  ) {}
  async listTasks(
    page = 1,
    pageSize = 20,
    status?: string,
    sort?: string,
    spatial?: { lat: number; lon: number; radiusMeters?: number },
  ) {
    const p = Math.max(1, page),
      ps = Math.min(Math.max(1, pageSize), 100);

    if (spatial && spatial.lat != null && spatial.lon != null) {
      const radius = spatial.radiusMeters ?? 5000;
      const conditions: string[] = ['vts.location IS NOT NULL'];
      const params: any[] = [spatial.lon, spatial.lat, radius];
      conditions.push(
        `ST_DWithin(vts.location::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)`,
      );

      if (status && status.toUpperCase() !== 'ALL') {
        conditions.push(`rt.status = $${params.length + 1}::task_status`);
        params.push(status);
      } else if (!status) {
        conditions.push(`rt.status IN ('OPEN', 'EVALUATING')`);
      }

      const whereClause = 'WHERE ' + conditions.join(' AND ');
      const countRows: any[] = await this.dataSource.query(
        `SELECT COUNT(*)::int AS cnt 
         FROM revalidation_tasks rt 
         JOIN verified_traffic_signs vts ON vts.id = rt.verified_sign_id 
         ${whereClause}`,
        params,
      );
      const total = countRows[0]?.cnt ?? 0;

      const orderClause =
        sort === 'reward'
          ? 'rt.reward_credits DESC'
          : sort === 'urgency'
            ? 'rt.urgency DESC'
            : 'distance_meters ASC';

      const rows: any[] = await this.dataSource.query(
        `SELECT rt.id,
                rt.verified_sign_id AS "signId",
                rt.reward_credits AS bounty,
                rt.reward_credits AS "rewardCredits",
                rt.urgency,
                rt.priority,
                rt.status,
                rt.expired_at AS "expiresAt",
                rt.created_at AS "createdAt",
                ST_Y(vts.location::geometry) AS lat,
                ST_X(vts.location::geometry) AS lon,
                ST_Distance(vts.location::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS distance_meters
         FROM revalidation_tasks rt
         JOIN verified_traffic_signs vts ON vts.id = rt.verified_sign_id
         ${whereClause}
         ORDER BY ${orderClause}
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, ps, (p - 1) * ps],
      );

      const items = rows.map((r) => ({
        id: r.id,
        signId: r.signId,
        location: { lat: Number(r.lat), lon: Number(r.lon) },
        urgency: Number(r.urgency ?? 0.0),
        bounty: Number(r.bounty ?? 10),
        priority: r.priority,
        status: r.status,
        expiresAt: r.expiresAt,
        distanceMeters: Math.round(Number(r.distance_meters ?? 0)),
      }));

      return { items, total, page: p, pageSize: ps, totalPages: Math.ceil(total / ps) };
    }

    const conditions: string[] = ['vts.location IS NOT NULL'];
    const params: any[] = [];
    let idx = 1;
    if (status && status.toUpperCase() !== 'ALL') {
      conditions.push(`rt.status = $${idx++}::task_status`);
      params.push(status);
    } else if (!status) {
      conditions.push(`rt.status IN ('OPEN', 'EVALUATING')`);
    }
    const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const countRows: any[] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS cnt FROM revalidation_tasks rt JOIN verified_traffic_signs vts ON vts.id = rt.verified_sign_id ${whereClause}`,
      params,
    );
    const total = countRows[0]?.cnt ?? 0;
    const orderClause =
      sort === 'reward'
        ? 'rt.reward_credits DESC'
        : sort === 'urgency'
          ? 'rt.urgency DESC'
          : 'rt.created_at DESC';

    const rows: any[] = await this.dataSource.query(
      `SELECT rt.*, vts.sign_type_id, vts.status AS sign_status, vts.freshness_score,
              ST_X(vts.location::geometry) AS longitude, ST_Y(vts.location::geometry) AS latitude,
              vts.sign_crop_url, tst.sign_code, tst.name_en, tst.name_vi
       FROM revalidation_tasks rt
       JOIN verified_traffic_signs vts ON vts.id = rt.verified_sign_id
       LEFT JOIN traffic_sign_types tst ON tst.id = vts.sign_type_id
       ${whereClause}
       ORDER BY ${orderClause}
       LIMIT $${idx++} OFFSET $${idx}`,
      [...params, ps, (p - 1) * ps],
    );
    return { items: rows, total, page: p, pageSize: ps, totalPages: Math.ceil(total / ps) };
  }

  async listTasksInBbox(q: {
    minLat?: number;
    minLon?: number;
    maxLat?: number;
    maxLon?: number;
    status?: string;
    priority?: string;
    page?: number;
    pageSize?: number;
  }) {
    const p = Math.max(1, q.page ?? 1),
      ps = Math.min(Math.max(1, q.pageSize ?? 20), 100);
    const conditions: string[] = ['vts.location IS NOT NULL'];
    const params: any[] = [];
    let idx = 1;
    // bbox via ST_Within on verified_traffic_signs.location if coordinates provided
    if (
      q.minLon != null && q.minLat != null && q.maxLon != null && q.maxLat != null &&
      !Number.isNaN(q.minLon) && !Number.isNaN(q.minLat) && !Number.isNaN(q.maxLon) && !Number.isNaN(q.maxLat)
    ) {
      conditions.push(`ST_Within(vts.location, ST_MakeEnvelope($${idx++}, $${idx++}, $${idx++}, $${idx++}, 4326))`);
      params.push(q.minLon, q.minLat, q.maxLon, q.maxLat);
    }
    if (q.status && q.status.toUpperCase() !== 'ALL') {
      conditions.push(`rt.status = $${idx++}::task_status`);
      params.push(q.status);
    } else if (!q.status) {
      conditions.push(`rt.status IN ('OPEN', 'EVALUATING')`);
    }
    if (q.priority) {
      conditions.push(`rt.priority = $${idx++}::task_priority`);
      params.push(q.priority);
    }
    const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const countRows: any[] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS cnt FROM revalidation_tasks rt JOIN verified_traffic_signs vts ON vts.id = rt.verified_sign_id ${whereClause}`,
      params,
    );
    const total = countRows[0]?.cnt ?? 0;
    const rows: any[] = await this.dataSource.query(
      `SELECT rt.*, vts.sign_type_id, vts.status AS sign_status, vts.freshness_score,
              ST_X(vts.location::geometry) AS longitude, ST_Y(vts.location::geometry) AS latitude,
              vts.sign_crop_url, tst.sign_code, tst.name_en, tst.name_vi
       FROM revalidation_tasks rt
       JOIN verified_traffic_signs vts ON vts.id = rt.verified_sign_id
       LEFT JOIN traffic_sign_types tst ON tst.id = vts.sign_type_id
       ${whereClause}
       ORDER BY rt.created_at DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      [...params, ps, (p - 1) * ps],
    );
    return { items: rows, total, page: p, pageSize: ps, totalPages: Math.ceil(total / ps) };
  }

  toS3Url(rawUrl?: string | null, taskId?: string): string {
    if (!rawUrl) return '';
    if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
      return rawUrl;
    }
    let objectKey = rawUrl;
    if (
      rawUrl.startsWith('file:') ||
      rawUrl.startsWith('content:') ||
      rawUrl.startsWith('device:') ||
      rawUrl.startsWith('/')
    ) {
      const clean = rawUrl.replace(/^(?:file:\/\/(?:\/)?|content:\/\/|device:\/\/)?/, '');
      const filename = clean.split('/').pop()?.split('?')[0] || `${randomUUID()}.jpg`;
      objectKey = taskId ? `revalidation/${taskId}/${filename}` : `revalidation/${filename}`;
    }
    if (this.storage && typeof this.storage.getPublicUrl === 'function') {
      return this.storage.getPublicUrl('stm-sign-crops', objectKey);
    }
    const cleanObject = objectKey.replace(/^\/+/, '');
    const cleanKey = cleanObject.startsWith('stm-sign-crops/')
      ? cleanObject
      : `stm-sign-crops/${cleanObject}`;
    return `https://s3.signmap.site/${cleanKey}`;
  }

  async getTask(id: string) {
    const t = await this.tasks.findOne({ where: { id } });
    if (!t) throw new NotFoundException('RevalidationTask ' + id + ' not found');
    const evs: any[] = await this.dataSource.query(
      'SELECT id, task_id, user_id, media_url, evidence_type, submitted_at, ST_AsText(location) as location_wkt FROM revalidation_evidences WHERE task_id=$1 ORDER BY submitted_at ASC',
      [id],
    );
    const evsWithS3 = evs.map((e) => ({
      ...e,
      media_url: this.toS3Url(e.media_url, e.task_id),
      mediaUrl: this.toS3Url(e.media_url, e.task_id),
    }));
    let location: { lat: number; lon: number } | null = null;
    try {
      const sRows: any[] = await this.dataSource.query(
        'SELECT ST_Y(location::geometry) as lat, ST_X(location::geometry) as lon FROM verified_traffic_signs WHERE id=$1',
        [t.verifiedSignId],
      );
      if (sRows.length && sRows[0].lat != null && sRows[0].lon != null) {
        location = { lat: Number(sRows[0].lat), lon: Number(sRows[0].lon) };
      }
    } catch {}
    return { ...t, bounty: t.rewardCredits, location, evidences: evsWithS3 };
  }
  private assertDecision(v: string): RevalDecision {
    const allowed = Object.values(RevalDecision);
    if (!allowed.includes(v as RevalDecision)) throw new BadRequestException('decision must be one of ' + allowed.join(', ') + ', got "' + v + '"');
    return v as RevalDecision;
  }

  /**
   * Scenario #3 — on-site evidence submission with PostGIS proximity
   * guardrail and a daily per-task rate limit (see plan §3 & §6.1).
   */
  async submitEvidence(
    taskId: string,
    userId: string,
    dto: { mediaUrl?: string; latitude: number; longitude: number; evidenceType?: string },
    file?: Express.Multer.File,
  ) {
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException('RevalidationTask ' + taskId + ' not found');
    if (task.status !== TaskStatus.OPEN && task.status !== TaskStatus.EVALUATING) throw new BadRequestException('Task ' + taskId + ' is not open for new evidence (status=' + task.status + ')');
    const lat = dto.latitude, lon = dto.longitude;
    if (typeof lat !== 'number' || typeof lon !== 'number' || lat < -90 || lat > 90 || lon < -180 || lon > 180) throw new BadRequestException('Invalid latitude/longitude');

    // ---- GPS proximity guardrail (PostGIS) ----
    const { maxProximityMeters } = await this.resolveRuleLimits(task);
    const distanceRows: any[] = await this.dataSource.query(
      `SELECT ST_DistanceSphere(
                ST_SetSRID(ST_MakePoint($1, $2), 4326),
                vts.location
              ) AS distance_meters
       FROM revalidation_tasks rt
       JOIN verified_traffic_signs vts ON vts.id = rt.verified_sign_id
       WHERE rt.id = $3`,
      [lon, lat, taskId],
    );
    const distanceMeters = distanceRows.length > 0 ? Number(distanceRows[0].distance_meters) : null;
    if (distanceMeters == null || Number.isNaN(distanceMeters)) throw new BadRequestException('Cannot verify distance: target sign has no location');
    if (distanceMeters > maxProximityMeters) {
      throw new BadRequestException(`Submitted evidence is too far from target sign (distance: ${Math.round(distanceMeters)}m, max allowed: ${maxProximityMeters}m)`);
    }

    // ---- Daily submission limit (anti spam / sybil bounty abuse) ----
    const { dailySubmissionLimit } = await this.resolveRuleLimits(task);
    const recentRows: any[] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS cnt
       FROM revalidation_evidences
       WHERE task_id = $1 AND submitted_at >= now() - interval '24 hours'`,
      [taskId],
    );
    const recentCount = recentRows[0]?.cnt ?? 0;
    if (recentCount >= dailySubmissionLimit) {
      throw new HttpException(`Daily submission limit of ${dailySubmissionLimit} evidences per task exceeded (last 24h: ${recentCount})`, HttpStatus.TOO_MANY_REQUESTS);
    }

    let mediaUrl = dto.mediaUrl ?? null;
    if (file) {
      const key = 'revalidation/' + taskId + '/' + randomUUID() + '-' + file.originalname;
      await this.storage.putObject('stm-sign-crops', key, file.buffer, file.mimetype);
      mediaUrl = this.toS3Url(key, taskId);
    } else if (mediaUrl) {
      mediaUrl = this.toS3Url(mediaUrl, taskId);
    }
    if (!mediaUrl) throw new BadRequestException('Provide mediaUrl or upload a file');
    const evidenceType = dto.evidenceType === 'REMOVED'
      ? 'REMOVED'
      : dto.evidenceType === 'CHANGED'
        ? 'CHANGED'
        : 'STILL_ACTIVE';
    const id = randomUUID();
    await this.dataSource.transaction(async (manager) => {
      const lockedTasks: any[] = await manager.query(
        `SELECT status
         FROM revalidation_tasks
         WHERE id = $1
         FOR UPDATE`,
        [taskId],
      );
      if (!lockedTasks[0]) throw new NotFoundException('RevalidationTask ' + taskId + ' not found');
      if (![TaskStatus.OPEN, TaskStatus.EVALUATING].includes(lockedTasks[0].status)) {
        throw new BadRequestException('Task ' + taskId + ' is not open for new evidence (status=' + lockedTasks[0].status + ')');
      }
      const lockedRecentRows: any[] = await manager.query(
        `SELECT COUNT(*)::int AS cnt
         FROM revalidation_evidences
         WHERE task_id = $1 AND submitted_at >= now() - interval '24 hours'`,
        [taskId],
      );
      const lockedRecentCount = Number(lockedRecentRows[0]?.cnt ?? 0);
      if (lockedRecentCount >= dailySubmissionLimit) {
        throw new HttpException(
          `Daily submission limit of ${dailySubmissionLimit} evidences per task exceeded (last 24h: ${lockedRecentCount})`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      await manager.query(
        `INSERT INTO revalidation_evidences
           (id, task_id, user_id, media_url, location, evidence_type)
         VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326), $7)`,
        [id, taskId, userId, mediaUrl, lon, lat, evidenceType],
      );
      if (lockedTasks[0].status === TaskStatus.OPEN) {
        await manager.query(
          `UPDATE revalidation_tasks
           SET status = 'EVALUATING'
           WHERE id = $1 AND status = 'OPEN'`,
          [taskId],
        );
      }
    });
    if (this.dailyTasksService) {
      this.dailyTasksService.recordProgress(userId, 'REVALIDATE', 1).catch(() => {});
    }

    if (evidenceType === 'CHANGED' && mediaUrl && this.aiInferenceService) {
      this.aiInferenceService
        .classifyEarly({
          mediaUrl,
          signId: task.verifiedSignId,
          taskId: task.id,
        })
        .then((aiResult) => {
          if (aiResult) {
            this.logger.log(
              `Early classification dispatched for CHANGED evidence on task ${taskId}: class=${aiResult.className}, code=${aiResult.standardCode}, conf=${aiResult.confidence}`,
            );
          }
        })
        .catch((err) => {
          this.logger.warn(`Early classification on CHANGED evidence failed for task ${taskId}: ${err?.message}`);
        });
    }

    const saved = await this.evidences.findOne({ where: { id } });
    return {
      ...(saved ?? { id, taskId, userId, mediaUrl, evidenceType, latitude: lat, longitude: lon }),
      mediaUrl,
      latitude: lat,
      longitude: lon,
      evidenceType,
      distanceMeters: Math.round(distanceMeters * 100) / 100,
      maxProximityMeters,
      dailySubmissionLimit,
      remainingDailySubmissions: Math.max(0, dailySubmissionLimit - (recentCount + 1)),
    };
  }
  async listEvidencesForTask(taskId: string) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(taskId);
    if (!isUuid) return [];
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (!task) {
      const signTasks = await this.tasks.findOne({ where: { verifiedSignId: taskId } });
      if (signTasks) {
        return this.listEvidencesForSign(taskId);
      }
      throw new NotFoundException('RevalidationTask ' + taskId + ' not found');
    }
    const rows: any[] = await this.dataSource.query('SELECT id, task_id, user_id, media_url, evidence_type, submitted_at, ST_AsText(location) as location_wkt FROM revalidation_evidences WHERE task_id=$1 ORDER BY submitted_at ASC', [taskId]);
    return rows.map((r) => ({
      ...r,
      media_url: this.toS3Url(r.media_url, r.task_id),
      mediaUrl: this.toS3Url(r.media_url, r.task_id),
    }));
  }

  async listEvidencesForSign(signId: string) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(signId);
    if (!isUuid) return [];
    const rows: any[] = await this.dataSource.query(
      `SELECT ev.id, ev.task_id, ev.user_id, ev.media_url, ev.evidence_type, ev.submitted_at, ST_AsText(ev.location) as location_wkt
       FROM revalidation_evidences ev
       JOIN revalidation_tasks rt ON rt.id = ev.task_id
       WHERE rt.verified_sign_id = $1
       ORDER BY ev.submitted_at DESC`,
      [signId],
    );
    return rows.map((r) => ({
      ...r,
      media_url: this.toS3Url(r.media_url, r.task_id),
      mediaUrl: this.toS3Url(r.media_url, r.task_id),
    }));
  }

  /**
   * Scenario #3 — reviewer evidence comparison queue (paginated).
   * Excludes evidence the requesting reviewer has already judged.
   */
  async listEvidenceQueue(reviewerId: string, page = 1, pageSize = 20) {
    const p = Math.max(1, page), ps = Math.min(Math.max(1, pageSize), 100);
    const notVotedClause = `NOT EXISTS (
      SELECT 1 FROM revalidation_decisions mine
      WHERE mine.evidence_id = ev.id AND mine.reviewer_id = $1
    )`;
    const countRows: any[] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS cnt
       FROM revalidation_evidences ev
       JOIN revalidation_tasks rt ON rt.id = ev.task_id
       WHERE rt.status IN ('OPEN', 'EVALUATING') AND ${notVotedClause} AND (ev.user_id IS NULL OR ev.user_id != $1)`,
      [reviewerId],
    );
    const total = countRows[0]?.cnt ?? 0;
    const rows: any[] = await this.dataSource.query(
      `SELECT
         ev.id AS evidence_id,
         ev.task_id,
         ev.user_id,
         ev.media_url,
         ev.evidence_type,
         ev.submitted_at,
         ST_Y(ev.location::geometry) AS latitude,
         ST_X(ev.location::geometry) AS longitude,
         ST_DistanceSphere(ev.location, vts.location) AS distance_meters,
         rt.status AS task_status,
         rt.reward_credits,
         vts.id AS verified_sign_id,
         vts.sign_crop_url AS sign_crop_url,
         vts.last_verified_at AS last_verified_at,
         vts.freshness_score AS freshness_score,
         tst.sign_code AS sign_code,
         tst.name_vi AS name_vi,
         tst.name_en AS name_en,
         (SELECT COUNT(*)::int FROM revalidation_decisions dc WHERE dc.evidence_id = ev.id) AS current_vote_count
       FROM revalidation_evidences ev
       JOIN revalidation_tasks rt ON rt.id = ev.task_id
       JOIN verified_traffic_signs vts ON vts.id = rt.verified_sign_id
       LEFT JOIN traffic_sign_types tst ON tst.id = vts.sign_type_id
       WHERE rt.status IN ('OPEN', 'EVALUATING') AND ${notVotedClause} AND (ev.user_id IS NULL OR ev.user_id != $1)
       ORDER BY ev.submitted_at ASC
       LIMIT $2 OFFSET $3`,
      [reviewerId, ps, (p - 1) * ps],
    );
    const items = rows.map((r) => ({
      evidenceId: r.evidence_id,
      taskId: r.task_id,
      verifiedSign: {
        id: r.verified_sign_id,
        signCode: r.sign_code,
        nameVi: r.name_vi,
        nameEn: r.name_en,
        signCropUrl: r.sign_crop_url,
        lastVerifiedAt: r.last_verified_at,
        freshnessScore: r.freshness_score,
      },
      evidence: {
        mediaUrl: this.toS3Url(r.media_url, r.task_id),
        evidenceType: r.evidence_type ?? 'STILL_ACTIVE',
        submittedAt: r.submitted_at,
        latitude: Number(r.latitude),
        longitude: Number(r.longitude),
        distanceMeters: r.distance_meters == null ? null : Math.round(Number(r.distance_meters) * 100) / 100,
      },
      currentVoteCount: Number(r.current_vote_count) || 0,
      taskStatus: r.task_status,
      rewardCredits: r.reward_credits,
    }));
    return { items, total, page: p, pageSize: ps, totalPages: Math.ceil(total / ps) };
  }

  async voteOnEvidence(evidenceId: string, reviewerId: string, dto: { decision: string; suggestedSignTypeId?: number; note?: string }) {
    const ev = await this.evidences.findOne({ where: { id: evidenceId } });
    if (!ev) throw new NotFoundException('RevalidationEvidence ' + evidenceId + ' not found');
    if (ev.userId === reviewerId) {
      throw new ForbiddenException('You cannot vote on your own submitted evidence');
    }
    const decision = this.assertDecision(dto.decision);
    if (dto.suggestedSignTypeId != null) {
      const typeRows: any[] = await this.dataSource.query('SELECT id FROM traffic_sign_types WHERE id=$1', [dto.suggestedSignTypeId]);
      if (typeRows.length === 0) throw new BadRequestException('suggestedSignTypeId ' + dto.suggestedSignTypeId + ' does not exist');
    }
    const saved = await this.dataSource.transaction(async (manager) => {
      const taskRows: any[] = await manager.query(
        `SELECT rt.status
         FROM revalidation_tasks rt
         JOIN revalidation_evidences ev ON ev.task_id = rt.id
         WHERE ev.id = $1
         FOR UPDATE OF rt`,
        [evidenceId],
      );
      if (!taskRows[0]) throw new NotFoundException('RevalidationEvidence ' + evidenceId + ' not found');
      if (![TaskStatus.OPEN, TaskStatus.EVALUATING].includes(taskRows[0].status)) {
        throw new BadRequestException('Revalidation task is closed to new votes');
      }
      const existing = await manager.findOne(RevalidationDecision, { where: { evidenceId, reviewerId } });
      if (existing) throw new BadRequestException('You have already voted on this evidence');
      const row = manager.create(RevalidationDecision, {
        evidenceId,
        reviewerId,
        decision,
        suggestedSignTypeId: dto.suggestedSignTypeId ?? null,
        note: dto.note ?? null,
      } as any);
      return manager.save(RevalidationDecision, row);
    });
    if (this.dailyTasksService) {
      this.dailyTasksService.recordProgress(reviewerId, 'REVIEW', 1).catch(() => {});
    }
    let consensus: RevalidationConsensusSummary | null = null;
    try { consensus = await this.evaluateRevalidationConsensus(ev.taskId); }
    catch (e: any) { this.logger.warn('auto consensus failed for task ' + ev.taskId + ': ' + e?.message); }
    return { vote: saved, consensus };
  }
  async listDecisions(evidenceId: string) {
    if (!await this.evidences.findOne({ where: { id: evidenceId } })) throw new NotFoundException('RevalidationEvidence ' + evidenceId + ' not found');
    return this.decisions.find({ where: { evidenceId }, order: { decidedAt: 'ASC' } });
  }

  async requestEvidenceRecapture(evidenceId: string, reviewerId: string, dto: { reason: string; note?: string }) {
    const ev = await this.evidences.findOne({ where: { id: evidenceId } });
    if (!ev) throw new NotFoundException('RevalidationEvidence ' + evidenceId + ' not found');
    if (ev.userId === reviewerId) {
      throw new ForbiddenException('You cannot request recapture on your own submitted evidence');
    }
    const reason = dto.reason.trim();
    const note = dto.note?.trim() || null;

    await this.dataSource.transaction(async (manager) => {
      const taskRows: any[] = await manager.query(
        `SELECT rt.status
         FROM revalidation_tasks rt
         JOIN revalidation_evidences ev ON ev.task_id = rt.id
         WHERE ev.id = $1
         FOR UPDATE OF rt`,
        [evidenceId],
      );
      if (!taskRows[0]) throw new NotFoundException('RevalidationTask ' + ev.taskId + ' not found');
      if (![TaskStatus.OPEN, TaskStatus.EVALUATING].includes(taskRows[0].status)) {
        throw new BadRequestException('Revalidation task is closed to recapture requests');
      }

      const decisionRow = await manager.findOne(RevalidationDecision, { where: { evidenceId, reviewerId } });
      const updatedDecision = decisionRow ?? manager.create(RevalidationDecision, {
        evidenceId,
        reviewerId,
      } as any);
      updatedDecision.decision = RevalDecision.UNCLEAR;
      updatedDecision.note = `Recapture requested: ${reason}${note ? ' - ' + note : ''}`;
      await manager.save(RevalidationDecision, updatedDecision);
    });

    let notificationSent = false;
    if (ev.userId && this.notificationsService) {
      try {
        const msg = `Ảnh bằng chứng cho nhiệm vụ ${ev.taskId.slice(0, 8)} quá mờ hoặc khó xác thực (${reason}${note ? ': ' + note : ''}). Vui lòng chụp lại ảnh rõ nét tại vị trí biển báo.`;
        await this.notificationsService.create(
          ev.userId,
          'REVALIDATION_RECAPTURE_REQUESTED',
          'Yêu cầu chụp lại ảnh xác thực biển báo',
          msg,
          'revalidation_evidence',
          evidenceId,
        );
        notificationSent = true;
      } catch (err: any) {
        // Notification failure should not fail request
      }
    }

    if (this.dailyTasksService) {
      this.dailyTasksService.recordProgress(reviewerId, 'REVIEW', 1).catch(() => {});
    }

    return {
      success: true,
      evidenceId,
      taskId: ev.taskId,
      surveyorId: ev.userId,
      reason,
      note,
      notificationSent,
    };
  }

  /**
   * Scenario #3 — automated multi-reviewer consensus.
   * Called after each vote; settles the task as soon as >= minVotesRequired
   * decisions are in and a clear majority (or a conflict) can be determined.
   */
  async evaluateRevalidationConsensus(taskId: string): Promise<RevalidationConsensusSummary> {
    const minVotes = await this.resolveMinVotesRequired();
    return this.dataSource.transaction(async (manager) => {
      const task = await this.lockTaskForConsensus(manager, taskId);
      if (![TaskStatus.OPEN, TaskStatus.EVALUATING].includes(task.status)) {
        return { evaluated: false, reason: 'TASK_FINALIZED', taskId };
      }
      const { evidenceRows, decisions } = await this.loadTaskEvidenceAndDecisions(taskId, manager);
      if (decisions.length < minVotes) {
        return { evaluated: false, reason: 'NOT_ENOUGH_VOTES', totalVotes: decisions.length, minVotesRequired: minVotes, taskId };
      }
      return this.applyTaskOutcome(task, evidenceRows, decisions, minVotes, manager);
    });
  }

  async finalizeTask(taskId: string, _finalizedBy?: string) {
    return this.dataSource.transaction(async (manager) => {
      const task = await this.lockTaskForConsensus(manager, taskId);
      if (![TaskStatus.OPEN, TaskStatus.EVALUATING].includes(task.status)) {
        throw new BadRequestException('Task ' + taskId + ' already finalized (status=' + task.status + ')');
      }
      const { evidenceRows, decisions } = await this.loadTaskEvidenceAndDecisions(taskId, manager);
      if (evidenceRows.length === 0) throw new BadRequestException('Cannot finalize: no evidence submitted for this task');
      if (decisions.length === 0) throw new BadRequestException('Cannot finalize: no reviewer decisions yet');
      return this.applyTaskOutcome(task, evidenceRows, decisions, decisions.length, manager);
    });
  }

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------

  private async lockTaskForConsensus(manager: EntityManager, taskId: string): Promise<RevalidationTask> {
    const taskRefs: any[] = await manager.query(
      `SELECT verified_sign_id
       FROM revalidation_tasks
       WHERE id = $1`,
      [taskId],
    );
    if (!taskRefs[0]) throw new NotFoundException('RevalidationTask ' + taskId + ' not found');

    const signRows: any[] = await manager.query(
      `SELECT id
       FROM verified_traffic_signs
       WHERE id = $1
       FOR UPDATE`,
      [taskRefs[0].verified_sign_id],
    );
    if (!signRows[0]) {
      throw new NotFoundException('VerifiedTrafficSign ' + taskRefs[0].verified_sign_id + ' not found');
    }

    const rows: any[] = await manager.query(
      `SELECT id, verified_sign_id, freshness_rule_id, reward_credits, status
       FROM revalidation_tasks
       WHERE id = $1
       FOR UPDATE`,
      [taskId],
    );
    if (!rows[0]) throw new NotFoundException('RevalidationTask ' + taskId + ' not found');
    return {
      id: rows[0].id,
      verifiedSignId: rows[0].verified_sign_id,
      freshnessRuleId: rows[0].freshness_rule_id,
      rewardCredits: rows[0].reward_credits,
      status: rows[0].status,
    } as RevalidationTask;
  }

  private async loadTaskEvidenceAndDecisions(
    taskId: string,
    manager: EntityManager,
  ): Promise<{ evidenceRows: EvidenceRow[]; decisions: RevalDecisionRow[] }> {
    const evidenceRows: any[] = await manager.query(
      `SELECT id, user_id, media_url, evidence_type, submitted_at,
              ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude
       FROM revalidation_evidences
       WHERE task_id = $1
       ORDER BY submitted_at DESC, id DESC`,
      [taskId],
    );
    const evIds = evidenceRows.map(e => e.id as string);
    const decisions: any[] = evIds.length
      ? await manager.query('SELECT decision, reviewer_id, evidence_id, suggested_sign_type_id FROM revalidation_decisions WHERE evidence_id = ANY($1)', [evIds])
      : [];
    return { evidenceRows, decisions: (decisions as RevalDecisionRow[]) };
  }

  private async resolveMinVotesRequired(): Promise<number> {
    try {
      const rows: any[] = await this.dataSource.query(
        `SELECT min_votes_required
         FROM consensus_configs
         WHERE is_active = true
         ORDER BY effective_from DESC
         LIMIT 1`,
      );
      if (rows.length && Number.isInteger(rows[0].min_votes_required)) return Number(rows[0].min_votes_required);
    } catch {}
    return DEFAULT_MIN_VOTES_REQUIRED;
  }

  private async resolveRuleLimits(task: RevalidationTask): Promise<{ maxProximityMeters: number; dailySubmissionLimit: number }> {
    let maxProximityMeters = DEFAULT_MAX_PROXIMITY_METERS;
    let dailySubmissionLimit = DEFAULT_DAILY_SUBMISSION_LIMIT;
    if (task.freshnessRuleId != null) {
      try {
        const rule = this.freshnessRules ? await this.freshnessRules.findOne({ where: { id: task.freshnessRuleId, isActive: true } }) : null;
        if (rule) {
          if (Number.isFinite(rule.maxProximityMeters) && rule.maxProximityMeters > 0) maxProximityMeters = rule.maxProximityMeters;
          if (Number.isFinite(rule.dailySubmissionLimit) && rule.dailySubmissionLimit > 0) dailySubmissionLimit = rule.dailySubmissionLimit;
        }
      } catch (e: any) {
        this.logger.warn('freshness rule lookup failed for task ' + task.id + ': ' + e?.message);
      }
    }
    return { maxProximityMeters, dailySubmissionLimit };
  }

  private async applyTaskOutcome(
    task: RevalidationTask,
    evidenceRows: EvidenceRow[],
    decisionRows: RevalDecisionRow[],
    minVotes: number,
    manager: EntityManager,
  ): Promise<RevalidationConsensusSummary> {
    const counts = new Map<string, number>();
    const suggestedByDecision = new Map<string, Map<number, number>>();
    for (const d of decisionRows) {
      counts.set(d.decision, (counts.get(d.decision) || 0) + 1);
      if (d.decision === RevalDecision.CHANGED && d.suggested_sign_type_id != null) {
        const inner = suggestedByDecision.get(RevalDecision.CHANGED) ?? new Map<number, number>();
        inner.set(d.suggested_sign_type_id, (inner.get(d.suggested_sign_type_id) || 0) + 1);
        suggestedByDecision.set(RevalDecision.CHANGED, inner);
      }
    }

    const activeCount = (counts.get(RevalDecision.UNCHANGED) || 0) + (counts.get(RevalDecision.STILL_ACTIVE) || 0);
    const removedCount = (counts.get(RevalDecision.MISSING) || 0) + (counts.get(RevalDecision.REMOVED) || 0);
    const changedCount = counts.get(RevalDecision.CHANGED) || 0;

    const voteCounts = Object.fromEntries(counts);
    let winningDecision: RevalDecision | null = null;
    let suggestedSignTypeId: number | null = null;

    if (activeCount === 0 && removedCount === 0 && changedCount === 0) {
      // every decision was UNCLEAR / INVALID — staff must arbitrate
      await this.escalateToModeration(task, 'No meaningful decision reached (all votes UNCLEAR/INVALID)', manager);
      return { evaluated: true, reason: 'CONFLICT', totalVotes: decisionRows.length, minVotesRequired: minVotes, voteCounts, escalatedToModeration: true, taskId: task.id };
    }

    const groups = [
      {
        name: 'ACTIVE',
        count: activeCount,
        decision: (counts.get(RevalDecision.STILL_ACTIVE) || 0) >= (counts.get(RevalDecision.UNCHANGED) || 0)
          ? RevalDecision.STILL_ACTIVE
          : RevalDecision.UNCHANGED,
      },
      {
        name: 'REMOVED',
        count: removedCount,
        decision: (counts.get(RevalDecision.REMOVED) || 0) >= (counts.get(RevalDecision.MISSING) || 0)
          ? RevalDecision.REMOVED
          : RevalDecision.MISSING,
      },
      {
        name: 'CHANGED',
        count: changedCount,
        decision: RevalDecision.CHANGED,
      },
    ].filter(g => g.count > 0).sort((a, b) => b.count - a.count);

    const top = groups[0];
    const second = groups[1];
    if (second && top.count === second.count) {
      await this.escalateToModeration(task, `Revalidation consensus conflict: tie between ${top.name} (${top.count}) and ${second.name} (${second.count})`, manager);
      return { evaluated: true, reason: 'CONFLICT', totalVotes: decisionRows.length, minVotesRequired: minVotes, voteCounts, escalatedToModeration: true, taskId: task.id };
    }

    winningDecision = top.decision;
    const relevantEvidenceTypes = winningDecision === RevalDecision.CHANGED
      ? ['CHANGED']
      : winningDecision === RevalDecision.MISSING || winningDecision === RevalDecision.REMOVED
        ? ['REMOVED', 'MISSING']
        : ['STILL_ACTIVE', 'UNCHANGED'];
    const latestEvidence = evidenceRows.find((evidence) =>
      relevantEvidenceTypes.includes((evidence.evidence_type ?? '').toUpperCase()),
    ) ?? (winningDecision === RevalDecision.CHANGED
      ? undefined
      : evidenceRows.find((evidence) => {
        const evidenceType = (evidence.evidence_type ?? '').toUpperCase();
        return !['CHANGED', 'REMOVED', 'MISSING', 'STILL_ACTIVE', 'UNCHANGED'].includes(evidenceType);
      }));
    if (winningDecision === RevalDecision.CHANGED && !latestEvidence) {
      await this.escalateToModeration(task, 'Reviewers decided CHANGED but no CHANGED evidence is available', manager);
      return {
        evaluated: true,
        reason: 'CHANGED_WITHOUT_EVIDENCE',
        totalVotes: decisionRows.length,
        minVotesRequired: minVotes,
        voteCounts,
        escalatedToModeration: true,
        taskId: task.id,
      };
    }
    const latestEvidenceMediaUrl = latestEvidence?.media_url ?? null;
    let aiEarlyClassification: EarlyClassificationResult | null = null;

    if (winningDecision === RevalDecision.CHANGED) {
      const suggestions = suggestedByDecision.get(RevalDecision.CHANGED);
      if (suggestions && suggestions.size > 0) {
        let best: number | null = null; let bestCount = 0;
        for (const [typeId, count] of suggestions.entries()) if (count > bestCount) { bestCount = count; best = typeId; }
        suggestedSignTypeId = best;
      }

      // If sign status is changed, send new changed image to AI server for early classification
      if (latestEvidenceMediaUrl && this.aiInferenceService) {
        try {
          aiEarlyClassification = await this.aiInferenceService.classifyEarly({
            mediaUrl: latestEvidenceMediaUrl,
            signId: task.verifiedSignId,
            taskId: task.id,
          });
          if (aiEarlyClassification) {
            this.logger.log(
              `AI early classification for task ${task.id} sign ${task.verifiedSignId}: ` +
              `class=${aiEarlyClassification.className}, code=${aiEarlyClassification.standardCode}, conf=${aiEarlyClassification.confidence}`,
            );
          }
        } catch (e: any) {
          this.logger.warn(`AI early classification request failed during consensus for task ${task.id}: ${e?.message}`);
        }
      }

      // If reviewers did not specify a suggestedSignTypeId, attempt to resolve it via AI early classification
      if (!suggestedSignTypeId && aiEarlyClassification) {
        suggestedSignTypeId = await this.resolveSignTypeIdFromAiResult(aiEarlyClassification);
        if (suggestedSignTypeId) {
          this.logger.log(
            `Auto-resolved suggestedSignTypeId=${suggestedSignTypeId} from AI early classification (${aiEarlyClassification.standardCode || aiEarlyClassification.className}) for task ${task.id}`,
          );
        }
      }

      if (!suggestedSignTypeId) {
        await this.escalateToModeration(task, 'Reviewers decided CHANGED but provided no suggested sign type', manager);
        return {
          evaluated: true,
          reason: 'CHANGED_WITHOUT_TYPE',
          totalVotes: decisionRows.length,
          minVotesRequired: minVotes,
          voteCounts,
          escalatedToModeration: true,
          taskId: task.id,
          earlyClassification: aiEarlyClassification,
        };
      }
    }

    const signAction = await this.applySignOutcome(
      task,
      winningDecision,
      suggestedSignTypeId,
      latestEvidence,
      aiEarlyClassification,
      manager,
    );
    const rewards = await this.creditRewards(task, decisionRows, evidenceRows, winningDecision);
    await manager.query(
      `UPDATE revalidation_tasks
       SET status = 'COMPLETED'
       WHERE id = $1 AND status IN ('OPEN', 'EVALUATING')`,
      [task.id],
    );

    // Automatically complete / clear any remaining active revalidation tasks for this sign
    await manager.query(
      `UPDATE revalidation_tasks
       SET status = 'COMPLETED'
       WHERE verified_sign_id = $1 AND id != $2 AND status IN ('OPEN', 'EVALUATING')`,
      [task.verifiedSignId, task.id],
    );

    await this.notifySubmitters(task.id, evidenceRows, winningDecision, rewards.rewardPerSubmitter);

    return {
      evaluated: true,
      reason: 'CONSENSUS_REACHED',
      totalVotes: decisionRows.length,
      minVotesRequired: minVotes,
      winningDecision,
      voteCounts,
      signAction,
      creditedSubmitters: rewards.creditedSubmitters,
      creditedReviewers: rewards.creditedReviewers,
      rewardPerSubmitter: rewards.rewardPerSubmitter,
      taskId: task.id,
      earlyClassification: aiEarlyClassification,
    };
  }

  private async escalateToModeration(task: RevalidationTask, note: string, manager: EntityManager) {
    await manager.query(
      `INSERT INTO moderation_cases (id, case_type, target_entity_type, target_entity_id, status, resolution_note, created_at)
       VALUES (gen_random_uuid(), 'REVIEW_CONFLICT', 'revalidation_task', $1, 'PENDING', $2, now())`,
      [task.id, note],
    );
    task.status = TaskStatus.ESCALATED_MODERATION;
    await manager.query(
      `UPDATE revalidation_tasks SET status = 'ESCALATED_MODERATION' WHERE id = $1`,
      [task.id],
    );
  }

  private async applySignOutcome(
    task: RevalidationTask,
    winningDecision: RevalDecision,
    suggestedSignTypeId: number | null,
    latestEvidence?: EvidenceRow,
    aiEarlyClassification?: EarlyClassificationResult | null,
    manager?: EntityManager,
  ): Promise<string> {
    const signId = task.verifiedSignId;
    const query = manager ? manager.query.bind(manager) : this.dataSource.query.bind(this.dataSource);
    const latestEvidenceMediaUrl = latestEvidence?.media_url ?? null;
    try {
      if (winningDecision === RevalDecision.UNCHANGED || winningDecision === RevalDecision.STILL_ACTIVE) {
        if (latestEvidenceMediaUrl) {
          await query(
            `UPDATE verified_traffic_signs
             SET status = 'ACTIVE', freshness_score = 1, sign_crop_url = $2,
                 location = COALESCE(
                   CASE WHEN $3::float8 IS NOT NULL AND $4::float8 IS NOT NULL
                     THEN ST_SetSRID(ST_MakePoint($3, $4), 4326)
                   END,
                   location
                 ),
                 last_verified_at = now(), updated_at = now()
             WHERE id = $1`,
            [signId, latestEvidenceMediaUrl, latestEvidence?.longitude ?? null, latestEvidence?.latitude ?? null],
          );
        } else {
          await query(
            "UPDATE verified_traffic_signs SET status='ACTIVE', freshness_score=1, last_verified_at=now(), updated_at=now() WHERE id=$1",
            [signId],
          );
        }
        await query("INSERT INTO verified_sign_history (verified_sign_id, change_reason) VALUES ($1, 'REVALIDATION_UPDATE')", [signId]);
        await query("INSERT INTO sign_lifecycle_events (verified_sign_id, event_type, note) VALUES ($1,'REVALIDATED','STILL_ACTIVE: freshness refreshed')", [signId]);
        return 'REFRESHED';
      } else if (winningDecision === RevalDecision.MISSING || winningDecision === RevalDecision.REMOVED) {
        await query("UPDATE verified_traffic_signs SET status='DECOMMISSIONED', freshness_score=0, updated_at=now() WHERE id=$1", [signId]);
        await query("INSERT INTO sign_lifecycle_events (verified_sign_id, event_type, note) VALUES ($1,'DECOMMISSIONED','Revalidation: REMOVED / DECOMMISSIONED')", [signId]);
        return 'DECOMMISSIONED';
      } else if (winningDecision === RevalDecision.CHANGED && suggestedSignTypeId != null) {
        // Fallback early classification if not already obtained
        if (!aiEarlyClassification && latestEvidenceMediaUrl && this.aiInferenceService) {
          try {
            aiEarlyClassification = await this.aiInferenceService.classifyEarly({
              mediaUrl: latestEvidenceMediaUrl,
              signId,
              taskId: task.id,
            });
          } catch (e: any) {
            this.logger.warn(`AI classification fallback failed in applySignOutcome: ${e?.message}`);
          }
        }
        const prevRows: any[] = await query('SELECT sign_type_id FROM verified_traffic_signs WHERE id=$1', [signId]);
        const previousType = prevRows.length ? prevRows[0].sign_type_id : null;
        if (latestEvidenceMediaUrl) {
          await query(
            `UPDATE verified_traffic_signs
             SET sign_type_id = $1, status = 'ACTIVE', freshness_score = 1, sign_crop_url = $3,
                 location = COALESCE(
                   CASE WHEN $4::float8 IS NOT NULL AND $5::float8 IS NOT NULL
                     THEN ST_SetSRID(ST_MakePoint($4, $5), 4326)
                   END,
                   location
                 ),
                 last_verified_at = now(), updated_at = now()
             WHERE id = $2`,
            [suggestedSignTypeId, signId, latestEvidenceMediaUrl, latestEvidence?.longitude ?? null, latestEvidence?.latitude ?? null],
          );
        } else {
          await query(
            "UPDATE verified_traffic_signs SET sign_type_id=$1, status='ACTIVE', freshness_score=1, last_verified_at=now(), updated_at=now() WHERE id=$2",
            [suggestedSignTypeId, signId],
          );
        }
        await query(
          "INSERT INTO verified_sign_history (verified_sign_id, previous_sign_type_id, change_reason) VALUES ($1, $2, 'REVALIDATION_UPDATE')",
          [signId, previousType],
        );
        const lifecycleNote = aiEarlyClassification?.standardCode
          ? `CHANGED: sign type updated to #${suggestedSignTypeId} (AI early classification: ${aiEarlyClassification.standardCode}, conf: ${aiEarlyClassification.confidence?.toFixed(2) ?? 'N/A'})`
          : `CHANGED: sign type updated to #${suggestedSignTypeId}`;
        await query(
          "INSERT INTO sign_lifecycle_events (verified_sign_id, event_type, note) VALUES ($1, 'REVALIDATION_CHANGED', $2)",
          [signId, lifecycleNote],
        );
        return 'UPDATED_TYPE';
      }
    } catch (e: any) {
      this.logger.error('Sign outcome persistence failed for task ' + task.id + ': ' + e?.message);
      throw e;
    }
    return 'NO_CHANGE';
  }

  private async creditRewards(
    task: RevalidationTask,
    decisionRows: RevalDecisionRow[],
    evidenceRows: EvidenceRow[],
    winningDecision: RevalDecision,
  ): Promise<{ creditedSubmitters: number; creditedReviewers: number; rewardPerSubmitter: number }> {
    const isDecommission = winningDecision === RevalDecision.MISSING || winningDecision === RevalDecision.REMOVED;
    const txType = isDecommission ? TransactionType.SIGN_DECOMMISSION_REWARD : TransactionType.REVALIDATION_REWARD;
    const defaultAmount = isDecommission ? 30 : (task.rewardCredits || 10);
    const rewardAmount = await this.walletService.resolveRewardAmount(txType, defaultAmount);

    const uniqueSubmitters = [...new Set(evidenceRows.map(e => e.user_id as string))];
    const alignedReviewers = [...new Set(decisionRows.filter(d => {
      if (isDecommission) return d.decision === RevalDecision.MISSING || d.decision === RevalDecision.REMOVED;
      if (winningDecision === RevalDecision.UNCHANGED || winningDecision === RevalDecision.STILL_ACTIVE) {
        return d.decision === RevalDecision.UNCHANGED || d.decision === RevalDecision.STILL_ACTIVE;
      }
      return d.decision === winningDecision;
    }).map(d => d.reviewer_id as string))];

    let creditedSubmitters = 0; let creditedReviewers = 0;
    for (const uid of uniqueSubmitters) {
      try {
        await this.walletService.creditUser(
          uid,
          rewardAmount,
          txType,
          'revalidation_task',
          task.id,
          'Revalidation reward (' + winningDecision + ')',
          { idempotencyKey: `revalidation:${task.id}:${txType}:${uid}` },
        );
        creditedSubmitters++;
      } catch (e: any) {
        this.logger.error('revalidation credit failed for task ' + task.id + ', user ' + uid + ': ' + e?.message);
        throw e;
      }
    }
    for (const rid of alignedReviewers) {
      if (uniqueSubmitters.includes(rid)) continue; // already credited as submitter
      try {
        await this.walletService.creditUser(
          rid,
          rewardAmount,
          txType,
          'revalidation_task',
          task.id,
          'Revalidation reviewer reward (' + winningDecision + ')',
          { idempotencyKey: `revalidation:${task.id}:${txType}:${rid}` },
        );
        creditedReviewers++;
      } catch (e: any) {
        this.logger.error('revalidation reviewer credit failed for task ' + task.id + ', user ' + rid + ': ' + e?.message);
        throw e;
      }
    }
    return { creditedSubmitters, creditedReviewers, rewardPerSubmitter: rewardAmount };
  }

  private async notifySubmitters(taskId: string, evidenceRows: EvidenceRow[], winningDecision: RevalDecision, rewardAmount: number) {
    try {
      const uniqueSubmitters = [...new Set(evidenceRows.map(e => e.user_id as string))];
      const decisionText: Record<string, string> = { UNCHANGED: 'không thay đổi', STILL_ACTIVE: 'vẫn đang hoạt động', CHANGED: 'đã thay đổi', MISSING: 'không còn tồn tại', REMOVED: 'đã bị gỡ bỏ', UNCLEAR: 'chưa thể xác định rõ', INVALID: 'không hợp lệ' };
      const decisionLabel = decisionText[winningDecision] ?? winningDecision;
      const notifs = uniqueSubmitters.map(uid => ({ userId: uid, type: 'REVALIDATION_CLOSED', title: 'Đã hoàn tất kiểm tra lại biển báo', message: 'Nhiệm vụ ' + taskId.slice(0,8) + ' đã hoàn tất với kết quả: ' + decisionLabel + ' (+' + rewardAmount + ' credits).', relatedEntityType: 'revalidation_task', relatedEntityId: taskId }));
      if (notifs.length) await this.notificationsService.createBulk(notifs as any);
    } catch {}
  }

  async createOrEscalateDisputeTask(
    signId: string,
    userId: string,
    photoUrl?: string,
    location?: { latitude: number; longitude: number },
    _note?: string,
  ): Promise<RevalidationTask> {
    let task = await this.tasks.findOne({
      where: {
        verifiedSignId: signId,
        status: In([TaskStatus.OPEN, TaskStatus.EVALUATING]),
      },
    });

    if (task) {
      task.priority = TaskPriority.HIGH;
      task.rewardCredits = Math.max(task.rewardCredits, 15);
      task = await this.tasks.save(task);
    } else {
      task = this.tasks.create({
        verifiedSignId: signId,
        priority: TaskPriority.HIGH,
        rewardCredits: 15,
        status: TaskStatus.OPEN,
      });
      task = await this.tasks.save(task);
    }

    if (photoUrl) {
      const evidenceId = randomUUID();
      const lat = location?.latitude ?? 0;
      const lon = location?.longitude ?? 0;
      const s3PhotoUrl = this.toS3Url(photoUrl, task.id);
      try {
        await this.dataSource.query(
          `INSERT INTO revalidation_evidences (id, task_id, user_id, media_url, location)
           VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326))`,
          [evidenceId, task.id, userId, s3PhotoUrl, lon, lat],
        );
      } catch (e: any) {
        this.logger.warn(`Failed to attach evidence for dispute task ${task.id}: ${e?.message}`);
      }
    }

    await this.notifySurveyorsForMissingSign(task, signId);

    return task;
  }

  async notifySurveyorsForMissingSign(task: RevalidationTask, signId: string): Promise<number> {
    try {
      if (!this.dataSource?.query) return 0;
      const surveyorRows: Array<{ user_id: string }> = await this.dataSource.query(
        `SELECT sp.user_id
         FROM surveyor_profiles sp
         ORDER BY sp.user_id
         LIMIT 20`,
      );
      if (!surveyorRows || surveyorRows.length === 0) {
        return 0;
      }
      const notifs = surveyorRows.map((row) => ({
        userId: row.user_id,
        type: 'SIGN_MISSING_DISPATCH',
        title: 'Cần kiểm tra biển báo báo mất',
        message: `Biển báo ${signId.slice(0, 8)} được báo cáo không còn tồn tại. Nhiệm vụ kiểm tra đã được kích hoạt (+${task.rewardCredits} credits).`,
        relatedEntityType: 'revalidation_task',
        relatedEntityId: task.id,
      }));
      if (this.notificationsService?.createBulk) {
        await this.notificationsService.createBulk(notifs as any);
      }
      return notifs.length;
    } catch (e: any) {
      this.logger.warn(`Failed to dispatch missing sign notifications: ${e?.message}`);
      return 0;
    }
  }
  /**
   * Attempts to resolve the database traffic_sign_types(id) from the AI early classification result.
   */
  async resolveSignTypeIdFromAiResult(aiResult: EarlyClassificationResult): Promise<number | null> {
    if (!aiResult) return null;
    try {
      if (aiResult.standardCode) {
        const rows = await this.dataSource.query(
          'SELECT id FROM traffic_sign_types WHERE UPPER(sign_code) = UPPER($1) LIMIT 1',
          [aiResult.standardCode],
        );
        if (rows.length > 0) return Number(rows[0].id);
      }
      const candidateNames = [aiResult.className, aiResult.nameEn, aiResult.nameVi].filter(Boolean) as string[];
      for (const name of candidateNames) {
        const rows = await this.dataSource.query(
          'SELECT id FROM traffic_sign_types WHERE LOWER(name_en) = LOWER($1) OR LOWER(name_vi) = LOWER($1) OR LOWER(sign_code) = LOWER($1) LIMIT 1',
          [name],
        );
        if (rows.length > 0) return Number(rows[0].id);
      }
      if (aiResult.classId != null && Number.isInteger(aiResult.classId)) {
        const rows = await this.dataSource.query(
          'SELECT id FROM traffic_sign_types WHERE id = $1 LIMIT 1',
          [aiResult.classId],
        );
        if (rows.length > 0) return Number(rows[0].id);
      }
    } catch (e: any) {
      this.logger.warn(`Failed to resolve sign type from AI result: ${e?.message}`);
    }
    return null;
  }

  /**
   * Manually or programmatically triggers early classification on the latest evidence of a revalidation task.
   */
  async triggerEarlyClassification(taskId: string, explicitMediaUrl?: string) {
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException('RevalidationTask ' + taskId + ' not found');
    let targetUrl = explicitMediaUrl;
    if (!targetUrl) {
      const evs: any[] = await this.dataSource.query(
        "SELECT media_url, evidence_type FROM revalidation_evidences WHERE task_id=$1 ORDER BY (evidence_type = 'CHANGED') DESC, submitted_at DESC LIMIT 1",
        [taskId],
      );
      if (evs.length && evs[0].media_url) {
        targetUrl = this.toS3Url(evs[0].media_url, taskId);
      }
    }
    if (!targetUrl) {
      throw new BadRequestException('No image evidence available for early classification on task ' + taskId);
    }
    if (!this.aiInferenceService) {
      throw new BadRequestException('AiInferenceService is not configured or available');
    }
    const classification = await this.aiInferenceService.classifyEarly({
      mediaUrl: targetUrl,
      signId: task.verifiedSignId,
      taskId: task.id,
    });
    const resolvedSignTypeId = classification ? await this.resolveSignTypeIdFromAiResult(classification) : null;
    return {
      taskId: task.id,
      signId: task.verifiedSignId,
      mediaUrl: targetUrl,
      classification,
      resolvedSignTypeId,
    };
  }
}
