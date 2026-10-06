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
      if (sql.includes('FROM revalidation_evidences')) {
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
        expect.arrayContaining(['new-dispute-task-id', 'user-456', 'https://s3.signmap.site/stm-sign-crops/evidence/dispute.jpg', 106.69, 10.77]),
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

    it('accepts evidence within proximity guardrail with evidenceType REMOVED', async () => {
      const { service, query } = proximityHarness(20);
      const result = await service.submitEvidence('task-id', 'surveyor-id', {
        latitude: 21.02851,
        longitude: 105.83419,
        mediaUrl: 'revalidation/task-id/removed.jpg',
        evidenceType: 'REMOVED',
      });
      expect(result.evidenceType).toBe('REMOVED');
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('evidence_type'),
        expect.arrayContaining(['REMOVED']),
      );
    });

    it('accepts evidence within proximity guardrail with evidenceType CHANGED', async () => {
      const { service, query } = proximityHarness(20);
      const result = await service.submitEvidence('task-id', 'surveyor-id', {
        latitude: 21.02851,
        longitude: 105.83419,
        mediaUrl: 'revalidation/task-id/changed.jpg',
        evidenceType: 'CHANGED',
      });
      expect(result.evidenceType).toBe('CHANGED');
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('evidence_type'),
        expect.arrayContaining(['CHANGED']),
      );
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

    it('advances REVALIDATE daily task progress upon submitting evidence', async () => {
      const { tasks, query } = proximityHarness(20);
      const mockDailyTasks = { recordProgress: jest.fn().mockResolvedValue([]) } as any;
      const service = new RevalidationService(
        tasks,
        { findOne: jest.fn().mockResolvedValue(null) } as unknown as Repository<RevalidationEvidence>,
        {} as Repository<RevalidationDecision>,
        { query } as unknown as DataSource,
        {} as MinioStorageService,
        {} as WalletService,
        {} as NotificationsService,
        undefined,
        mockDailyTasks,
      );
      await service.submitEvidence('task-id', 'surveyor-id', { latitude: 21.02851, longitude: 105.83419, mediaUrl: 'revalidation/task-id/fresh.jpg' });
      expect(mockDailyTasks.recordProgress).toHaveBeenCalledWith('surveyor-id', 'REVALIDATE', 1);
    });

    it('advances REVIEW daily task progress upon voting on evidence', async () => {
      const mockDailyTasks = { recordProgress: jest.fn().mockResolvedValue([]) } as any;
      const evidences = { findOne: jest.fn().mockResolvedValue({ id: 'ev-1', taskId: 'task-1', userId: 'author-1' }) } as any;
      const decisions = { findOne: jest.fn().mockResolvedValue(null), create: jest.fn((d) => d), save: jest.fn(async (d) => d) } as any;
      const service = new RevalidationService(
        { findOne: jest.fn().mockResolvedValue({ id: 'task-1', status: TaskStatus.EVALUATING }) } as any,
        evidences,
        decisions,
        { query: jest.fn().mockResolvedValue([]) } as any,
        {} as MinioStorageService,
        {} as WalletService,
        {} as NotificationsService,
        undefined,
        mockDailyTasks,
      );
      await service.voteOnEvidence('ev-1', 'reviewer-1', { decision: 'STILL_ACTIVE' });
      expect(mockDailyTasks.recordProgress).toHaveBeenCalledWith('reviewer-1', 'REVIEW', 1);
    });

    it('dispatches early classification when submitting evidence of type CHANGED', async () => {
      const { tasks, query } = proximityHarness(20);
      const mockAiService = {
        classifyEarly: jest.fn().mockResolvedValue({
          status: 'success',
          className: 'Stop',
          confidence: 0.99,
        }),
      };
      const service = new RevalidationService(
        tasks,
        { findOne: jest.fn().mockResolvedValue(null) } as unknown as Repository<RevalidationEvidence>,
        {} as Repository<RevalidationDecision>,
        { query } as unknown as DataSource,
        {} as MinioStorageService,
        {} as WalletService,
        {} as NotificationsService,
        undefined,
        undefined,
        mockAiService as any,
      );
      const result = await service.submitEvidence('task-id', 'surveyor-id', {
        latitude: 21.02851,
        longitude: 105.83419,
        mediaUrl: 'revalidation/task-id/changed-sign.jpg',
        evidenceType: 'CHANGED',
      });
      expect(result.evidenceType).toBe('CHANGED');
      expect(mockAiService.classifyEarly).toHaveBeenCalledWith({
        mediaUrl: 'https://s3.signmap.site/stm-sign-crops/revalidation/task-id/changed-sign.jpg',
        signId: 'sign-id',
        taskId: 'task-id',
      });
    });
  });

  describe('evaluateRevalidationConsensus (Scenario #3 auto-finalize)', () => {
    function consensusHarness(decisionRows: any[], evidenceRows?: any[], mockAiService?: any) {
      const task = { id: 'task-id', verifiedSignId: 'sign-id', status: TaskStatus.EVALUATING, rewardCredits: 10, freshnessRuleId: null } as RevalidationTask;
      const tasks = { findOne: jest.fn().mockResolvedValue(task), save: jest.fn(async (v: any) => v) } as unknown as Repository<RevalidationTask>;
      const query = jest.fn(async (sql: string) => {
        if (sql.includes('FROM revalidation_evidences')) return evidenceRows ?? [{ id: 'evidence-id', user_id: 'surveyor-id' }];
        if (sql.includes('SELECT decision, reviewer_id, evidence_id')) return decisionRows;
        if (sql.includes('min_votes_required')) return [];
        if (/SELECT sign_type_id FROM verified_traffic_signs/.test(sql)) return [{ sign_type_id: 7 }];
        if (sql.includes('SELECT id FROM traffic_sign_types')) return [{ id: 99 }];
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
        undefined,
        undefined,
        mockAiService,
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

    it('MISSING / REMOVED majority transitions sign to DECOMMISSIONED and awards SIGN_DECOMMISSION_REWARD', async () => {
      const { service, query, wallet } = consensusHarness([
        { decision: 'MISSING', reviewer_id: 'r1', evidence_id: 'evidence-id', suggested_sign_type_id: null },
        { decision: 'REMOVED', reviewer_id: 'r2', evidence_id: 'evidence-id', suggested_sign_type_id: null },
        { decision: 'MISSING', reviewer_id: 'r3', evidence_id: 'evidence-id', suggested_sign_type_id: null },
      ]);
      const result = await service.evaluateRevalidationConsensus('task-id');
      expect(result).toMatchObject({ winningDecision: 'MISSING', signAction: 'DECOMMISSIONED' });
      expect(query).toHaveBeenCalledWith(expect.stringContaining("UPDATE verified_traffic_signs SET status='DECOMMISSIONED'"), ['sign-id']);
      expect(wallet.creditUser).toHaveBeenCalledWith('surveyor-id', 10, TransactionType.SIGN_DECOMMISSION_REWARD, 'revalidation_task', 'task-id', expect.any(String));
    });

    it('STILL_ACTIVE majority refreshes the sign and awards REVALIDATION_REWARD', async () => {
      const { service, query, wallet } = consensusHarness([
        { decision: 'STILL_ACTIVE', reviewer_id: 'r1', evidence_id: 'evidence-id', suggested_sign_type_id: null },
        { decision: 'STILL_ACTIVE', reviewer_id: 'r2', evidence_id: 'evidence-id', suggested_sign_type_id: null },
        { decision: 'UNCHANGED', reviewer_id: 'r3', evidence_id: 'evidence-id', suggested_sign_type_id: null },
      ]);
      const result = await service.evaluateRevalidationConsensus('task-id');
      expect(result).toMatchObject({ winningDecision: 'STILL_ACTIVE', signAction: 'REFRESHED' });
      expect(query).toHaveBeenCalledWith(expect.stringContaining("UPDATE verified_traffic_signs SET status='ACTIVE'"), ['sign-id']);
      expect(wallet.creditUser).toHaveBeenCalledWith('surveyor-id', 10, TransactionType.REVALIDATION_REWARD, 'revalidation_task', 'task-id', expect.any(String));
    });

    it('updates sign_crop_url with latest evidence media_url when STILL_ACTIVE is confirmed', async () => {
      const { service, query } = consensusHarness(
        [
          { decision: 'STILL_ACTIVE', reviewer_id: 'r1', evidence_id: 'evidence-id', suggestedSignTypeId: null },
          { decision: 'STILL_ACTIVE', reviewer_id: 'r2', evidence_id: 'evidence-id', suggestedSignTypeId: null },
        ],
        [{ id: 'evidence-id', user_id: 'surveyor-id', media_url: 'https://s3.example.com/updated-sign.jpg' }],
      );
      const result = await service.evaluateRevalidationConsensus('task-id');
      expect(result).toMatchObject({ winningDecision: 'STILL_ACTIVE', signAction: 'REFRESHED' });
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE verified_traffic_signs SET status='ACTIVE', freshness_score=1, sign_crop_url=$2"),
        ['sign-id', 'https://s3.example.com/updated-sign.jpg'],
      );
    });

    it('updates sign_crop_url and sign_type_id when CHANGED is confirmed with evidence media_url', async () => {
      const { service, query } = consensusHarness(
        [
          { decision: 'CHANGED', reviewer_id: 'r1', evidence_id: 'evidence-id', suggested_sign_type_id: 42 },
          { decision: 'CHANGED', reviewer_id: 'r2', evidence_id: 'evidence-id', suggested_sign_type_id: 42 },
        ],
        [{ id: 'evidence-id', user_id: 'surveyor-id', media_url: 'https://s3.example.com/changed-sign.jpg' }],
      );
      const result = await service.evaluateRevalidationConsensus('task-id');
      expect(result).toMatchObject({ winningDecision: 'CHANGED', signAction: 'UPDATED_TYPE' });
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE verified_traffic_signs SET sign_type_id=$1, status=\'ACTIVE\', freshness_score=1, sign_crop_url=$3'),
        [42, 'sign-id', 'https://s3.example.com/changed-sign.jpg'],
      );
    });

    it('sends new changed image to AI server for early classification when CHANGED is confirmed', async () => {
      const mockAiService = {
        classifyEarly: jest.fn().mockResolvedValue({
          status: 'success',
          classId: 42,
          className: 'No_entry',
          standardCode: 'P.102',
          confidence: 0.98,
        }),
      };
      const { service, query } = consensusHarness(
        [
          { decision: 'CHANGED', reviewer_id: 'r1', evidence_id: 'evidence-id', suggested_sign_type_id: 42 },
          { decision: 'CHANGED', reviewer_id: 'r2', evidence_id: 'evidence-id', suggested_sign_type_id: 42 },
        ],
        [{ id: 'evidence-id', user_id: 'surveyor-id', media_url: 'https://s3.example.com/changed-sign.jpg' }],
        mockAiService,
      );
      const result = await service.evaluateRevalidationConsensus('task-id');
      expect(result).toMatchObject({ winningDecision: 'CHANGED', signAction: 'UPDATED_TYPE' });
      expect(mockAiService.classifyEarly).toHaveBeenCalledWith({
        mediaUrl: 'https://s3.example.com/changed-sign.jpg',
        signId: 'sign-id',
        taskId: 'task-id',
      });
      expect(result.earlyClassification).toEqual(expect.objectContaining({
        standardCode: 'P.102',
        confidence: 0.98,
      }));
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO sign_lifecycle_events'),
        expect.arrayContaining(['sign-id', expect.stringContaining('AI early classification: P.102')]),
      );
    });

    it('resolves suggestedSignTypeId using AI early classification when reviewers provide none', async () => {
      const mockAiService = {
        classifyEarly: jest.fn().mockResolvedValue({
          status: 'success',
          classId: 99,
          className: 'Speed_limit_50',
          standardCode: 'P.127',
          confidence: 0.95,
        }),
      };
      const { service, query, tasks } = consensusHarness(
        [
          { decision: 'CHANGED', reviewer_id: 'r1', evidence_id: 'evidence-id', suggested_sign_type_id: null },
          { decision: 'CHANGED', reviewer_id: 'r2', evidence_id: 'evidence-id', suggested_sign_type_id: null },
        ],
        [{ id: 'evidence-id', user_id: 'surveyor-id', media_url: 'https://s3.example.com/new-speed-limit.jpg' }],
        mockAiService,
      );
      const result = await service.evaluateRevalidationConsensus('task-id');
      expect(result).toMatchObject({ winningDecision: 'CHANGED', signAction: 'UPDATED_TYPE' });
      expect(mockAiService.classifyEarly).toHaveBeenCalled();
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE verified_traffic_signs SET sign_type_id=$1'),
        [99, 'sign-id', 'https://s3.example.com/new-speed-limit.jpg'],
      );
      expect(tasks.save).toHaveBeenCalledWith(expect.objectContaining({ status: TaskStatus.COMPLETED }));
    });

    it('falls back to moderation if reviewers provide no type and AI early classification fails', async () => {
      const mockAiService = {
        classifyEarly: jest.fn().mockResolvedValue(null),
      };
      const { service, tasks } = consensusHarness(
        [
          { decision: 'CHANGED', reviewer_id: 'r1', evidence_id: 'evidence-id', suggested_sign_type_id: null },
          { decision: 'CHANGED', reviewer_id: 'r2', evidence_id: 'evidence-id', suggested_sign_type_id: null },
        ],
        [{ id: 'evidence-id', user_id: 'surveyor-id', media_url: 'https://s3.example.com/unclear.jpg' }],
        mockAiService,
      );
      const result = await service.evaluateRevalidationConsensus('task-id');
      expect(result).toMatchObject({ reason: 'CHANGED_WITHOUT_TYPE', escalatedToModeration: true });
      expect(tasks.save).toHaveBeenCalledWith(expect.objectContaining({ status: TaskStatus.ESCALATED_MODERATION }));
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

  describe('Phase 5 Route-Aware Freshness & Spatial Tasks', () => {
    it('queries revalidation tasks with PostGIS spatial radius filter', async () => {
      const query = jest.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('COUNT(*)')) {
          return [{ cnt: 1 }];
        }
        if (sql.includes('SELECT rt.id')) {
          return [
            {
              id: 'task-1',
              signId: 'sign-1',
              bounty: 75,
              rewardCredits: 75,
              urgency: 0.55,
              priority: 'MEDIUM',
              status: 'OPEN',
              expiresAt: new Date(),
              createdAt: new Date(),
              lat: 10.8231,
              lon: 106.6297,
              distance_meters: 120,
            },
          ];
        }
        return [];
      });

      const service = new RevalidationService(
        {} as any,
        {} as any,
        {} as any,
        { query } as unknown as DataSource,
        {} as any,
        {} as any,
        {} as any,
      );

      const result = await service.listTasks(1, 10, 'OPEN', 'urgency', {
        lat: 10.823,
        lon: 106.629,
        radiusMeters: 1000,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        id: 'task-1',
        signId: 'sign-1',
        bounty: 75,
        urgency: 0.55,
        location: { lat: 10.8231, lon: 106.6297 },
      });
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('ST_DWithin(vts.location::geography'),
        expect.arrayContaining([106.629, 10.823, 1000]),
      );
    });

    it('queries non-spatial revalidation tasks with sign metadata and status filter', async () => {
      const query = jest.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('COUNT(*)')) {
          return [{ cnt: 1 }];
        }
        if (sql.includes('FROM revalidation_tasks rt')) {
          return [
            {
              id: 'task-non-spatial',
              verified_sign_id: 'sign-1',
              reward_credits: 50,
              urgency: 0.8,
              status: 'OPEN',
              sign_code: 'P.102',
              name_en: 'No Entry',
              name_vi: 'Cấm đi ngược chiều',
              longitude: 106.7,
              latitude: 10.77,
            },
          ];
        }
        return [];
      });

      const service = new RevalidationService(
        {} as any,
        {} as any,
        {} as any,
        { query } as unknown as DataSource,
        {} as any,
        {} as any,
        {} as any,
      );

      const result = await service.listTasks(1, 20, 'OPEN', 'reward');
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        id: 'task-non-spatial',
        sign_code: 'P.102',
        name_en: 'No Entry',
      });
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('JOIN verified_traffic_signs vts'),
        expect.arrayContaining(['OPEN', 20, 0]),
      );
    });

    it('queries tasks in bbox without ST_Within when coordinates are omitted', async () => {
      const query = jest.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('COUNT(*)')) return [{ cnt: 0 }];
        return [];
      });

      const service = new RevalidationService(
        {} as any,
        {} as any,
        {} as any,
        { query } as unknown as DataSource,
        {} as any,
        {} as any,
        {} as any,
      );

      const result = await service.listTasksInBbox({ status: 'OPEN' });
      expect(result.items).toEqual([]);
      expect(query).toHaveBeenCalledWith(
        expect.not.stringContaining('ST_Within'),
        expect.arrayContaining(['OPEN', 20, 0]),
      );
    });

    it('attaches location and bounty to getTask response', async () => {
      const task = {
        id: 'task-1',
        verifiedSignId: 'sign-1',
        rewardCredits: 90,
        urgency: 0.7,
        status: TaskStatus.OPEN,
      } as RevalidationTask;
      const tasks = {
        findOne: jest.fn().mockResolvedValue(task),
      } as unknown as Repository<RevalidationTask>;
      const query = jest.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('FROM revalidation_evidences')) return [];
        if (sql.includes('FROM verified_traffic_signs')) {
          return [{ lat: 10.772, lon: 106.698 }];
        }
        return [];
      });

      const service = new RevalidationService(
        tasks,
        {} as any,
        {} as any,
        { query } as unknown as DataSource,
        {} as any,
        {} as any,
        {} as any,
      );

      const result = await service.getTask('task-1');
      expect(result.bounty).toBe(90);
      expect(result.location).toEqual({ lat: 10.772, lon: 106.698 });
    });
  });

  describe('triggerEarlyClassification', () => {
    it('fetches latest evidence and triggers early classification', async () => {
      const task = { id: 'task-1', verifiedSignId: 'sign-1', status: TaskStatus.OPEN } as RevalidationTask;
      const tasks = { findOne: jest.fn().mockResolvedValue(task) } as unknown as Repository<RevalidationTask>;
      const query = jest.fn(async (sql: string) => {
        if (sql.includes('FROM revalidation_evidences')) {
          return [{ media_url: 'https://s3.example.com/crop.jpg', evidence_type: 'CHANGED' }];
        }
        if (sql.includes('FROM traffic_sign_types')) {
          return [{ id: 101 }];
        }
        return [];
      });
      const mockAiService = {
        classifyEarly: jest.fn().mockResolvedValue({
          status: 'success',
          standardCode: 'P.102',
          className: 'No_entry',
          confidence: 0.98,
        }),
      };
      const service = new RevalidationService(
        tasks,
        {} as any,
        {} as any,
        { query } as unknown as DataSource,
        {} as any,
        {} as any,
        {} as any,
        undefined,
        undefined,
        mockAiService as any,
      );

      const res = await service.triggerEarlyClassification('task-1');
      expect(res.taskId).toBe('task-1');
      expect(res.signId).toBe('sign-1');
      expect(res.resolvedSignTypeId).toBe(101);
      expect(mockAiService.classifyEarly).toHaveBeenCalledWith({
        mediaUrl: 'https://s3.example.com/crop.jpg',
        signId: 'sign-1',
        taskId: 'task-1',
      });
    });
  });
});
