import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  MediaFileType,
  SubmissionMediaFile,
} from '../infrastructure/persistence/submission-media-file.entity';
import {
  SubmissionStatus,
  SurveySubmission,
} from '../infrastructure/persistence/survey-submission.entity';
import {
  CorrectionRequirementCode,
  SUBMISSION_TYPE_CONTRACTS,
  SubmissionContractIssue,
  SubmissionValidationCode,
} from '../domain/submission-contract';
import { UploadChunk } from '../infrastructure/persistence/upload-chunk.entity';
import { UploadSession, UploadStatus } from '../infrastructure/persistence/upload-session.entity';
import { TransactionType } from '../../wallet/infrastructure/persistence/credit-transaction.entity';
import { NotificationsService } from '../../notifications/notifications.service';
import { MinioStorageService } from '../../../integrations/minio/minio-storage.service';
import type { StoredObjectReference } from '../../../integrations/minio/minio-storage.service';
import { WalletService } from '../../wallet/application/wallet.service';
import { InitializeUploadDto } from '../presentation/dto/initialize-upload.dto';
import { UploadChunkBodyDto } from '../presentation/dto/upload-chunk.dto';
import { CreateSubmissionDto } from '../presentation/dto/create-submission.dto';
import { UpdateSubmissionDto } from '../presentation/dto/update-submission.dto';
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
  async createSubmission(userId: string, dto: CreateSubmissionDto) {
    const submission = this.submissionRepo.create({
      surveyorId: userId,
      submissionType: dto.submissionType,
      status: SubmissionStatus.DRAFT,
      capturedAt: new Date(dto.capturedAt),
      coordinateSource: dto.coordinateSource,
      note: dto.note ?? null,
      validationErrors: [],
      correctionRequirements: [],
    });
    const saved = await this.submissionRepo.save(submission);
    await this.recordStatusChange(saved.id, null, SubmissionStatus.DRAFT, 'Submission created');
    return this.submissionResponse(saved);
  }

  async updateSubmission(userId: string, submissionId: string, dto: UpdateSubmissionDto) {
    const submission = await this.findOwnedSubmission(userId, submissionId);
    this.assertEditableSubmission(submission);

    if (dto.capturedAt !== undefined) submission.capturedAt = new Date(dto.capturedAt);
    if (dto.coordinateSource !== undefined) submission.coordinateSource = dto.coordinateSource;
    if (dto.note !== undefined) submission.note = dto.note;

    const saved = await this.submissionRepo.save(submission);
    return this.submissionResponse(saved);
  }

  async initialize(userId: string, submissionId: string, dto: InitializeUploadDto) {
    const submission = await this.findOwnedSubmission(userId, submissionId);
    this.assertEditableSubmission(submission);
    const contract = SUBMISSION_TYPE_CONTRACTS[submission.submissionType];
    if (!contract.requiredMediaTypes.includes(dto.mediaType)) {
      throw new BadRequestException(
        `${dto.mediaType} media is not accepted for ${submission.submissionType}`,
      );
    }

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const session = this.sessionRepo.create({ submissionId, userId, originalFilename: dto.originalFilename, mediaType: dto.mediaType, totalSizeBytes: String(dto.totalSizeBytes), totalChunks: dto.totalChunks, receivedChunks: 0, checksumExpected: dto.checksumExpected ?? null, status: UploadStatus.INITIATED, expiresAt } as any);
    const saved = await this.sessionRepo.save(session) as unknown as UploadSession;
    return { sessionId: saved.id, submissionId: saved.submissionId, originalFilename: saved.originalFilename, mediaType: saved.mediaType, totalSizeBytes: saved.totalSizeBytes, totalChunks: saved.totalChunks, receivedChunks: saved.receivedChunks, status: saved.status, expiresAt: saved.expiresAt, createdAt: saved.createdAt };
  }
  async uploadChunk(userId: string, sessionId: string, body: UploadChunkBodyDto, file: Express.Multer.File) {
    if (!file) throw new BadRequestException('File chunk (form field "file") is required');
    const session = await this.sessionRepo.findOne({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Upload session ' + sessionId + ' not found');
    if (session.userId !== userId) throw new BadRequestException('Session does not belong to the authenticated user');
    const submission = await this.findOwnedSubmission(userId, session.submissionId);
    this.assertEditableSubmission(submission);
    if (session.status === UploadStatus.COMPLETED) throw new BadRequestException('Upload session already completed');
    if (session.status === UploadStatus.ASSEMBLING) throw new ConflictException('Upload session is being completed');
    if (session.status === UploadStatus.EXPIRED) throw new BadRequestException('Upload session has expired');
    if (session.status === UploadStatus.FAILED) throw new BadRequestException('Upload session is in FAILED state');
    if (session.expiresAt && new Date(session.expiresAt).getTime() < Date.now()) { await this.sessionRepo.update(session.id, { status: UploadStatus.EXPIRED } as any); throw new BadRequestException('Upload session has expired'); }
    const { chunkIndex } = body;
    if (chunkIndex >= session.totalChunks) throw new BadRequestException('chunkIndex ' + chunkIndex + ' is out of range (totalChunks=' + session.totalChunks + ')');
    const chunkChecksum = createHash('sha256').update(file.buffer).digest('hex');
    if (body.checksum && this.normalizeChecksum(body.checksum) !== chunkChecksum) {
      throw new BadRequestException('Chunk checksum does not match uploaded content');
    }
    const existing = await this.chunkRepo.findOne({ where: { sessionId: session.id, chunkIndex } });
    if (existing) {
      if (existing.sizeBytes !== file.size || existing.checksum !== chunkChecksum) {
        throw new ConflictException('Chunk ' + chunkIndex + ' already received with different content');
      }
      const receivedChunks = await this.chunkRepo.count({ where: { sessionId: session.id } });
      return {
        sessionId: session.id,
        chunkIndex,
        storageKey: existing.storageKey,
        sizeBytes: existing.sizeBytes,
        receivedChunks,
        totalChunks: session.totalChunks,
        status: session.status,
        readyToComplete: receivedChunks === session.totalChunks,
        isComplete: false,
        submissionId: session.submissionId,
      };
    }
    const bucket = this.storageService.bucketForMediaType(session.mediaType);
    const storageKey = 'chunks/' + userId + '/' + sessionId + '/' + String(chunkIndex).padStart(6, '0');
    try { await this.storageService.putObject(bucket, storageKey, file.buffer, file.mimetype); } catch (err: any) { throw new BadRequestException('Failed to store chunk ' + chunkIndex + ': ' + (err?.message ?? 'unknown storage error')); }
    const chunk: UploadChunk = this.chunkRepo.create({ sessionId: session.id, chunkIndex, sizeBytes: file.size, storageKey: bucket + '/' + storageKey, checksum: chunkChecksum } as unknown as UploadChunk);
    await this.chunkRepo.save(chunk);
    const newReceived = await this.chunkRepo.count({ where: { sessionId: session.id } });
    await this.sessionRepo.update(session.id, {
      receivedChunks: newReceived,
      status: UploadStatus.UPLOADING,
    } as any);

    const updated = await this.sessionRepo.findOne({ where: { id: sessionId } });
    return { sessionId: updated!.id, chunkIndex, storageKey: chunk.storageKey, sizeBytes: chunk.sizeBytes, receivedChunks: updated!.receivedChunks, totalChunks: updated!.totalChunks, status: updated!.status, readyToComplete: updated!.receivedChunks === updated!.totalChunks, isComplete: false, submissionId: updated!.submissionId };
  }

  async completeUpload(userId: string, sessionId: string) {
    let chunkObjects: StoredObjectReference[] = [];
    let finalObject: StoredObjectReference | undefined;
    let result: {
      sessionId: string;
      submissionId: string;
      mediaFileId: string;
      status: UploadStatus;
      submissionStatus: SubmissionStatus;
      storageKey: string | null;
      sizeBytes: number;
      checksum: string | null;
    };

    try {
      result = await this.dataSource.transaction(async (manager) => {
      const session = await manager.findOne(UploadSession, {
        where: { id: sessionId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!session) throw new NotFoundException('Upload session ' + sessionId + ' not found');
      if (session.userId !== userId) throw new BadRequestException('Session does not belong to the authenticated user');

      if (session.status === UploadStatus.COMPLETED) {
        return this.completedUploadResult(manager, session);
      }

      const submission = await manager.findOne(SurveySubmission, {
        where: { id: session.submissionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!submission) throw new ConflictException('Upload session has no valid submission');
      this.assertEditableSubmission(submission);

      if (session.status === UploadStatus.EXPIRED) throw new BadRequestException('Upload session has expired');
      if (session.status === UploadStatus.FAILED) throw new BadRequestException('Upload session is in FAILED state');
      if (session.expiresAt && new Date(session.expiresAt).getTime() < Date.now()) {
        session.status = UploadStatus.EXPIRED;
        await manager.save(UploadSession, session);
        throw new BadRequestException('Upload session has expired');
      }

      const chunks = await manager.find(UploadChunk, {
        where: { sessionId: session.id },
        order: { chunkIndex: 'ASC' },
      });
      this.validateChunks(session, chunks);

      session.status = UploadStatus.ASSEMBLING;
      await manager.save(UploadSession, session);

      chunkObjects = chunks.map((chunk) => this.parseStorageKey(chunk.storageKey));
      finalObject = {
        bucket: this.storageService.bucketForMediaType(session.mediaType),
        objectName: this.finalObjectName(session),
      };
      const expectedSizeBytes = Number(session.totalSizeBytes);
      const assembled = await this.storageService.assembleObjects(
        finalObject,
        chunkObjects,
        expectedSizeBytes,
        this.contentTypeFor(session),
      );

      if (assembled.sizeBytes !== expectedSizeBytes) {
        throw new BadRequestException(
          `Assembled file size ${assembled.sizeBytes} does not match expected size ${expectedSizeBytes}`,
        );
      }
      if (
        session.checksumExpected &&
        this.normalizeChecksum(session.checksumExpected) !== assembled.checksum
      ) {
        throw new BadRequestException('Assembled file checksum does not match expected checksum');
      }

      const storageKey = finalObject.bucket + '/' + finalObject.objectName;
      const media = manager.create(SubmissionMediaFile, {
        submissionId: submission.id,
        uploadSessionId: session.id,
        mediaType: session.mediaType,
        fileUrl: storageKey,
        fileSizeBytes: String(assembled.sizeBytes),
        durationSeconds: null,
        checksum: assembled.checksum,
      });
      const savedMedia = await manager.save(SubmissionMediaFile, media);

      session.receivedChunks = chunks.length;
      session.storageKey = storageKey;
      session.status = UploadStatus.COMPLETED;
      await manager.save(UploadSession, session);

      return {
        sessionId: session.id,
        submissionId: submission.id,
        mediaFileId: savedMedia.id,
        status: session.status,
        submissionStatus: submission.status,
        storageKey,
        sizeBytes: assembled.sizeBytes,
        checksum: assembled.checksum,
      };
      });
    } catch (error) {
      if (finalObject) await this.removeFinalObject(finalObject);
      throw error;
    }

    if (chunkObjects.length > 0 && finalObject) {
      try {
        await this.storageService.removeObjects(chunkObjects);
      } catch (error: any) {
        this.logger.warn('chunk cleanup failed for session ' + sessionId + ': ' + error?.message);
      }
    }

    return result;
  }

  private async completedUploadResult(manager: EntityManager, session: UploadSession) {
    if (!session.submissionId) {
      throw new ConflictException('Completed upload session has no linked submission');
    }
    const submission = await manager.findOne(SurveySubmission, {
      where: { id: session.submissionId },
    });
    const media = await manager.findOne(SubmissionMediaFile, {
      where: [
        { uploadSessionId: session.id },
        { submissionId: session.submissionId, mediaType: session.mediaType },
      ],
    });
    if (!submission || !media) {
      throw new ConflictException('Completed upload session is missing submission data');
    }
    return {
      sessionId: session.id,
      submissionId: submission.id,
      mediaFileId: media.id,
      status: session.status,
      submissionStatus: submission.status,
      storageKey: session.storageKey,
      sizeBytes: Number(media.fileSizeBytes),
      checksum: media.checksum,
    };
  }

  private validateChunks(session: UploadSession, chunks: UploadChunk[]) {
    if (chunks.length !== session.totalChunks) {
      throw new BadRequestException(
        `Upload is incomplete: received ${chunks.length} of ${session.totalChunks} chunks`,
      );
    }
    for (let index = 0; index < chunks.length; index += 1) {
      if (chunks[index].chunkIndex !== index) {
        throw new BadRequestException('Upload is incomplete: missing chunk ' + index);
      }
    }
    const uploadedSize = chunks.reduce((total, chunk) => total + chunk.sizeBytes, 0);
    if (uploadedSize !== Number(session.totalSizeBytes)) {
      throw new BadRequestException(
        `Uploaded chunk size ${uploadedSize} does not match expected size ${session.totalSizeBytes}`,
      );
    }
  }

  private parseStorageKey(storageKey: string): StoredObjectReference {
    const separator = storageKey.indexOf('/');
    if (separator <= 0 || separator === storageKey.length - 1) {
      throw new BadRequestException('Invalid chunk storage key');
    }
    return { bucket: storageKey.slice(0, separator), objectName: storageKey.slice(separator + 1) };
  }

  private finalObjectName(session: UploadSession): string {
    const filename = session.originalFilename.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `uploads/${session.userId}/${session.submissionId}/${session.id}/${filename || 'upload'}`;
  }

  private contentTypeFor(session: UploadSession): string {
    if (session.mediaType === MediaFileType.IMAGE) {
      const extension = session.originalFilename.toLowerCase().split('.').pop();
      if (extension === 'png') return 'image/png';
      if (extension === 'webp') return 'image/webp';
      if (extension === 'heic' || extension === 'heif') return 'image/heic';
      return 'image/jpeg';
    }
    if (session.mediaType === MediaFileType.GPX) return 'application/gpx+xml';
    return 'video/mp4';
  }

  private normalizeChecksum(checksum: string): string {
    return checksum.toLowerCase().replace(/^sha-?256:/, '');
  }

  private async removeFinalObject(reference: StoredObjectReference) {
    try {
      await this.storageService.removeObject(reference);
    } catch (error: any) {
      this.logger.warn('assembled object cleanup failed: ' + error?.message);
    }
  }

  async submitSubmission(userId: string, submissionId: string) {
    return this.dataSource.transaction(async (manager) => {
      const submission = await manager.findOne(SurveySubmission, {
        where: { id: submissionId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!submission) throw new NotFoundException('SurveySubmission ' + submissionId + ' not found');
      if (submission.surveyorId !== userId) {
        throw new BadRequestException('Submission does not belong to the authenticated user');
      }
      this.assertEditableSubmission(submission);

      const mediaFiles = await manager.find(SubmissionMediaFile, {
        where: { submissionId },
        order: { uploadedAt: 'ASC' },
      });
      const uploadSessions = await manager.find(UploadSession, {
        where: { submissionId },
        order: { createdAt: 'ASC' },
      });
      const { validationErrors, correctionRequirements } = this.validateSubmissionContract(
        submission,
        mediaFiles,
        uploadSessions,
      );
      const oldStatus = submission.status;
      const accepted = validationErrors.length === 0;

      submission.validationErrors = validationErrors;
      submission.correctionRequirements = correctionRequirements;
      submission.status = accepted
        ? SubmissionStatus.QUEUED
        : SubmissionStatus.PENDING_CORRECTION;
      const saved = await manager.save(SurveySubmission, submission);
      await manager.query(
        'INSERT INTO submission_status_history (submission_id, old_status, new_status, note) VALUES ($1, $2::submission_status, $3::submission_status, $4)',
        [
          saved.id,
          oldStatus,
          saved.status,
          accepted ? 'Submission contract validated' : 'Submission requires correction',
        ],
      );

      return {
        accepted,
        submission: this.submissionResponse(saved),
        mediaFiles,
        uploadSessions,
      };
    });
  }

  private validateSubmissionContract(
    submission: SurveySubmission,
    mediaFiles: SubmissionMediaFile[],
    uploadSessions: UploadSession[],
  ): {
    validationErrors: SubmissionContractIssue[];
    correctionRequirements: SubmissionContractIssue[];
  } {
    const validationErrors: SubmissionContractIssue[] = [];
    const correctionRequirements: SubmissionContractIssue[] = [];
    const contract = SUBMISSION_TYPE_CONTRACTS[submission.submissionType];
    const completedMedia = new Set(mediaFiles.map((media) => media.mediaType));

    for (const mediaType of contract.requiredMediaTypes) {
      if (completedMedia.has(mediaType)) continue;
      const hasIncompleteUpload = uploadSessions.some(
        (session) => session.mediaType === mediaType && session.status !== UploadStatus.COMPLETED,
      );
      validationErrors.push({
        code: hasIncompleteUpload
          ? SubmissionValidationCode.INCOMPLETE_UPLOAD
          : SubmissionValidationCode.MISSING_MEDIA,
        field: 'mediaFiles',
        mediaType,
        message: hasIncompleteUpload
          ? `${mediaType} upload has not completed`
          : `${mediaType} media is required for ${submission.submissionType}`,
      });
      correctionRequirements.push({
        code: hasIncompleteUpload
          ? CorrectionRequirementCode.COMPLETE_UPLOAD
          : CorrectionRequirementCode.UPLOAD_MEDIA,
        field: 'mediaFiles',
        mediaType,
        message: hasIncompleteUpload
          ? `Complete the ${mediaType} upload`
          : `Upload the required ${mediaType} media`,
      });
    }

    if (!contract.allowedCoordinateSources.includes(submission.coordinateSource)) {
      validationErrors.push({
        code: SubmissionValidationCode.INVALID_COORDINATE_SOURCE,
        field: 'coordinateSource',
        message: `${submission.coordinateSource} is not valid for ${submission.submissionType}`,
      });
      correctionRequirements.push({
        code: CorrectionRequirementCode.CHANGE_COORDINATE_SOURCE,
        field: 'coordinateSource',
        message: `Use one of: ${contract.allowedCoordinateSources.join(', ')}`,
      });
    }

    if (submission.capturedAt.getTime() > Date.now() + 5 * 60 * 1000) {
      validationErrors.push({
        code: SubmissionValidationCode.CAPTURE_TIME_IN_FUTURE,
        field: 'capturedAt',
        message: 'Capture time cannot be more than five minutes in the future',
      });
      correctionRequirements.push({
        code: CorrectionRequirementCode.CONFIRM_CAPTURE_TIME,
        field: 'capturedAt',
        message: 'Correct or confirm the media capture time',
      });
    }

    return { validationErrors, correctionRequirements };
  }

  private async findOwnedSubmission(userId: string, submissionId: string) {
    const submission = await this.submissionRepo.findOne({ where: { id: submissionId } });
    if (!submission) throw new NotFoundException('SurveySubmission ' + submissionId + ' not found');
    if (submission.surveyorId !== userId) {
      throw new BadRequestException('Submission does not belong to the authenticated user');
    }
    return submission;
  }

  private assertEditableSubmission(submission: SurveySubmission) {
    if (![SubmissionStatus.DRAFT, SubmissionStatus.PENDING_CORRECTION].includes(submission.status)) {
      throw new ConflictException(`Submission cannot be edited while status is ${submission.status}`);
    }
  }

  private submissionResponse(submission: SurveySubmission) {
    const contract = SUBMISSION_TYPE_CONTRACTS[submission.submissionType];
    return {
      ...submission,
      requiredMediaTypes: contract.requiredMediaTypes,
      allowedCoordinateSources: contract.allowedCoordinateSources,
      validationErrors: submission.validationErrors ?? [],
      correctionRequirements: submission.correctionRequirements ?? [],
    };
  }

  private async recordStatusChange(
    submissionId: string,
    oldStatus: SubmissionStatus | null,
    newStatus: SubmissionStatus,
    note: string,
  ) {
    try {
      await this.dataSource.query(
        'INSERT INTO submission_status_history (submission_id, old_status, new_status, note) VALUES ($1, $2::submission_status, $3::submission_status, $4)',
        [submissionId, oldStatus, newStatus, note],
      );
    } catch (error: any) {
      this.logger.warn('history insert failed: ' + error?.message);
    }
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
    return { items: items.map((item) => this.submissionResponse(item)), total, page: p, pageSize: ps, totalPages: Math.ceil(total / ps) };
  }
  async getSubmissionStatus(userId: string, submissionId: string) {
    const sub = await this.submissionRepo.findOne({ where: { id: submissionId } as any });
    if (!sub) throw new NotFoundException('SurveySubmission ' + submissionId + ' not found');
    if (sub.surveyorId !== userId) throw new BadRequestException('Submission does not belong to the authenticated user');
    let history: any[] = [];
    let candidates: any[] = [];
    let sessions: any[] = [];
    let mediaFiles: any[] = [];
    try { history = await this.dataSource.query('SELECT id, old_status, new_status, note, changed_at FROM submission_status_history WHERE submission_id=$1 ORDER BY changed_at ASC', [submissionId]); } catch (e: any) { this.logger.warn('history query failed: ' + e?.message); }
    try { candidates = await this.dataSource.query('SELECT id, predicted_sign_type_id, status, confidence_score, best_frame_url, sign_crop_url, active_learning_priority, created_at FROM unverified_sign_candidates WHERE submission_id=$1 ORDER BY created_at ASC', [submissionId]); } catch (e: any) { this.logger.warn('candidate query failed: ' + e?.message); }
    try { sessions = await this.dataSource.query('SELECT id, original_filename, media_type, total_chunks, received_chunks, status, created_at FROM upload_sessions WHERE submission_id=$1 ORDER BY created_at ASC', [submissionId]); } catch {}
    try { mediaFiles = await this.dataSource.query('SELECT id, upload_session_id, media_type, file_url, file_size_bytes, duration_seconds, checksum, uploaded_at FROM submission_media_files WHERE submission_id=$1 ORDER BY uploaded_at ASC', [submissionId]); } catch {}
    return { submission: this.submissionResponse(sub), history, candidates, totalCandidates: candidates.length, sessions, mediaFiles };
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

  async advanceSubmissionStatus(
    submissionId: string,
    newStatus: SubmissionStatus,
    note?: string,
    validationErrors?: SubmissionContractIssue[],
    correctionRequirements?: SubmissionContractIssue[],
  ) {
    const sub = await this.submissionRepo.findOne({ where: { id: submissionId } });
    if (!sub) throw new NotFoundException('SurveySubmission ' + submissionId + ' not found');
    const terminal: string[] = [SubmissionStatus.COMPLETED as string, SubmissionStatus.FAILED as string, SubmissionStatus.PARTIALLY_PROCESSED as string, SubmissionStatus.NO_SIGN_DETECTED as string];
    if (terminal.includes(String(sub.status))) return { alreadyTerminal: true, submission: sub, status: sub.status };
    if (
      [SubmissionStatus.DRAFT, SubmissionStatus.PENDING_CORRECTION].includes(sub.status) &&
      newStatus !== SubmissionStatus.PENDING_CORRECTION
    ) {
      throw new ConflictException('Submission must pass contract validation before processing');
    }
    const oldStatus = sub.status;
    sub.status = newStatus;
    if (validationErrors !== undefined) sub.validationErrors = validationErrors;
    if (correctionRequirements !== undefined) sub.correctionRequirements = correctionRequirements;
    await this.submissionRepo.save(sub);
    try { await this.dataSource.query('INSERT INTO submission_status_history (submission_id, old_status, new_status, note) VALUES ($1, $2::submission_status, $3::submission_status, $4)', [sub.id, String(oldStatus), String(newStatus), note ?? 'Status advanced to ' + newStatus]); } catch (e: any) { this.logger.warn('history insert failed: ' + e?.message); }
    return { previousStatus: oldStatus, newStatus, submission: sub };
  }
  async markCompleted(submissionId: string, note?: string) {
    const sub = await this.submissionRepo.findOne({ where: { id: submissionId } });
    if (!sub) throw new NotFoundException('SurveySubmission ' + submissionId + ' not found');
    if (sub.status === SubmissionStatus.COMPLETED) return { alreadyCompleted: true, submission: sub };
    if ([SubmissionStatus.DRAFT, SubmissionStatus.PENDING_CORRECTION].includes(sub.status)) {
      throw new ConflictException('Submission must pass contract validation before completion');
    }
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
