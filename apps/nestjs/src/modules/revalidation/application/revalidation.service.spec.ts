import { DataSource, Repository } from 'typeorm';
import { MinioStorageService } from '../../../integrations/minio/minio-storage.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { WalletService } from '../../wallet/application/wallet.service';
import { RevalidationDecision } from '../infrastructure/persistence/revalidation-decision.entity';
import { RevalidationEvidence } from '../infrastructure/persistence/revalidation-evidence.entity';
import {
  RevalidationTask,
  TaskStatus,
} from '../infrastructure/persistence/revalidation-task.entity';
import { RevalidationService } from './revalidation.service';

describe('RevalidationService', () => {
  it('binds evidence IDs as an array when loading final decisions', async () => {
    const task = {
      id: 'task-id',
      verifiedSignId: 'verified-sign-id',
      status: TaskStatus.OPEN,
      rewardCredits: 10,
    } as RevalidationTask;
    const tasks = {
      findOne: jest.fn().mockResolvedValue(task),
      save: jest.fn(async (value) => value),
    } as unknown as Repository<RevalidationTask>;
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('SELECT id, user_id FROM revalidation_evidences')) {
        return [{ id: 'evidence-id', user_id: 'surveyor-id' }];
      }
      if (sql.includes('SELECT decision, reviewer_id, evidence_id')) {
        return [
          {
            decision: 'UNCHANGED',
            reviewer_id: 'reviewer-id',
            evidence_id: 'evidence-id',
          },
        ];
      }
      return [];
    });
    const wallet = {
      resolveRewardAmount: jest.fn().mockResolvedValue(10),
      creditUser: jest.fn().mockResolvedValue(undefined),
    } as unknown as WalletService;
    const notifications = {
      createBulk: jest.fn().mockResolvedValue(undefined),
    } as unknown as NotificationsService;
    const service = new RevalidationService(
      tasks,
      {} as Repository<RevalidationEvidence>,
      {} as Repository<RevalidationDecision>,
      { query } as unknown as DataSource,
      {} as MinioStorageService,
      wallet,
      notifications,
    );

    await service.finalizeTask('task-id', 'staff-id');

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('evidence_id = ANY($1)'),
      [['evidence-id']],
    );
  });

  describe('createOrEscalateDisputeTask', () => {
    it('creates a new high-priority OPEN revalidation task when none exists', async () => {
      const tasks = {
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn((val) => ({ ...val, id: 'new-dispute-task-id' })),
        save: jest.fn(async (val) => val),
      } as unknown as Repository<RevalidationTask>;

      const query = jest.fn().mockResolvedValue([]);
      const service = new RevalidationService(
        tasks,
        {} as Repository<RevalidationEvidence>,
        {} as Repository<RevalidationDecision>,
        { query } as unknown as DataSource,
        {} as MinioStorageService,
        {} as WalletService,
        {} as NotificationsService,
      );

      const task = await service.createOrEscalateDisputeTask(
        'sign-123',
        'user-456',
        'evidence/dispute.jpg',
        { latitude: 10.77, longitude: 106.69 },
        'Sign missing',
      );

      expect(task.id).toBe('new-dispute-task-id');
      expect(task.verifiedSignId).toBe('sign-123');
      expect(task.priority).toBe('HIGH');
      expect(task.rewardCredits).toBe(15);
      expect(task.status).toBe('OPEN');
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO revalidation_evidences'),
        expect.arrayContaining(['new-dispute-task-id', 'user-456', 'evidence/dispute.jpg', 106.69, 10.77]),
      );
    });

    it('escalates an existing open task to HIGH priority and 15 credits', async () => {
      const existingTask = {
        id: 'existing-task-id',
        verifiedSignId: 'sign-123',
        priority: 'LOW',
        rewardCredits: 10,
        status: TaskStatus.OPEN,
      } as RevalidationTask;

      const tasks = {
        findOne: jest.fn().mockResolvedValue(existingTask),
        save: jest.fn(async (val) => val),
      } as unknown as Repository<RevalidationTask>;

      const service = new RevalidationService(
        tasks,
        {} as Repository<RevalidationEvidence>,
        {} as Repository<RevalidationDecision>,
        {} as DataSource,
        {} as MinioStorageService,
        {} as WalletService,
        {} as NotificationsService,
      );

      const task = await service.createOrEscalateDisputeTask('sign-123', 'user-456');

      expect(task.id).toBe('existing-task-id');
      expect(task.priority).toBe('HIGH');
      expect(task.rewardCredits).toBe(15);
      expect(tasks.save).toHaveBeenCalledWith(existingTask);
    });
  });
});
