import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DailyTasksService } from './daily-tasks.service';
import { DailyTaskCompletion } from './daily-task-completion.entity';
import { TransactionType } from '../wallet/infrastructure/persistence/credit-transaction.entity';

describe('DailyTasksService (Phase 3 Daily Task Engine & Redlock Mutex)', () => {
  let service: DailyTasksService;
  let taskRepo: any;
  let completionRepo: any;
  let walletService: any;
  let redisService: any;
  let notificationsService: any;
  let dataSource: any;

  beforeEach(() => {
    taskRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
    };

    completionRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((dto: any) => ({
        id: 'comp-1',
        progress: 0,
        isCompleted: false,
        claimed: false,
        claimedAt: null,
        ...dto,
      }) as DailyTaskCompletion),
      save: jest.fn(async (c: any) => c),
    };

    walletService = {
      creditUser: jest.fn().mockResolvedValue({
        txId: 'tx-1',
        walletId: 'w-1',
        newBalance: 130,
      }),
    };

    redisService = {
      acquireLock: jest.fn().mockResolvedValue('lock-token-123'),
      releaseLock: jest.fn().mockResolvedValue(true),
    };

    notificationsService = {
      create: jest.fn().mockResolvedValue({ id: 'notif-1' }),
    };

    dataSource = {
      query: jest.fn().mockResolvedValue([]),
    };

    service = new DailyTasksService(
      taskRepo,
      completionRepo,
      walletService,
      redisService,
      notificationsService,
      dataSource,
    );
  });

  describe('listActive', () => {
    it('returns all active tasks ordered by id', async () => {
      const mockTasks = [
        { id: 1, taskCode: 'SURVEY_3', targetCount: 3, rewardCredits: 30 },
      ];
      taskRepo.find.mockResolvedValue(mockTasks);

      const res = await service.listActive();
      expect(res).toEqual(mockTasks);
      expect(taskRepo.find).toHaveBeenCalledWith({ where: { isActive: true }, order: { id: 'ASC' } });
    });
  });

  describe('listTasksWithProgress', () => {
    it('returns tasks joined with user progress and claimability indicators', async () => {
      const mockTasks = [
        { id: 1, taskCode: 'SURVEY_3', name: 'Khảo sát 3 biển báo', targetCount: 3, rewardCredits: 30, activityType: 'SURVEY' },
        { id: 2, taskCode: 'REVIEW_5', name: 'Xác minh 5 biển báo ứng viên', targetCount: 5, rewardCredits: 25, activityType: 'REVIEW' },
      ];
      taskRepo.find.mockResolvedValue(mockTasks);

      completionRepo.find.mockResolvedValue([
        { dailyTaskId: 1, progress: 3, isCompleted: true, claimed: false },
      ]);

      const res = await service.listTasksWithProgress('user-1');

      expect(res).toHaveLength(2);
      // Task 1: Complete and claimable
      expect(res[0].id).toBe(1);
      expect(res[0].progress).toBe(3);
      expect(res[0].isCompleted).toBe(true);
      expect(res[0].isClaimable).toBe(true);
      expect(res[0].isClaimed).toBe(false);

      // Task 2: No completion record -> 0 progress
      expect(res[1].id).toBe(2);
      expect(res[1].progress).toBe(0);
      expect(res[1].isCompleted).toBe(false);
      expect(res[1].isClaimable).toBe(false);
      expect(res[1].isClaimed).toBe(false);
    });
  });

  describe('recordProgress', () => {
    it('returns empty array when count is <= 0 or no matching tasks exist', async () => {
      taskRepo.find.mockResolvedValue([]);
      const res0 = await service.recordProgress('user-1', 'SURVEY', 0);
      expect(res0).toEqual([]);

      const resNoTasks = await service.recordProgress('user-1', 'UNKNOWN', 1);
      expect(resNoTasks).toEqual([]);
    });

    it('creates new completion and increments progress when none exists', async () => {
      taskRepo.find.mockResolvedValue([
        { id: 1, taskCode: 'SURVEY_3', targetCount: 3, activityType: 'SURVEY' },
      ]);
      completionRepo.findOne.mockResolvedValue(null);

      const res = await service.recordProgress('user-1', 'SURVEY', 2);

      expect(res).toHaveLength(1);
      expect(res[0].progress).toBe(2);
      expect(res[0].isCompleted).toBe(false);
      expect(completionRepo.save).toHaveBeenCalled();
    });

    it('completes task when progress reaches targetCount', async () => {
      taskRepo.find.mockResolvedValue([
        { id: 1, taskCode: 'SURVEY_3', targetCount: 3, activityType: 'SURVEY' },
      ]);
      const existingCompletion: any = {
        id: 'comp-1',
        dailyTaskId: 1,
        progress: 2,
        isCompleted: false,
      };
      completionRepo.findOne.mockResolvedValue(existingCompletion);

      const res = await service.recordProgress('user-1', 'SURVEY', 2);

      expect(res[0].progress).toBe(3);
      expect(res[0].isCompleted).toBe(true);
    });

    it('skips incrementing already completed task', async () => {
      taskRepo.find.mockResolvedValue([
        { id: 1, taskCode: 'SURVEY_3', targetCount: 3, activityType: 'SURVEY' },
      ]);
      const existingCompletion: any = {
        id: 'comp-1',
        dailyTaskId: 1,
        progress: 3,
        isCompleted: true,
      };
      completionRepo.findOne.mockResolvedValue(existingCompletion);

      const res = await service.recordProgress('user-1', 'SURVEY', 1);

      expect(res).toHaveLength(0);
      expect(completionRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('claim (with Redis Redlock Mutex)', () => {
    it('throws ConflictException if distributed lock cannot be acquired', async () => {
      redisService.acquireLock.mockResolvedValue(null);

      await expect(service.claim('user-1', 1)).rejects.toThrow(ConflictException);
      expect(taskRepo.findOne).not.toHaveBeenCalled();
      expect(redisService.releaseLock).not.toHaveBeenCalled();
    });

    it('throws NotFoundException if task does not exist', async () => {
      taskRepo.findOne.mockResolvedValue(null);

      await expect(service.claim('user-1', 99)).rejects.toThrow(NotFoundException);
      expect(redisService.releaseLock).toHaveBeenCalledWith(
        expect.stringContaining('user-1:99'),
        'lock-token-123',
      );
    });

    it('throws BadRequestException if task is inactive', async () => {
      taskRepo.findOne.mockResolvedValue({ id: 1, isActive: false });

      await expect(service.claim('user-1', 1)).rejects.toThrow(BadRequestException);
      expect(redisService.releaseLock).toHaveBeenCalled();
    });

    it('throws BadRequestException if no completion record exists today', async () => {
      taskRepo.findOne.mockResolvedValue({ id: 1, isActive: true });
      completionRepo.findOne.mockResolvedValue(null);

      await expect(service.claim('user-1', 1)).rejects.toThrow(BadRequestException);
      expect(redisService.releaseLock).toHaveBeenCalled();
    });

    it('throws BadRequestException if task is incomplete', async () => {
      taskRepo.findOne.mockResolvedValue({ id: 1, isActive: true, targetCount: 3 });
      completionRepo.findOne.mockResolvedValue({
        id: 'comp-1',
        progress: 1,
        isCompleted: false,
        claimed: false,
      });

      await expect(service.claim('user-1', 1)).rejects.toThrow(BadRequestException);
      expect(redisService.releaseLock).toHaveBeenCalled();
    });

    it('throws ConflictException if reward was already claimed', async () => {
      taskRepo.findOne.mockResolvedValue({ id: 1, isActive: true, targetCount: 3 });
      completionRepo.findOne.mockResolvedValue({
        id: 'comp-1',
        progress: 3,
        isCompleted: true,
        claimed: true,
      });

      await expect(service.claim('user-1', 1)).rejects.toThrow(ConflictException);
      expect(redisService.releaseLock).toHaveBeenCalled();
    });

    it('successfully claims reward: marks claimed, credits wallet, sends notification, releases lock', async () => {
      taskRepo.findOne.mockResolvedValue({
        id: 1,
        taskCode: 'SURVEY_3',
        name: 'Survey 3 Signs',
        rewardCredits: 30,
        targetCount: 3,
        isActive: true,
      });
      const mockCompletion: any = {
        id: 'comp-1',
        dailyTaskId: 1,
        progress: 3,
        isCompleted: true,
        claimed: false,
      };
      completionRepo.findOne.mockResolvedValue(mockCompletion);

      const res = await service.claim('user-1', 1);

      expect(mockCompletion.claimed).toBe(true);
      expect(mockCompletion.claimedAt).toBeInstanceOf(Date);
      expect(completionRepo.save).toHaveBeenCalledWith(mockCompletion);

      expect(walletService.creditUser).toHaveBeenCalledWith(
        'user-1',
        30,
        TransactionType.DAILY_TASK_REWARD,
        'daily_task',
        'comp-1',
        expect.stringContaining('SURVEY_3'),
        expect.objectContaining({ idempotencyKey: expect.stringContaining('user-1:1:') }),
      );

      expect(notificationsService.create).toHaveBeenCalledWith(
        'user-1',
        'DAILY_TASK_CLAIMED',
        expect.any(String),
        expect.any(String),
        'daily_task',
        '1',
      );

      expect(redisService.releaseLock).toHaveBeenCalledWith(
        expect.stringContaining('user-1:1:'),
        'lock-token-123',
      );

      expect(res.reward).toBe(30);
      expect(res.wallet.balance).toBe(130);
      expect(res.completion.claimed).toBe(true);
    });
  });

  describe('rolloverUnclaimedTasks', () => {
    it('returns count of unclaimed completed tasks from previous date', async () => {
      completionRepo.find.mockResolvedValue([{ id: 'comp-1' }, { id: 'comp-2' }]);

      const res = await service.rolloverUnclaimedTasks('2026-09-24');
      expect(res.rolledOverDate).toBe('2026-09-24');
      expect(res.unclaimedCount).toBe(2);
    });
  });
});
