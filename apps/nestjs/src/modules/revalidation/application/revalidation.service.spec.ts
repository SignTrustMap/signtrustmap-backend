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
});
