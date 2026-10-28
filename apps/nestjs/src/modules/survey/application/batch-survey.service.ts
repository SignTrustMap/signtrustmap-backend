import { Injectable, NotFoundException, BadRequestException, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, MoreThanOrEqual } from 'typeorm';
import {
  BatchSubmission,
  BatchProcessingStatus,
  BatchRewardStatus,
} from '../infrastructure/persistence/batch-submission.entity';
import { SurveyorProfile } from '../infrastructure/persistence/surveyor-profile.entity';
import { AuditLog } from '../../admin/audit-log.entity';
import { CreateBatchSurveyDto } from '../presentation/dto/create-batch-survey.dto';
import { RewardEngineService } from '../../rewards/application/reward-engine.service';
import { WalletService } from '../../wallet/application/wallet.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { DailyTasksService } from '../../daily-tasks/daily-tasks.service';
import { TransactionType } from '../../wallet/infrastructure/persistence/credit-transaction.entity';

@Injectable()
export class BatchSurveyService {
  private readonly logger = new Logger(BatchSurveyService.name);

  constructor(
    @InjectRepository(BatchSubmission)
    private readonly batchRepo: Repository<BatchSubmission>,
    private readonly dataSource: DataSource,
    private readonly rewardEngine: RewardEngineService,
    private readonly walletService: WalletService,
    private readonly notificationsService: NotificationsService,
    @Optional() private readonly dailyTasksService?: DailyTasksService,
    @Optional()
    @InjectRepository(SurveyorProfile)
    private readonly surveyorProfileRepo?: Repository<SurveyorProfile>,
    @Optional()
    @InjectRepository(AuditLog)
    private readonly auditLogRepo?: Repository<AuditLog>,
  ) {}

  /**
   * Create a new batch survey submission containing multiple geo-tagged images
   */
  async createBatch(userId: string, dto: CreateBatchSurveyDto) {
    if (!dto.images || dto.images.length === 0) {
      throw new BadRequestException('At least one image is required in a batch submission');
    }

    // Daily batch quota check (up to 10 batches per day)
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const countToday = await this.batchRepo.count({
      where: {
        userId,
        createdAt: MoreThanOrEqual(startOfDay),
      } as any,
    });
    if (countToday >= 10) {
      throw new BadRequestException('Daily batch submission quota exceeded (maximum 10 batches per day).');
    }

    // Persist batch record
    const batch = this.batchRepo.create({
      userId,
      title: dto.title ?? `Batch survey with ${dto.images.length} images`,
      totalImages: dto.images.length,
      processedImages: 0,
      extractedCandidates: 0,
      rewardStatus: BatchRewardStatus.PENDING,
      rewardAmount: 0,
      status: BatchProcessingStatus.PENDING,
      metadata: {
        capturedAt: dto.capturedAt,
        coordinateSource: dto.coordinateSource,
        note: dto.note ?? null,
        images: dto.images,
      },
    });

    const saved = await this.batchRepo.save(batch);

    // Record submission into outbox/event log
    try {
      if (this.auditLogRepo) {
        await this.auditLogRepo.save(
          this.auditLogRepo.create({
            userId,
            action: 'CREATE_BATCH_SUBMISSION',
            resourceName: 'batch_submissions',
            resourceId: saved.id,
            newValues: { totalImages: saved.totalImages, title: saved.title },
          }),
        );
      } else {
        await this.dataSource.query(
          `INSERT INTO audit_logs (user_id, action, resource_name, resource_id, new_values)
           VALUES ($1, 'CREATE_BATCH_SUBMISSION', 'batch_submissions', $2, $3)`,
          [userId, saved.id, JSON.stringify({ totalImages: saved.totalImages, title: saved.title })],
        );
      }
    } catch {}

    // Advance daily task progress for survey contribution
    if (this.dailyTasksService) {
      this.dailyTasksService.recordProgress(userId, 'SURVEY', dto.images.length).catch(() => {});
    }

    return {
      batchId: saved.id,
      title: saved.title,
      totalImages: saved.totalImages,
      status: saved.status,
      rewardStatus: saved.rewardStatus,
      createdAt: saved.createdAt,
    };
  }

  /**
   * Get live progress of a batch submission
   */
  async getBatch(userId: string, batchId: string) {
    const batch = await this.batchRepo.findOne({ where: { id: batchId } });
    if (!batch) throw new NotFoundException(`Batch submission #${batchId} not found`);
    if (batch.userId !== userId) throw new NotFoundException(`Batch submission #${batchId} not found`);

    return {
      id: batch.id,
      title: batch.title,
      totalImages: batch.totalImages,
      processedImages: batch.processedImages,
      extractedCandidates: batch.extractedCandidates,
      status: batch.status,
      rewardStatus: batch.rewardStatus,
      rewardAmount: batch.rewardAmount,
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt,
    };
  }

