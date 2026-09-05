import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { RevalidationTask, TaskStatus } from '../../entities/revalidation-task.entity';
import { RevalidationEvidence } from '../../entities/revalidation-evidence.entity';
import { RevalidationDecision, RevalDecision } from '../../entities/revalidation-decision.entity';
import { StorageService } from '../storage/storage.service';
import { WalletService } from '../wallet/wallet.service';
import { TransactionType } from '../../entities/credit-transaction.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { randomUUID } from 'crypto';
@Injectable()
export class RevalidationService {
  private readonly logger = new Logger(RevalidationService.name);
  constructor(
    @InjectRepository(RevalidationTask) private tasks: Repository<RevalidationTask>,
    @InjectRepository(RevalidationEvidence) private evidences: Repository<RevalidationEvidence>,
    @InjectRepository(RevalidationDecision) private decisions: Repository<RevalidationDecision>,
    private readonly dataSource: DataSource,
    private readonly storage: StorageService,
    private readonly walletService: WalletService,
    private readonly notificationsService: NotificationsService,
  ) {}
  async listTasks(page = 1, pageSize = 20, status?: string, sort?: string) {
    const p = Math.max(1, page), ps = Math.min(Math.max(1, pageSize), 100);
    const where: any = {}; if (status) where.status = status;
    const order: any = sort === 'reward' ? { rewardCredits: 'DESC' } : { createdAt: 'DESC' };
    const [items, total] = await this.tasks.findAndCount({ where, order, skip: (p - 1) * ps, take: ps });
    return { items, total, page: p, pageSize: ps, totalPages: Math.ceil(total / ps) };
  }

