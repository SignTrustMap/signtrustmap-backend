import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { MediaFileType } from '../infrastructure/persistence/submission-media-file.entity';
import {
  SubmissionStatus,
  SubmissionType,
  SurveySubmission,
} from '../infrastructure/persistence/survey-submission.entity';
import { UploadChunk } from '../infrastructure/persistence/upload-chunk.entity';
import { UploadSession, UploadStatus } from '../infrastructure/persistence/upload-session.entity';
import { TransactionType } from '../../wallet/infrastructure/persistence/credit-transaction.entity';
import { NotificationsService } from '../../notifications/notifications.service';
import { MinioStorageService } from '../../../integrations/minio/minio-storage.service';
import { WalletService } from '../../wallet/application/wallet.service';
import { InitializeUploadDto } from '../presentation/dto/initialize-upload.dto';
import { UploadChunkBodyDto } from '../presentation/dto/upload-chunk.dto';
@Injectable()
export class SurveyService {
  private readonly logger = new Logger(SurveyService.name);
  constructor(
    @InjectRepository(UploadSession) private readonly sessionRepo: Repository<UploadSession>,
    @InjectRepository(UploadChunk) private readonly chunkRepo: Repository<UploadChunk>,
    @InjectRepository(SurveySubmission) private readonly submissionRepo: Repository<SurveySubmission>,
    private readonly storageService: MinioStorageService,
    private readonly dataSource: DataSource,
    private readonly walletService: WalletService,
    private readonly notificationsService: NotificationsService,
  ) {}
  async initialize(userId: string, dto: InitializeUploadDto) {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const session = this.sessionRepo.create({ userId, originalFilename: dto.originalFilename, mediaType: dto.mediaType as any, totalSizeBytes: String(dto.totalSizeBytes), totalChunks: dto.totalChunks, receivedChunks: 0, checksumExpected: dto.checksumExpected ?? null, status: UploadStatus.INITIATED, expiresAt } as any);
    const saved = await this.sessionRepo.save(session) as unknown as UploadSession;
    return { sessionId: saved.id, originalFilename: saved.originalFilename, mediaType: saved.mediaType, totalSizeBytes: saved.totalSizeBytes, totalChunks: saved.totalChunks, receivedChunks: saved.receivedChunks, status: saved.status, expiresAt: saved.expiresAt, createdAt: saved.createdAt };
  }
  async uploadChunk(userId: string, sessionId: string, body: UploadChunkBodyDto, file: Express.Multer.File) {
    if (!file) throw new BadRequestException('File chunk (form field "file") is required');
    const session = await this.sessionRepo.findOne({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Upload session ' + sessionId + ' not found');
    if (session.userId !== userId) throw new BadRequestException('Session does not belong to the authenticated user');
    if (session.status === UploadStatus.COMPLETED) throw new BadRequestException('Upload session already completed');
    if (session.status === UploadStatus.EXPIRED) throw new BadRequestException('Upload session has expired');
    if (session.status === UploadStatus.FAILED) throw new BadRequestException('Upload session is in FAILED state');
    if (session.expiresAt && new Date(session.expiresAt).getTime() < Date.now()) { await this.sessionRepo.update(session.id, { status: UploadStatus.EXPIRED } as any); throw new BadRequestException('Upload session has expired'); }
    const { chunkIndex } = body;
    if (chunkIndex >= session.totalChunks) throw new BadRequestException('chunkIndex ' + chunkIndex + ' is out of range (totalChunks=' + session.totalChunks + ')');
    const existing = await this.chunkRepo.findOne({ where: { sessionId: session.id, chunkIndex } });
    if (existing) throw new ConflictException('Chunk ' + chunkIndex + ' already received for this session');
    const bucket = this.storageService.bucketForMediaType(session.mediaType);
    const storageKey = 'chunks/' + userId + '/' + sessionId + '/' + String(chunkIndex).padStart(6, '0');
    try { await this.storageService.putObject(bucket, storageKey, file.buffer, file.mimetype); } catch (err: any) { throw new BadRequestException('Failed to store chunk ' + chunkIndex + ': ' + (err?.message ?? 'unknown storage error')); }
    const chunk: UploadChunk = this.chunkRepo.create({ sessionId: session.id, chunkIndex, sizeBytes: file.size, storageKey: bucket + '/' + storageKey, checksum: body.checksum ?? null } as unknown as UploadChunk);
    await this.chunkRepo.save(chunk);
    const newReceived = session.receivedChunks + 1;
    const isLastChunk = newReceived === session.totalChunks;
    let linkedSubmissionId: string | null = (session as any).submissionId ?? null;

    if (isLastChunk && !linkedSubmissionId) {
      // Use a transaction so submission + session update are atomic
      await this.dataSource.transaction(async (manager) => {
        try {
          const mediaToType: Record<string, SubmissionType> = {
            [MediaFileType.VIDEO]: SubmissionType.VIDEO_GPX,
            [MediaFileType.GPX]: SubmissionType.VIDEO_GPX,
            [MediaFileType.IMAGE]: SubmissionType.SINGLE_IMAGE,
          };
          const subType = mediaToType[String(session.mediaType)] ?? SubmissionType.VIDEO_GPX;
          const sub = manager.create(SurveySubmission, { surveyorId: session.userId, submissionType: subType, status: SubmissionStatus.QUEUED } as any);
          const savedSub = await manager.save(SurveySubmission, sub) as unknown as SurveySubmission;
          linkedSubmissionId = savedSub.id;

          // Update session: status + received_chunks + submission_id in one statement
          await manager.update(UploadSession, session.id, {
            receivedChunks: newReceived,
            status: UploadStatus.ASSEMBLING,
            submissionId: linkedSubmissionId,
          } as any);

          try {
            await manager.query(
              'INSERT INTO submission_status_history (submission_id, new_status, note) VALUES ($1, $2::submission_status, $3)',
              [linkedSubmissionId, SubmissionStatus.QUEUED, 'Created from upload session ' + sessionId],
            );
          } catch (histErr: any) {
            this.logger.warn('history insert failed for ' + linkedSubmissionId + ': ' + histErr?.message);
          }
          this.logger.log('Created survey_submission ' + linkedSubmissionId + ' (QUEUED) from upload session ' + sessionId);
        } catch (e: any) {
          this.logger.warn('auto-create submission failed for session ' + sessionId + ': ' + e?.message);
          // Still update received_chunks + status even if submission creation fails
          await manager.update(UploadSession, session.id, {
            receivedChunks: newReceived,
            status: UploadStatus.ASSEMBLING,
          } as any);
        }
      });
    } else {
      // Normal chunk (not last) — just update received count and status
      await this.sessionRepo.update(session.id, {
        receivedChunks: newReceived,
        status: isLastChunk ? UploadStatus.ASSEMBLING : UploadStatus.UPLOADING,
      } as any);
    }

    const updated = await this.sessionRepo.findOne({ where: { id: sessionId } });
    return { sessionId: updated!.id, chunkIndex, storageKey: chunk.storageKey, sizeBytes: chunk.sizeBytes, receivedChunks: updated!.receivedChunks, totalChunks: updated!.totalChunks, status: updated!.status, isComplete: updated!.receivedChunks === updated!.totalChunks, submissionId: (updated as any).submissionId ?? linkedSubmissionId };
  }
  async getSession(userId: string, sessionId: string) {
    const session = await this.sessionRepo.findOne({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Upload session ' + sessionId + ' not found');
    if (session.userId !== userId) throw new BadRequestException('Session does not belong to the authenticated user');
    const chunks = await this.chunkRepo.find({ where: { sessionId: session.id }, order: { chunkIndex: 'ASC' } });
    return { session, chunks };
  }
  async getMySubmissions(userId: string, page = 1, pageSize = 20) {
    const p = Math.max(1, page); const ps = Math.min(Math.max(1, pageSize), 100);
    const [items, total] = await this.submissionRepo.findAndCount({ where: { surveyorId: userId } as any, order: { createdAt: 'DESC' }, skip: (p - 1) * ps, take: ps });
    return { items, total, page: p, pageSize: ps, totalPages: Math.ceil(total / ps) };
  }
  async getSubmissionStatus(userId: string, submissionId: string) {
    const sub = await this.submissionRepo.findOne({ where: { id: submissionId } as any });
    if (!sub) throw new NotFoundException('SurveySubmission ' + submissionId + ' not found');
    if (sub.surveyorId !== userId) throw new BadRequestException('Submission does not belong to the authenticated user');
    let history: any[] = [];
    let candidates: any[] = [];
    let sessions: any[] = [];
    try { history = await this.dataSource.query('SELECT id, old_status, new_status, note, changed_at FROM submission_status_history WHERE submission_id=$1 ORDER BY changed_at ASC', [submissionId]); } catch (e: any) { this.logger.warn('history query failed: ' + e?.message); }
    try { candidates = await this.dataSource.query('SELECT id, predicted_sign_type_id, status, confidence_score, best_frame_url, sign_crop_url, active_learning_priority, created_at FROM unverified_sign_candidates WHERE submission_id=$1 ORDER BY created_at ASC', [submissionId]); } catch (e: any) { this.logger.warn('candidate query failed: ' + e?.message); }
    try { sessions = await this.dataSource.query('SELECT id, original_filename, media_type, total_chunks, received_chunks, status, created_at FROM upload_sessions WHERE submission_id=$1 ORDER BY created_at ASC', [submissionId]); } catch {}
    return { submission: sub, history, candidates, totalCandidates: candidates.length, sessions };
  }
  async getMyPendingCount(userId: string) {
    const count = await this.submissionRepo.count({ where: { surveyorId: userId } as any }).catch(() => 0);
    // Pending = not terminal
    const pending = await this.dataSource
      .query(`SELECT COUNT(*)::int AS cnt FROM survey_submissions WHERE surveyor_id=$1 AND status NOT IN ('COMPLETED','FAILED','PARTIALLY_PROCESSED','NO_SIGN_DETECTED')`, [userId])
      .then((rows: any[]) => rows[0]?.cnt ?? 0)
      .catch(() => 0);
    return { total: count, pending };
  }

  async getMyStats(userId: string) {
    const total = await this.submissionRepo.count({ where: { surveyorId: userId } as any }).catch(() => 0);
    const pending = await this.dataSource
      .query(`SELECT COUNT(*)::int AS cnt FROM survey_submissions WHERE surveyor_id=$1 AND status NOT IN ('COMPLETED','FAILED','PARTIALLY_PROCESSED','NO_SIGN_DETECTED')`, [userId])
      .then((rows: any[]) => rows[0]?.cnt ?? 0)
      .catch(() => 0);
    let creditScore: number | null = null;
    try {
      const rows: any[] = await this.dataSource.query('SELECT balance FROM wallets WHERE user_id=$1', [userId]);
      if (rows.length) creditScore = Number(rows[0].balance);
    } catch {}
    let dailyTasks: any[] = [];
    try {
      dailyTasks = await this.dataSource.query('SELECT * FROM daily_tasks WHERE is_active=true ORDER BY id ASC LIMIT 20');
    } catch {}
    let revalidationCount = 0;
    try {
      const rows: any[] = await this.dataSource.query(
        `SELECT COUNT(*)::int AS cnt FROM revalidation_tasks rt JOIN verified_traffic_signs vts ON vts.id=rt.verified_sign_id WHERE rt.status='OPEN'`,
      );
      revalidationCount = rows[0]?.cnt ?? 0;
    } catch {}
    return { userId, totalSubmissions: total, pendingSubmissions: pending, creditScore, revalidationAvailable: revalidationCount, dailyTasks };
  }

  async advanceSubmissionStatus(submissionId: string, newStatus: SubmissionStatus, note?: string) {
    const sub = await this.submissionRepo.findOne({ where: { id: submissionId } });
    if (!sub) throw new NotFoundException('SurveySubmission ' + submissionId + ' not found');
    const terminal: string[] = [SubmissionStatus.COMPLETED as string, SubmissionStatus.FAILED as string, SubmissionStatus.PARTIALLY_PROCESSED as string, SubmissionStatus.NO_SIGN_DETECTED as string];
    if (terminal.includes(String(sub.status))) return { alreadyTerminal: true, submission: sub, status: sub.status };
    const oldStatus = sub.status;
    sub.status = newStatus;
    await this.submissionRepo.save(sub);
    try { await this.dataSource.query('INSERT INTO submission_status_history (submission_id, old_status, new_status, note) VALUES ($1, $2::submission_status, $3::submission_status, $4)', [sub.id, String(oldStatus), String(newStatus), note ?? 'Status advanced to ' + newStatus]); } catch (e: any) { this.logger.warn('history insert failed: ' + e?.message); }
    return { previousStatus: oldStatus, newStatus, submission: sub };
  }
  async markCompleted(submissionId: string, note?: string) {
    const sub = await this.submissionRepo.findOne({ where: { id: submissionId } });
    if (!sub) throw new NotFoundException('SurveySubmission ' + submissionId + ' not found');
    if (sub.status === SubmissionStatus.COMPLETED) return { alreadyCompleted: true, submission: sub };
    const oldStatus = sub.status;
    sub.status = SubmissionStatus.COMPLETED;
    await this.submissionRepo.save(sub);
    try { await this.dataSource.query('INSERT INTO submission_status_history (submission_id, old_status, new_status, note) VALUES ($1,$2::submission_status,$3::submission_status,$4)', [sub.id, String(oldStatus), String(SubmissionStatus.COMPLETED), note ?? 'AI pipeline completed']); } catch {}
    const rewardAmount = await this.walletService.resolveRewardAmount(TransactionType.SURVEY_REWARD, 10);
    try { await this.walletService.creditUser(sub.surveyorId, rewardAmount, TransactionType.SURVEY_REWARD, 'survey_submission', sub.id, 'Survey reward (submission ' + sub.id.slice(0,8) + ' completed)'); } catch (e: any) { this.logger.warn('survey reward credit failed ' + sub.surveyorId + ': ' + e?.message); }
    try { await this.dataSource.query('INSERT INTO surveyor_profiles (user_id, total_submissions, total_verified_signs, total_credits_earned) VALUES ($1, 1, 0, $2) ON CONFLICT (user_id) DO UPDATE SET total_submissions = surveyor_profiles.total_submissions + 1, total_credits_earned = surveyor_profiles.total_credits_earned + $2', [sub.surveyorId, rewardAmount]); } catch {}
    try { await this.notificationsService.create(sub.surveyorId, 'SURVEY_COMPLETED', 'Survey completed', 'Your submission ' + sub.id.slice(0,8) + ' has been processed (+' + rewardAmount + ' credits).', 'survey_submission', sub.id); } catch {}
    return { alreadyCompleted: false, submission: sub, rewardAmount };
  }
}