  /**
   * Internal worker callback upon completing batch inference & candidate extraction
   */
  async completeBatch(
    batchId: string,
    payload: { extractedCandidates: number; totalProcessed?: number; note?: string },
  ) {
    const batch = await this.batchRepo.findOne({ where: { id: batchId } });
    if (!batch) throw new NotFoundException(`Batch submission #${batchId} not found`);

    if (batch.status === BatchProcessingStatus.COMPLETED) {
      return { alreadyCompleted: true, batch };
    }

    batch.processedImages = payload.totalProcessed ?? batch.totalImages;
    batch.extractedCandidates = Math.max(0, payload.extractedCandidates);
    batch.status = BatchProcessingStatus.COMPLETED;

    // Candidate-gated reward settlement
    if (batch.extractedCandidates === 0) {
      batch.rewardStatus = BatchRewardStatus.REJECTED;
      batch.rewardAmount = 0;
      await this.batchRepo.save(batch);

      try {
        await this.notificationsService.create(
          batch.userId,
          'BATCH_COMPLETED_NO_SIGNS',
          'Lô khảo sát đã hoàn tất',
          `Lô khảo sát ${batch.id.slice(0, 8)} đã xử lý ${batch.processedImages} ảnh nhưng không phát hiện biển báo giao thông nào (0 credits).`,
          'batch_submission',
          batch.id,
        );
      } catch {}

      return { alreadyCompleted: false, batch, rewardAmount: 0 };
    }

    // Candidate(s) detected: evaluate anti-abuse velocity check
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const recentBatchesCount = await this.batchRepo.count({
      where: {
        userId: batch.userId,
        createdAt: MoreThanOrEqual(tenMinutesAgo),
      } as any,
    });

    if (recentBatchesCount > 10) {
      // Flag anomalous velocity for staff moderation
      batch.rewardStatus = BatchRewardStatus.WITHHELD;
      batch.rewardAmount = 0;
      await this.batchRepo.save(batch);

      try {
        await this.notificationsService.create(
          batch.userId,
          'BATCH_REWARD_WITHHELD',
          'Lô khảo sát đang được kiểm tra',
          `Lô khảo sát ${batch.id.slice(0, 8)} đã được gửi kiểm tra do vượt giới hạn tần suất đóng góp.`,
          'batch_submission',
          batch.id,
        );
      } catch {}

      return { alreadyCompleted: false, batch, rewardAmount: 0 };
    }

    // Calculate dynamic reward via RewardEngineService
    const rewardEval = await this.rewardEngine.calculateReward(
      batch.userId,
      TransactionType.SURVEY_REWARD,
      { candidateCount: batch.extractedCandidates },
    );

    if (!rewardEval.eligible || rewardEval.amount <= 0) {
      batch.rewardStatus = BatchRewardStatus.NONE;
      batch.rewardAmount = 0;
      await this.batchRepo.save(batch);

      try {
        await this.notificationsService.create(
          batch.userId,
          'BATCH_DAILY_LIMIT',
          'Đã đạt giới hạn hằng ngày',
          `Lô khảo sát ${batch.id.slice(0, 8)} đã được xử lý thành công nhưng đã đạt giới hạn thưởng khảo sát trong ngày.`,
          'batch_submission',
          batch.id,
        );
      } catch {}

      return { alreadyCompleted: false, batch, rewardAmount: 0 };
    }

    // Payout candidate-gated credit reward to user wallet
    const payoutAmount = rewardEval.amount;
    try {
      await this.walletService.creditUser(
        batch.userId,
        payoutAmount,
        TransactionType.SURVEY_REWARD,
        'batch_submission',
        batch.id,
        `Batch survey reward (${batch.extractedCandidates} candidate(s) extracted from ${batch.totalImages} images)`,
        { idempotencyKey: `batch_reward:${batch.id}` },
      );
      batch.rewardStatus = BatchRewardStatus.PAID;
      batch.rewardAmount = payoutAmount;
    } catch (e: any) {
      this.logger.warn(`Batch reward credit failed for user ${batch.userId}: ${e?.message}`);
      batch.rewardStatus = BatchRewardStatus.APPROVED;
      batch.rewardAmount = payoutAmount;
    }

    await this.batchRepo.save(batch);

    // Update contributor profile
    try {
      if (this.surveyorProfileRepo) {
        const surveyor = await this.surveyorProfileRepo.findOne({ where: { userId: batch.userId } });
        if (!surveyor) {
          await this.surveyorProfileRepo.save(
            this.surveyorProfileRepo.create({
              userId: batch.userId,
              totalSubmissions: batch.totalImages,
              totalVerifiedSigns: 0,
              totalCreditsEarned: payoutAmount,
            }),
          );
        } else {
          await this.surveyorProfileRepo.update(
            { userId: batch.userId },
            {
              totalSubmissions: () => `total_submissions + ${batch.totalImages}`,
              totalCreditsEarned: () => `total_credits_earned + ${payoutAmount}`,
            },
          );
        }
      } else {
        await this.dataSource.query(
          `INSERT INTO surveyor_profiles (user_id, total_submissions, total_verified_signs, total_credits_earned)
           VALUES ($1, $2, 0, $3)
           ON CONFLICT (user_id) DO UPDATE SET
             total_submissions = surveyor_profiles.total_submissions + $2,
             total_credits_earned = surveyor_profiles.total_credits_earned + $3`,
          [batch.userId, batch.totalImages, payoutAmount],
        );
      }
    } catch {}

    // Send confirmation notification
    try {
      await this.notificationsService.create(
        batch.userId,
        'BATCH_REWARD_PAID',
        'Đã nhận thưởng lô khảo sát',
        `Lô khảo sát ${batch.id.slice(0, 8)} đã được xác minh và trích xuất ${batch.extractedCandidates} ứng viên biển báo (+${payoutAmount} credits).`,
        'batch_submission',
        batch.id,
      );
    } catch {}

    return { alreadyCompleted: false, batch, rewardAmount: payoutAmount };
  }
}
