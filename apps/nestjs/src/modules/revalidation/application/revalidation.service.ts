import { Injectable, NotFoundException, BadRequestException, ForbiddenException, HttpException, HttpStatus, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
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

const DEFAULT_MIN_VOTES_REQUIRED = 3;
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

    const where: any = {};
    if (status && status.toUpperCase() !== 'ALL') {
      where.status = status;
    } else if (!status) {
      where.status = In([TaskStatus.OPEN, TaskStatus.EVALUATING]);
    }
    const order: any =
      sort === 'reward'
        ? { rewardCredits: 'DESC' }
        : sort === 'urgency'
          ? { urgency: 'DESC' }
          : { createdAt: 'DESC' };
    const [items, total] = await this.tasks.findAndCount({ where, order, skip: (p - 1) * ps, take: ps });
    return { items, total, page: p, pageSize: ps, totalPages: Math.ceil(total / ps) };
  }

  async listTasksInBbox(q: {
    minLat: number;
    minLon: number;
    maxLat: number;
    maxLon: number;
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
    // bbox via ST_Within on verified_traffic_signs.location
    conditions.push(`ST_Within(vts.location, ST_MakeEnvelope($${idx++}, $${idx++}, $${idx++}, $${idx++}, 4326))`);
    params.push(q.minLon, q.minLat, q.maxLon, q.maxLat);
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
    const evidenceType = dto.evidenceType === 'REMOVED' ? 'REMOVED' : 'STILL_ACTIVE';
    const id = randomUUID();
    await this.dataSource.query(
      'INSERT INTO revalidation_evidences (id, task_id, user_id, media_url, location, evidence_type) VALUES ($1,$2,$3,$4,ST_SetSRID(ST_MakePoint($5,$6),4326),$7)',
      [id, taskId, userId, mediaUrl, lon, lat, evidenceType],
    );
    if (task.status === TaskStatus.OPEN) { task.status = TaskStatus.EVALUATING; await this.tasks.save(task); }
    if (this.dailyTasksService) {
      this.dailyTasksService.recordProgress(userId, 'REVALIDATE', 1).catch(() => {});
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
    if (!await this.tasks.findOne({ where: { id: taskId } })) throw new NotFoundException('RevalidationTask ' + taskId + ' not found');
    const rows: any[] = await this.dataSource.query('SELECT id, task_id, user_id, media_url, evidence_type, submitted_at, ST_AsText(location) as location_wkt FROM revalidation_evidences WHERE task_id=$1 ORDER BY submitted_at ASC', [taskId]);
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
    if (decision === RevalDecision.CHANGED && dto.suggestedSignTypeId == null) {
      throw new BadRequestException('suggestedSignTypeId is required when decision is CHANGED');
    }
    if (dto.suggestedSignTypeId != null) {
      const typeRows: any[] = await this.dataSource.query('SELECT id FROM traffic_sign_types WHERE id=$1', [dto.suggestedSignTypeId]);
      if (typeRows.length === 0) throw new BadRequestException('suggestedSignTypeId ' + dto.suggestedSignTypeId + ' does not exist');
    }
    const existing = await this.decisions.findOne({ where: { evidenceId: evidenceId, reviewerId } });
    if (existing) throw new BadRequestException('You have already voted on this evidence');
    const row = this.decisions.create({ evidenceId: evidenceId, reviewerId, decision, suggestedSignTypeId: dto.suggestedSignTypeId ?? null, note: dto.note ?? null } as any);
    const saved = await this.decisions.save(row);
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

  /**
   * Scenario #3 — automated multi-reviewer consensus.
   * Called after each vote; settles the task as soon as >= minVotesRequired
   * decisions are in and a clear majority (or a conflict) can be determined.
   */
  async evaluateRevalidationConsensus(taskId: string): Promise<RevalidationConsensusSummary> {
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException('RevalidationTask ' + taskId + ' not found');
    if (task.status === TaskStatus.COMPLETED || task.status === TaskStatus.EXPIRED || task.status === TaskStatus.ESCALATED_MODERATION) {
      return { evaluated: false, reason: 'TASK_FINALIZED', taskId };
    }
    const { evidenceRows, decisions } = await this.loadTaskEvidenceAndDecisions(taskId);
    const minVotes = await this.resolveMinVotesRequired();
    if (decisions.length < minVotes) {
      return { evaluated: false, reason: 'NOT_ENOUGH_VOTES', totalVotes: decisions.length, minVotesRequired: minVotes, taskId };
    }
    return this.applyTaskOutcome(task, evidenceRows, decisions, minVotes);
  }

  async finalizeTask(taskId: string, _finalizedBy?: string) {
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException('RevalidationTask ' + taskId + ' not found');
    if (task.status === TaskStatus.COMPLETED || task.status === TaskStatus.EXPIRED) throw new BadRequestException('Task ' + taskId + ' already finalized (status=' + task.status + ')');
    const { evidenceRows, decisions } = await this.loadTaskEvidenceAndDecisions(taskId);
    if (evidenceRows.length === 0) throw new BadRequestException('Cannot finalize: no evidence submitted for this task');
    if (decisions.length === 0) throw new BadRequestException('Cannot finalize: no reviewer decisions yet');
    return this.applyTaskOutcome(task, evidenceRows, decisions, decisions.length);
  }

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------

  private async loadTaskEvidenceAndDecisions(taskId: string): Promise<{ evidenceRows: EvidenceRow[]; decisions: RevalDecisionRow[] }> {
    const evidenceRows: any[] = await this.dataSource.query('SELECT id, user_id FROM revalidation_evidences WHERE task_id=$1', [taskId]);
    const evIds = evidenceRows.map(e => e.id as string);
    const decisions: any[] = evIds.length
      ? await this.dataSource.query('SELECT decision, reviewer_id, evidence_id, suggested_sign_type_id FROM revalidation_decisions WHERE evidence_id = ANY($1)', [evIds])
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
      await this.escalateToModeration(task, 'No meaningful decision reached (all votes UNCLEAR/INVALID)');
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
      await this.escalateToModeration(task, `Revalidation consensus conflict: tie between ${top.name} (${top.count}) and ${second.name} (${second.count})`);
      return { evaluated: true, reason: 'CONFLICT', totalVotes: decisionRows.length, minVotesRequired: minVotes, voteCounts, escalatedToModeration: true, taskId: task.id };
    }

    winningDecision = top.decision;
    if (winningDecision === RevalDecision.CHANGED) {
      const suggestions = suggestedByDecision.get(RevalDecision.CHANGED);
      if (suggestions && suggestions.size > 0) {
        let best: number | null = null; let bestCount = 0;
        for (const [typeId, count] of suggestions.entries()) if (count > bestCount) { bestCount = count; best = typeId; }
        suggestedSignTypeId = best;
      }
      if (!suggestedSignTypeId) {
        await this.escalateToModeration(task, 'Reviewers decided CHANGED but provided no suggested sign type');
        return { evaluated: true, reason: 'CHANGED_WITHOUT_TYPE', totalVotes: decisionRows.length, minVotesRequired: minVotes, voteCounts, escalatedToModeration: true, taskId: task.id };
      }
    }

    const signAction = await this.applySignOutcome(task, winningDecision, suggestedSignTypeId);
    const rewards = await this.creditRewards(task, decisionRows, evidenceRows, winningDecision);

    task.status = TaskStatus.COMPLETED;
    await this.tasks.save(task);

    // Automatically complete / clear any remaining active revalidation tasks for this sign
    try {
      await this.dataSource.query(
        `UPDATE revalidation_tasks
         SET status = 'COMPLETED'
         WHERE verified_sign_id = $1 AND id != $2 AND status IN ('OPEN', 'EVALUATING')`,
        [task.verifiedSignId, task.id],
      );
    } catch (e: any) {
      this.logger.warn(`Failed to auto-clear sibling revalidation tasks for sign ${task.verifiedSignId}: ${e?.message}`);
    }

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
    };
  }

  private async escalateToModeration(task: RevalidationTask, note: string) {
    try {
      await this.dataSource.query(
        `INSERT INTO moderation_cases (id, case_type, target_entity_type, target_entity_id, status, resolution_note, created_at)
         VALUES (gen_random_uuid(), 'REVIEW_CONFLICT', 'revalidation_task', $1, 'PENDING', $2, now())`,
        [task.id, note],
      );
    } catch (e: any) {
      this.logger.warn('moderation case insert failed for task ' + task.id + ': ' + e?.message);
    }
    task.status = TaskStatus.ESCALATED_MODERATION;
    await this.tasks.save(task);
  }

  private async applySignOutcome(task: RevalidationTask, winningDecision: RevalDecision, suggestedSignTypeId: number | null): Promise<string> {
    const signId = task.verifiedSignId;
    try {
      if (winningDecision === RevalDecision.UNCHANGED || winningDecision === RevalDecision.STILL_ACTIVE) {
        await this.dataSource.query("UPDATE verified_traffic_signs SET status='ACTIVE', freshness_score=1, last_verified_at=now(), updated_at=now() WHERE id=$1", [signId]);
        await this.dataSource.query("INSERT INTO verified_sign_history (verified_sign_id, change_reason) VALUES ($1, 'REVALIDATION_UPDATE')", [signId]);
        await this.dataSource.query("INSERT INTO sign_lifecycle_events (verified_sign_id, event_type, note) VALUES ($1,'REVALIDATED','STILL_ACTIVE: freshness refreshed')", [signId]);
        return 'REFRESHED';
      } else if (winningDecision === RevalDecision.MISSING || winningDecision === RevalDecision.REMOVED) {
        await this.dataSource.query("UPDATE verified_traffic_signs SET status='DECOMMISSIONED', freshness_score=0, updated_at=now() WHERE id=$1", [signId]);
        await this.dataSource.query("INSERT INTO sign_lifecycle_events (verified_sign_id, event_type, note) VALUES ($1,'DECOMMISSIONED','Revalidation: REMOVED / DECOMMISSIONED')", [signId]);
        return 'DECOMMISSIONED';
      } else if (winningDecision === RevalDecision.CHANGED && suggestedSignTypeId != null) {
        const prevRows: any[] = await this.dataSource.query('SELECT sign_type_id FROM verified_traffic_signs WHERE id=$1', [signId]);
        const previousType = prevRows.length ? prevRows[0].sign_type_id : null;
        await this.dataSource.query(
          "UPDATE verified_traffic_signs SET sign_type_id=$1, status='ACTIVE', freshness_score=1, last_verified_at=now(), updated_at=now() WHERE id=$2",
          [suggestedSignTypeId, signId],
        );
        await this.dataSource.query(
          "INSERT INTO verified_sign_history (verified_sign_id, previous_sign_type_id, change_reason) VALUES ($1, $2, 'REVALIDATION_UPDATE')",
          [signId, previousType],
        );
        await this.dataSource.query(
          "INSERT INTO sign_lifecycle_events (verified_sign_id, event_type, note) VALUES ($1, 'REVALIDATION_CHANGED', $2)",
          [signId, 'CHANGED: sign type updated to #' + suggestedSignTypeId],
        );
        return 'UPDATED_TYPE';
      }
    } catch (e: any) { this.logger.warn('sign update failed for task ' + task.id + ': ' + e?.message); }
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
        await this.walletService.creditUser(uid, rewardAmount, txType, 'revalidation_task', task.id, 'Revalidation reward (' + winningDecision + ')');
        creditedSubmitters++;
      } catch (e: any) { this.logger.warn('revalidation credit failed ' + uid + ': ' + e?.message); }
    }
    for (const rid of alignedReviewers) {
      if (uniqueSubmitters.includes(rid)) continue; // already credited as submitter
      try {
        await this.walletService.creditUser(rid, rewardAmount, txType, 'revalidation_task', task.id, 'Revalidation reviewer reward (' + winningDecision + ')');
        creditedReviewers++;
      } catch (e: any) { this.logger.warn('revalidation reviewer credit failed ' + rid + ': ' + e?.message); }
    }
    return { creditedSubmitters, creditedReviewers, rewardPerSubmitter: rewardAmount };
  }

  private async notifySubmitters(taskId: string, evidenceRows: EvidenceRow[], winningDecision: RevalDecision, rewardAmount: number) {
    try {
      const uniqueSubmitters = [...new Set(evidenceRows.map(e => e.user_id as string))];
      const notifs = uniqueSubmitters.map(uid => ({ userId: uid, type: 'REVALIDATION_CLOSED', title: 'Revalidation ' + winningDecision, message: 'Task ' + taskId.slice(0,8) + ' closed as ' + winningDecision + ' (+' + rewardAmount + ' credits).', relatedEntityType: 'revalidation_task', relatedEntityId: taskId }));
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

    return task;
  }
}