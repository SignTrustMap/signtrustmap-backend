import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BatchSurveyService } from './batch-survey.service';
import {
  BatchSubmission,
  BatchProcessingStatus,
  BatchRewardStatus,
} from '../infrastructure/persistence/batch-submission.entity';
import { TransactionType } from '../../wallet/infrastructure/persistence/credit-transaction.entity';

describe('BatchSurveyService (Phase 2 Batch Survey Ingestion)', () => {
  let service: BatchSurveyService;
  let batchRepo: any;
  let dataSource: any;
  let rewardEngine: any;
  let walletService: any;
  let notificationsService: any;

  beforeEach(() => {
    batchRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn((dto: any) => ({
        id: 'batch-123',
        createdAt: new Date(),
        updatedAt: new Date(),
        ...dto,
      }) as BatchSubmission),
      save: jest.fn(async (b: any) => b),
    };

    dataSource = {
      query: jest.fn().mockResolvedValue([]),
    };

    rewardEngine = {
      calculateReward: jest.fn().mockResolvedValue({
        eligible: true,
        amount: 25,
        baseAmount: 10,
        dailyLimit: 20,
        currentDailyCount: 0,
      }),
    };

    walletService = {
      creditUser: jest.fn().mockResolvedValue({ balance: 125n }),
    };

    notificationsService = {
      create: jest.fn().mockResolvedValue({ id: 'notif-1' }),
    };

    service = new BatchSurveyService(
      batchRepo,
      dataSource,
      rewardEngine,
      walletService,
      notificationsService,
    );
  });

  describe('createBatch', () => {
    it('throws BadRequestException if images array is missing or empty', async () => {
      await expect(
        service.createBatch('user-1', {
          images: [],
          capturedAt: new Date().toISOString(),
          coordinateSource: 'EXIF_GPS' as any,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException if user exceeds daily batch quota of 10', async () => {
      batchRepo.count.mockResolvedValue(10);

      await expect(
        service.createBatch('user-1', {
          images: [{ storageKey: 'bucket/img1.jpg', latitude: 10.8, longitude: 106.6 }],
          capturedAt: new Date().toISOString(),
          coordinateSource: 'EXIF_GPS' as any,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates and saves batch submission successfully', async () => {
      batchRepo.count.mockResolvedValue(3);

      const result = await service.createBatch('user-1', {
        title: 'Morning Route Batch',
        images: [
          { storageKey: 'bucket/img1.jpg', latitude: 10.8, longitude: 106.6 },
          { storageKey: 'bucket/img2.jpg', latitude: 10.81, longitude: 106.61 },
        ],
        capturedAt: new Date().toISOString(),
        coordinateSource: 'EXIF_GPS' as any,
      });

      expect(result.batchId).toBe('batch-123');
      expect(result.totalImages).toBe(2);
      expect(result.status).toBe(BatchProcessingStatus.PENDING);
      expect(result.rewardStatus).toBe(BatchRewardStatus.PENDING);
      expect(batchRepo.save).toHaveBeenCalled();
    });
  });

  describe('getBatch', () => {
    it('throws NotFoundException if batch does not exist', async () => {
      batchRepo.findOne.mockResolvedValue(null);
      await expect(service.getBatch('user-1', 'batch-999')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException if batch belongs to another user', async () => {
      batchRepo.findOne.mockResolvedValue({
        id: 'batch-123',
        userId: 'other-user',
      });
      await expect(service.getBatch('user-1', 'batch-123')).rejects.toThrow(NotFoundException);
    });

    it('returns batch details when user matches', async () => {
      batchRepo.findOne.mockResolvedValue({
        id: 'batch-123',
        userId: 'user-1',
        title: 'Batch Survey',
        totalImages: 5,
        processedImages: 5,
        extractedCandidates: 3,
        status: BatchProcessingStatus.COMPLETED,
        rewardStatus: BatchRewardStatus.PAID,
        rewardAmount: 25,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const batch = await service.getBatch('user-1', 'batch-123');
      expect(batch.id).toBe('batch-123');
      expect(batch.extractedCandidates).toBe(3);
      expect(batch.rewardStatus).toBe(BatchRewardStatus.PAID);
    });
  });

  describe('completeBatch', () => {
    it('is idempotent: returns alreadyCompleted: true if batch was previously completed', async () => {
      const mockBatch: any = {
        id: 'batch-123',
        userId: 'user-1',
        status: BatchProcessingStatus.COMPLETED,
        totalImages: 2,
        processedImages: 2,
        extractedCandidates: 1,
      };
      batchRepo.findOne.mockResolvedValue(mockBatch);

      const res = await service.completeBatch('batch-123', {
        extractedCandidates: 1,
        totalProcessed: 2,
      });

      expect(res.alreadyCompleted).toBe(true);
      expect(walletService.creditUser).not.toHaveBeenCalled();
    });

    it('gating: withholds reward (REJECTED, 0 credits) when extractedCandidates === 0', async () => {
      const mockBatch: any = {
        id: 'batch-123',
        userId: 'user-1',
        status: BatchProcessingStatus.PROCESSING,
        totalImages: 4,
        processedImages: 0,
        extractedCandidates: 0,
      };
      batchRepo.findOne.mockResolvedValue(mockBatch);

      const res = await service.completeBatch('batch-123', {
        extractedCandidates: 0,
        totalProcessed: 4,
      });

      expect(res.alreadyCompleted).toBe(false);
      expect(res.rewardAmount).toBe(0);
      expect(mockBatch.status).toBe(BatchProcessingStatus.COMPLETED);
      expect(mockBatch.rewardStatus).toBe(BatchRewardStatus.REJECTED);
      expect(notificationsService.create).toHaveBeenCalledWith(
        'user-1',
        'BATCH_COMPLETED_NO_SIGNS',
        expect.any(String),
        expect.any(String),
        'batch_submission',
        'batch-123',
      );
      expect(walletService.creditUser).not.toHaveBeenCalled();
    });

    it('anti-abuse: withholds reward (WITHHELD) when velocity limit is exceeded', async () => {
      const mockBatch: any = {
        id: 'batch-123',
        userId: 'user-1',
        status: BatchProcessingStatus.PROCESSING,
        totalImages: 3,
        processedImages: 0,
        extractedCandidates: 0,
      };
      batchRepo.findOne.mockResolvedValue(mockBatch);
      // Simulate > 10 batches in the last 10 minutes
      batchRepo.count.mockResolvedValue(12);

      const res = await service.completeBatch('batch-123', {
        extractedCandidates: 2,
        totalProcessed: 3,
      });

      expect(res.alreadyCompleted).toBe(false);
      expect(res.rewardAmount).toBe(0);
      expect(mockBatch.rewardStatus).toBe(BatchRewardStatus.WITHHELD);
      expect(walletService.creditUser).not.toHaveBeenCalled();
      expect(notificationsService.create).toHaveBeenCalledWith(
        'user-1',
        'BATCH_REWARD_WITHHELD',
        expect.any(String),
        expect.any(String),
        'batch_submission',
        'batch-123',
      );
    });

    it('daily limit: marks rewardStatus NONE when rewardEngine returns ineligible', async () => {
      const mockBatch: any = {
        id: 'batch-123',
        userId: 'user-1',
        status: BatchProcessingStatus.PROCESSING,
        totalImages: 2,
        processedImages: 0,
        extractedCandidates: 0,
      };
      batchRepo.findOne.mockResolvedValue(mockBatch);
      batchRepo.count.mockResolvedValue(2);
      rewardEngine.calculateReward.mockResolvedValue({
        eligible: false,
        amount: 0,
        reason: 'DAILY_LIMIT_REACHED',
      });

      const res = await service.completeBatch('batch-123', {
        extractedCandidates: 2,
        totalProcessed: 2,
      });

      expect(res.rewardAmount).toBe(0);
      expect(mockBatch.rewardStatus).toBe(BatchRewardStatus.NONE);
      expect(walletService.creditUser).not.toHaveBeenCalled();
      expect(notificationsService.create).toHaveBeenCalledWith(
        'user-1',
        'BATCH_DAILY_LIMIT',
        expect.any(String),
        expect.any(String),
        'batch_submission',
        'batch-123',
      );
    });

    it('success: credits wallet, updates surveyor profile, and marks PAID', async () => {
      const mockBatch: any = {
        id: 'batch-123',
        userId: 'user-1',
        status: BatchProcessingStatus.PROCESSING,
        totalImages: 3,
        processedImages: 0,
        extractedCandidates: 0,
      };
      batchRepo.findOne.mockResolvedValue(mockBatch);
      batchRepo.count.mockResolvedValue(2);
      rewardEngine.calculateReward.mockResolvedValue({
        eligible: true,
        amount: 35,
      });

      const res = await service.completeBatch('batch-123', {
        extractedCandidates: 3,
        totalProcessed: 3,
      });

      expect(res.rewardAmount).toBe(35);
      expect(mockBatch.status).toBe(BatchProcessingStatus.COMPLETED);
      expect(mockBatch.rewardStatus).toBe(BatchRewardStatus.PAID);
      expect(mockBatch.rewardAmount).toBe(35);

      expect(walletService.creditUser).toHaveBeenCalledWith(
        'user-1',
        35,
        TransactionType.SURVEY_REWARD,
        'batch_submission',
        'batch-123',
        expect.stringContaining('Batch survey reward'),
        { idempotencyKey: 'batch_reward:batch-123' },
      );
      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('surveyor_profiles'),
        ['user-1', 3, 35],
      );
      expect(notificationsService.create).toHaveBeenCalledWith(
        'user-1',
        'BATCH_REWARD_PAID',
        expect.any(String),
        expect.any(String),
        'batch_submission',
        'batch-123',
      );
    });

    it('wallet failure fallback: marks rewardStatus APPROVED if creditUser throws', async () => {
      const mockBatch: any = {
        id: 'batch-123',
        userId: 'user-1',
        status: BatchProcessingStatus.PROCESSING,
        totalImages: 2,
        processedImages: 0,
        extractedCandidates: 0,
      };
      batchRepo.findOne.mockResolvedValue(mockBatch);
      batchRepo.count.mockResolvedValue(1);
      rewardEngine.calculateReward.mockResolvedValue({
        eligible: true,
        amount: 20,
      });
      walletService.creditUser.mockRejectedValue(new Error('Wallet database timeout'));

      const res = await service.completeBatch('batch-123', {
        extractedCandidates: 2,
        totalProcessed: 2,
      });

      expect(mockBatch.rewardStatus).toBe(BatchRewardStatus.APPROVED);
      expect(mockBatch.rewardAmount).toBe(20);
      expect(res.rewardAmount).toBe(20);
    });
  });
});