  async listTasksInBbox(q: { minLat: number; minLon: number; maxLat: number; maxLon: number; status?: string; priority?: string; page?: number; pageSize?: number }) {
    const p = Math.max(1, q.page ?? 1), ps = Math.min(Math.max(1, q.pageSize ?? 20), 100);
    const conditions: string[] = ['vts.location IS NOT NULL'];
    const params: any[] = [];
    let idx = 1;
    // bbox via ST_Within on verified_traffic_signs.location
    conditions.push(`ST_Within(vts.location, ST_MakeEnvelope($${idx++}, $${idx++}, $${idx++}, $${idx++}, 4326))`);
    params.push(q.minLon, q.minLat, q.maxLon, q.maxLat);
    if (q.status) { conditions.push(`rt.status = $${idx++}::task_status`); params.push(q.status); }
    if (q.priority) { conditions.push(`rt.priority = $${idx++}::task_priority`); params.push(q.priority); }
    const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const countRows: any[] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS cnt FROM revalidation_tasks rt JOIN verified_traffic_signs vts ON vts.id = rt.verified_sign_id ${whereClause}`, params);
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
       LIMIT $${idx++} OFFSET $${idx}`, [...params, ps, (p - 1) * ps]);
    return { items: rows, total, page: p, pageSize: ps, totalPages: Math.ceil(total / ps) };
  }
  async getTask(id: string) {
    const t = await this.tasks.findOne({ where: { id } });
    if (!t) throw new NotFoundException('RevalidationTask ' + id + ' not found');
    const evs: any[] = await this.dataSource.query('SELECT id, task_id, user_id, media_url, submitted_at, ST_AsText(location) as location_wkt FROM revalidation_evidences WHERE task_id=$1 ORDER BY submitted_at ASC', [id]);
    return { ...t, evidences: evs };
  }
  private assertDecision(v: string): RevalDecision {
    const allowed = Object.values(RevalDecision);
    if (!allowed.includes(v as RevalDecision)) throw new BadRequestException('decision must be one of ' + allowed.join(', ') + ', got \"' + v + '\"');
    return v as RevalDecision;
  }
  async submitEvidence(taskId: string, userId: string, dto: { mediaUrl?: string; latitude: number; longitude: number }, file?: Express.Multer.File) {
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException('RevalidationTask ' + taskId + ' not found');
    if (task.status !== TaskStatus.OPEN && task.status !== TaskStatus.EVALUATING) throw new BadRequestException('Task ' + taskId + ' is not open for new evidence (status=' + task.status + ')');
    const lat = dto.latitude, lon = dto.longitude;
    if (typeof lat !== 'number' || typeof lon !== 'number' || lat < -90 || lat > 90 || lon < -180 || lon > 180) throw new BadRequestException('Invalid latitude/longitude');
    let mediaUrl = dto.mediaUrl ?? null;
    if (file) { const key = 'revalidation/' + taskId + '/' + randomUUID() + '-' + file.originalname; await this.storage.putObject('stm-sign-crops', key, file.buffer, file.mimetype); mediaUrl = key; }
    if (!mediaUrl) throw new BadRequestException('Provide mediaUrl or upload a file');
    const id = randomUUID();
    await this.dataSource.query('INSERT INTO revalidation_evidences (id, task_id, user_id, media_url, location) VALUES ($1,$2,$3,$4,ST_SetSRID(ST_MakePoint($5,$6),4326))', [id, taskId, userId, mediaUrl, lon, lat]);
    if (task.status === TaskStatus.OPEN) { task.status = TaskStatus.EVALUATING; await this.tasks.save(task); }
    const saved = await this.evidences.findOne({ where: { id } });
    return saved ?? { id, taskId, userId, mediaUrl, latitude: lat, longitude: lon };
  }
  async listEvidencesForTask(taskId: string) {
    if (!await this.tasks.findOne({ where: { id: taskId } })) throw new NotFoundException('RevalidationTask ' + taskId + ' not found');
    const rows: any[] = await this.dataSource.query('SELECT id, task_id, user_id, media_url, submitted_at, ST_AsText(location) as location_wkt FROM revalidation_evidences WHERE task_id=$1 ORDER BY submitted_at ASC', [taskId]);
    return rows;
  }
  async voteOnEvidence(evidenceId: string, reviewerId: string, dto: { decision: string; note?: string }) {
    const ev = await this.evidences.findOne({ where: { id: evidenceId } });
    if (!ev) throw new NotFoundException('RevalidationEvidence ' + evidenceId + ' not found');
    const decision = this.assertDecision(dto.decision);
    const existing = await this.decisions.findOne({ where: { evidenceId: evidenceId, reviewerId } });
    if (existing) throw new BadRequestException('You have already voted on this evidence');
    const row = this.decisions.create({ evidenceId: evidenceId, reviewerId, decision, note: dto.note ?? null } as any);
    return this.decisions.save(row);
  }
  async listDecisions(evidenceId: string) {
    if (!await this.evidences.findOne({ where: { id: evidenceId } })) throw new NotFoundException('RevalidationEvidence ' + evidenceId + ' not found');
    return this.decisions.find({ where: { evidenceId }, order: { decidedAt: 'ASC' } });
  }
  async finalizeTask(taskId: string, finalizedBy?: string) {
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException('RevalidationTask ' + taskId + ' not found');
    if (task.status === TaskStatus.COMPLETED || task.status === TaskStatus.EXPIRED) throw new BadRequestException('Task ' + taskId + ' already finalized (status=' + task.status + ')');
    const evidences: any[] = await this.dataSource.query('SELECT id, user_id FROM revalidation_evidences WHERE task_id=$1', [taskId]);
    if (evidences.length === 0) throw new BadRequestException('Cannot finalize: no evidence submitted for this task');
    const evIds = evidences.map(e => e.id);
    const decisions: any[] = await this.dataSource.query('SELECT decision, reviewer_id, evidence_id FROM revalidation_decisions WHERE evidence_id = ANY(\)', [evIds]);
    if (decisions.length === 0) throw new BadRequestException('Cannot finalize: no reviewer decisions yet');
    const counts = new Map<string, number>();
    for (const d of decisions) counts.set(d.decision, (counts.get(d.decision) || 0) + 1);
    let winningDecision: string = RevalDecision.UNCLEAR; let maxCount = 0;
    for (const [k,v] of counts.entries()) if (v > maxCount) { maxCount = v; winningDecision = k; }
    // tie-break: prefer UNCHANGED > CHANGED > MISSING > UNCLEAR > INVALID
    const priority: Record<string, number> = { UNCHANGED: 0, CHANGED: 1, MISSING: 2, UNCLEAR: 3, INVALID: 4 };
    const sortedCounts = [...counts.entries()].sort((a,b) => b[1] - a[1] || (priority[a[0]] ?? 99) - (priority[b[0]] ?? 99));
    if (sortedCounts.length > 1 && sortedCounts[0][1] === sortedCounts[1][1]) winningDecision = sortedCounts[0][0]; // keep priority winner
    // Apply outcome to verified_traffic_signs
    let signAction = 'NO_CHANGE';
    try {
      if (winningDecision === RevalDecision.UNCHANGED) {
        await this.dataSource.query("UPDATE verified_traffic_signs SET status='ACTIVE', freshness_score=1, last_verified_at=now(), updated_at=now() WHERE id=$1", [task.verifiedSignId]);
        await this.dataSource.query('INSERT INTO verified_sign_history (verified_sign_id, change_reason) VALUES ($1, \'REVALIDATION_UPDATE\')', [task.verifiedSignId]);
        await this.dataSource.query("INSERT INTO sign_lifecycle_events (verified_sign_id, event_type, note) VALUES ($1,'REVALIDATED','UNCHANGED: freshness refreshed')", [task.verifiedSignId]);
        signAction = 'REFRESHED';
      } else if (winningDecision === RevalDecision.MISSING) {
        await this.dataSource.query("UPDATE verified_traffic_signs SET status='RETIRED', freshness_score=0, updated_at=now() WHERE id=$1", [task.verifiedSignId]);
        await this.dataSource.query("INSERT INTO sign_lifecycle_events (verified_sign_id, event_type, note) VALUES ($1,'RETIRED','Revalidation: MISSING')", [task.verifiedSignId]);
        signAction = 'RETIRED';
      } else if (winningDecision === RevalDecision.CHANGED) {
        await this.dataSource.query("UPDATE verified_traffic_signs SET status='STALE', freshness_score=0.5, updated_at=now() WHERE id=$1", [task.verifiedSignId]);
        await this.dataSource.query("INSERT INTO sign_lifecycle_events (verified_sign_id, event_type, note) VALUES ($1,'REVALIDATION_CHANGED','Sign changed — requires admin to update sign_type')", [task.verifiedSignId]);
        signAction = 'STALE';
      } else {
        await this.dataSource.query('UPDATE verified_traffic_signs SET updated_at=now() WHERE id=$1', [task.verifiedSignId]);
        signAction = 'NO_CHANGE';
      }
    } catch (e: any) { this.logger.warn('sign update failed for task ' + taskId + ': ' + e?.message); }
    // Credit evidence submitters (unique submitters)
    const uniqueSubmitters = [...new Set(evidences.map(e => e.user_id as string))];
    const rewardAmount = await this.walletService.resolveRewardAmount(TransactionType.REVALIDATION_REWARD, task.rewardCredits || 10);
    let creditedCount = 0;
    for (const uid of uniqueSubmitters) {
      try { await this.walletService.creditUser(uid, rewardAmount, TransactionType.REVALIDATION_REWARD, 'revalidation_task', task.id, 'Revalidation reward (' + winningDecision + ')'); creditedCount++; } catch (e: any) { this.logger.warn('revalidation credit failed ' + uid + ': ' + e?.message); }
    }
    task.status = TaskStatus.COMPLETED;
    await this.tasks.save(task);
    // Notify submitters
    try {
      const notifs = uniqueSubmitters.map(uid => ({ userId: uid, type: 'REVALIDATION_CLOSED', title: 'Revalidation ' + winningDecision, message: 'Task ' + task.id.slice(0,8) + ' closed as ' + winningDecision + ' (+' + rewardAmount + ' credits).', relatedEntityType: 'revalidation_task', relatedEntityId: task.id }));
      if (notifs.length) await this.notificationsService.createBulk(notifs as any);
    } catch {}
    return { taskId: task.id, verifiedSignId: task.verifiedSignId, winningDecision, voteCounts: Object.fromEntries(counts), signAction, creditedSubmitters: creditedCount, rewardPerSubmitter: rewardAmount };
  }
}
