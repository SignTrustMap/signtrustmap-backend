import { DataSource, Repository } from 'typeorm';
import { MinioStorageService } from '../../../integrations/minio/minio-storage.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { TransactionType } from '../../wallet/infrastructure/persistence/credit-transaction.entity';
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

  describe('submitEvidence (Scenario #3 guardrails)', () => {
    function proximityHarness(distanceMeters: number, recentCount = 0) {
      const task = { id: 'task-id', verifiedSignId: 'sign-id', status: TaskStatus.OPEN, freshnessRuleId: null } as RevalidationTask;
      const tasks = { findOne: jest.fn().mockResolvedValue(task), save: jest.fn(async (v: any) => v) } as unknown as Repository<RevalidationTask>;
      const query = jest.fn(async (sql: string) => {
        if (sql.includes('ST_DistanceSphere')) return [{ distance_meters: distanceMeters }];
        if (sql.includes('COUNT(*)' )) return [{ cnt: recentCount }];
        return [];
      });
      const service = new RevalidationService(
        tasks,
        { findOne: jest.fn().mockResolvedValue(null) } as unknown as Repository<RevalidationEvidence>,
        {} as Repository<RevalidationDecision>,
        { query } as unknown as DataSource,
        {} as MinioStorageService,
        {} as WalletService,
        {} as NotificationsService,
      );
      return { service, tasks, query };
    }

    it('accepts evidence within the proximity guardrail and flips the task to EVALUATING', async () => {
      const { service, tasks, query } = proximityHarness(35.5);
      const result = await service.submitEvidence('task-id', 'surveyor-id', { latitude: 21.02851, longitude: 105.83419, mediaUrl: 'revalidation/task-id/fresh.jpg' });
      expect(result.distanceMeters).toBe(35.5);
      expect(result).toMatchObject({ maxProximityMeters: 50, dailySubmissionLimit: 3, remainingDailySubmissions: 2 });
      expect(query).toHaveBeenCalledWith(expect.stringContaining('ST_SetSRID(ST_MakePoint($1, $2), 4326)'), [105.83419, 21.02851, 'task-id']);
      expect(tasks.save).toHaveBeenCalledWith(expect.objectContaining({ status: TaskStatus.EVALUATING }));
    });

    it('rejects evidence farther than the max proximity', async () => {
      const { service } = proximityHarness(142);
      await expect(service.submitEvidence('task-id', 'surveyor-id', { latitude: 21.02851, longitude: 105.83419 }))
        .rejects.toThrow('Submitted evidence is too far from target sign (distance: 142m, max allowed: 50m)');
    });

    it('rejects a fourth submission within 24h with 429', async () => {
      const { service } = proximityHarness(5, 3);
      await expect(service.submitEvidence('task-id', 'surveyor-id', { latitude: 21.02851, longitude: 105.83419 }))
        .rejects.toMatchObject({ status: 429 });
    });
  });

  describe('evaluateRevalidationConsensus (Scenario #3 auto-finalize)', () => {
    function consensusHarness(decisionRows: any[]) {
      const task = { id: 'task-id', verifiedSignId: 'sign-id', status: TaskStatus.EVALUATING, rewardCredits: 10, freshnessRuleId: null } as RevalidationTask;
      const tasks = { findOne: jest.fn().mockResolvedValue(task), save: jest.fn(async (v: any) => v) } as unknown as Repository<RevalidationTask>;
      const query = jest.fn(async (sql: string) => {
        if (sql.includes('SELECT id, user_id FROM revalidation_evidences')) return [{ id: 'evidence-id', user_id: 'surveyor-id' }];
        if (sql.includes('SELECT decision, reviewer_id, evidence_id')) return decisionRows;
        if (sql.includes('min_votes_required')) return [];
        if (/SELECT sign_type_id FROM verified_traffic_signs/.test(sql)) return [{ sign_type_id: 7 }];
        return [];
      });
      const wallet = {
        resolveRewardAmount: jest.fn().mockResolvedValue(10),
        creditUser: jest.fn().mockResolvedValue(undefined),
      } as unknown as WalletService;
      const notifications = { createBulk: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService;
      const service = new RevalidationService(
        tasks,
        {} as Repository<RevalidationEvidence>,
        {} as Repository<RevalidationDecision>,
        { query } as unknown as DataSource,
        {} as MinioStorageService,
        wallet,
        notifications,
      );
      return { service, tasks, query, wallet };
    }

    it('UNCHANGED majority refreshes the sign, rewards the submitter and completes the task', async () => {
      const { service, tasks, query, wallet } = consensusHarness([
        { decision: 'UNCHANGED', reviewer_id: 'r1', evidence_id: 'evidence-id', suggested_sign_type_id: null },
        { decision: 'UNCHANGED', reviewer_id: 'r2', evidence_id: 'evidence-id', suggested_sign_type_id: null },
        { decision: 'UNCHANGED', reviewer_id: 'r3', evidence_id: 'evidence-id', suggested_sign_type_id: null },
      ]);
      const result = await service.evaluateRevalidationConsensus('task-id');
      expect(result).toMatchObject({ reason: 'CONSENSUS_REACHED', winningDecision: 'UNCHANGED', signAction: 'REFRESHED', creditedSubmitters: 1 });
      expect(query).toHaveBeenCalledWith(expect.stringContaining("UPDATE verified_traffic_signs SET status='ACTIVE'"), ['sign-id']);
      expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO sign_lifecycle_events'), ['sign-id']);
      expect(tasks.save).toHaveBeenCalledWith(expect.objectContaining({ status: TaskStatus.COMPLETED }));
      expect(wallet.creditUser).toHaveBeenCalledWith('surveyor-id', 10, TransactionType.REVALIDATION_REWARD, 'revalidation_task', 'task-id', expect.any(String));
    });

    it('CHANGED majority updates the suggested sign type and records history', async () => {
      const { service, query } = consensusHarness([
        { decision: 'CHANGED', reviewer_id: 'r1', evidence_id: 'evidence-id', suggested_sign_type_id: 42 },
        { decision: 'CHANGED', reviewer_id: 'r2', evidence_id: 'evidence-id', suggested_sign_type_id: 42 },
        { decision: 'CHANGED', reviewer_id: 'r3', evidence_id: 'evidence-id', suggested_sign_type_id: 42 },
      ]);
      const result = await service.evaluateRevalidationConsensus('task-id');
      expect(result).toMatchObject({ winningDecision: 'CHANGED', signAction: 'UPDATED_TYPE' });
      expect(query).toHaveBeenCalledWith(expect.stringContaining('SET sign_type_id=$1'), [42, 'sign-id']);
      expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO verified_sign_history'), ['sign-id', 7]);
    });

    it('MISSING majority retires the sign', async () => {
      const { service, query } = consensusHarness([
        { decision: 'MISSING', reviewer_id: 'r1', evidence_id: 'evidence-id', suggested_sign_type_id: null },
        { decision: 'MISSING', reviewer_id: 'r2', evidence_id: 'evidence-id', suggested_sign_type_id: null },
        { decision: 'MISSING', reviewer_id: 'r3', evidence_id: 'evidence-id', suggested_sign_type_id: null },
      ]);
      const result = await service.evaluateRevalidationConsensus('task-id');
      expect(result).toMatchObject({ winningDecision: 'MISSING', signAction: 'RETIRED' });
      expect(query).toHaveBeenCalledWith(expect.stringContaining("UPDATE verified_traffic_signs SET status='RETIRED'"), ['sign-id']);
    });

    it('escalates a tie to moderation instead of arbitrarily picking a winner', async () => {
      const { service, tasks, query } = consensusHarness([
        { decision: 'UNCHANGED', reviewer_id: 'r1', evidence_id: 'evidence-id', suggested_sign_type_id: null },
        { decision: 'MISSING', reviewer_id: 'r2', evidence_id: 'evidence-id', suggested_sign_type_id: null },
        { decision: 'CHANGED', reviewer_id: 'r3', evidence_id: 'evidence-id', suggested_sign_type_id: 42 },
      ]);
      const result = await service.evaluateRevalidationConsensus('task-id');
      expect(result).toMatchObject({ reason: 'CONFLICT', escalatedToModeration: true });
      expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO moderation_cases'), ['task-id', expect.stringContaining('tie')]);
      expect(tasks.save).toHaveBeenCalledWith(expect.objectContaining({ status: TaskStatus.ESCALATED_MODERATION }));
    });
  });
});
