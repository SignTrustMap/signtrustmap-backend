import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as classTransformer from 'class-transformer';
import * as classValidator from 'class-validator';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { RevalidationController } from '../presentation/revalidation.controller';
import { RevalidationService } from '../application/revalidation.service';
import { RevalidationTask, TaskPriority, TaskStatus } from '../infrastructure/persistence/revalidation-task.entity';
import { RevalidationEvidence } from '../infrastructure/persistence/revalidation-evidence.entity';
import { RevalidationDecision } from '../infrastructure/persistence/revalidation-decision.entity';
import { FreshnessRule, RulePriority } from '../infrastructure/persistence/freshness-rule.entity';
import { MinioStorageService } from '../../../integrations/minio/minio-storage.service';
import { WalletService } from '../../wallet/application/wallet.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { DailyTasksService } from '../../daily-tasks/daily-tasks.service';
import { AiInferenceService } from '../../../integrations/ai-inference/ai-inference.service';
import { VerifiedSignOrmEntity } from '../../sign-map/infrastructure/persistence/verified-sign.orm-entity';
import { SignLifecycleEvent } from '../../sign-map/infrastructure/persistence/sign-lifecycle-event.entity';
import { VerifiedSignHistory } from '../../sign-map/infrastructure/persistence/verified-sign-history.entity';
import { ModerationCase } from '../../moderation/infrastructure/persistence/moderation-case.entity';
import { SurveyorProfile } from '../../survey/infrastructure/persistence/surveyor-profile.entity';
import { TrafficSignType } from '../../catalog/traffic-sign-type.entity';
import { ConsensusConfig } from '../../consensus/infrastructure/persistence/consensus-config.entity';
import { SystemParametersService } from '../../system-parameters/system-parameters.service';

// Minimal valid 1x1 PNG binary (passes magic-byte & PNG decodeMedia validation)
const VALID_PNG_BUFFER = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de' +
    '0000000c4944415408d763f8cfc000000301010018dd8db00000000049454e44ae426082',
  'hex',
);

const SURVEYOR_1 = '11111111-1111-4111-8111-111111111111';
const SURVEYOR_2 = '22222222-2222-4222-8222-222222222222';
const SURVEYOR_3 = '33333333-3333-4333-8333-333333333333';
const SURVEYOR_4 = '44444444-4444-4444-8444-444444444444';
const REVIEWER_1 = '55555555-5555-4555-8555-555555555555';
const REVIEWER_2 = '66666666-6666-4666-8666-666666666666';
const STAFF_USER = '77777777-7777-4777-8777-777777777777';

const SIGN_NEAR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const SIGN_FAR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const SIGN_CLOSED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';

const TASK_OPEN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const TASK_FAR = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const TASK_COMPLETED = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';
const TASK_EXPIRED = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4';
const TASK_UNKNOWN = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371008.8;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface SignRecord {
  id: string;
  sign_type_id: number;
  status: string;
  freshness_score: number;
  latitude: number;
  longitude: number;
  traffic_direction: number | null;
  sign_crop_url: string;
  last_verified_at: Date;
}

interface TaskRecord {
  id: string;
  verifiedSignId: string;
  freshnessRuleId: number | null;
  priority: TaskPriority;
  rewardCredits: number;
  urgency: number;
  status: TaskStatus;
  createdAt: Date;
  expiredAt: Date | null;
}

interface EvidenceRecord {
  id: string;
  taskId: string;
  userId: string;
  mediaUrl: string;
  latitude: number;
  longitude: number;
  evidenceType: string;
  isLiveCapture: boolean;
  accuracyMeters: number | null;
  headingDegrees: number | null;
  submittedAt: Date;
}

interface DecisionRecord {
  id: string;
  evidenceId: string;
  reviewerId: string;
  decision: string;
  suggestedSignTypeId: number | null;
  note: string | null;
  decidedAt: Date;
}

interface CreditTxRecord {
  idempotencyKey: string;
  userId: string;
  amount: number;
  txType: string;
  entityId: string;
  description: string;
}

interface NotificationRecord {
  userId: string;
  type: string;
  title: string;
  message: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
}

/**
 * Stateful in-memory PostgreSQL/PostGIS harness simulating transactional locks,
 * ST_DistanceSphere / ST_DWithin / ST_Within, and full relational state for Flow 3.
 */
class RevalidationTestDatabase {
  signs = new Map<string, SignRecord>();
  signTypes = new Map<number, { id: number; signCode: string; nameVi: string; nameEn: string }>();
  freshnessRules = new Map<number, FreshnessRule>();
  tasks = new Map<string, TaskRecord>();
  evidences = new Map<string, EvidenceRecord>();
  decisions: DecisionRecord[] = [];
  signHistory: Array<{
    verified_sign_id: string;
    previous_sign_type_id: number | null;
    previous_crop_url: string | null;
    change_reason: string;
  }> = [];
  lifecycleEvents: Array<{ verified_sign_id: string; event_type: string; note: string }> = [];
  moderationCases: Array<{
    case_type: string;
    target_entity_type: string;
    target_entity_id: string;
    status: string;
    resolution_note: string;
  }> = [];
  creditTransactions: CreditTxRecord[] = [];
  notifications: NotificationRecord[] = [];
  uploadedObjects: Array<{ bucket: string; key: string; contentType: string }> = [];
  minVotesRequired = 1;
  activeLocks = new Set<string>();

  resetAndSeed(): void {
    this.signs.clear();
    this.signTypes.clear();
    this.freshnessRules.clear();
    this.tasks.clear();
    this.evidences.clear();
    this.decisions = [];
    this.signHistory = [];
    this.lifecycleEvents = [];
    this.moderationCases = [];
    this.creditTransactions = [];
    this.notifications = [];
    this.uploadedObjects = [];
    this.activeLocks.clear();
    this.minVotesRequired = 1;

    this.signTypes.set(10, { id: 10, signCode: 'P.102', nameVi: 'Cấm đi ngược chiều', nameEn: 'No Entry' });
    this.signTypes.set(42, { id: 42, signCode: 'P.127', nameVi: 'Tốc độ tối đa 50', nameEn: 'Speed Limit 50' });

    this.freshnessRules.set(1, {
      id: 1,
      signCategoryId: 1,
      freshnessPeriodDays: 30,
      defaultPriority: RulePriority.MEDIUM,
      maxProximityMeters: 50,
      dailySubmissionLimit: 3,
      isActive: true,
      createdAt: new Date(),
    });

    this.signs.set(SIGN_NEAR, {
      id: SIGN_NEAR,
      sign_type_id: 10,
      status: 'STALE',
      freshness_score: 0.25,
      latitude: 10.7769,
      longitude: 106.7009,
      traffic_direction: 90,
      sign_crop_url: 'https://s3.signmap.site/stm-sign-crops/original-near.jpg',
      last_verified_at: new Date('2026-08-01T00:00:00.000Z'),
    });

    this.signs.set(SIGN_FAR, {
      id: SIGN_FAR,
      sign_type_id: 10,
      status: 'STALE',
      freshness_score: 0.2,
      latitude: 21.0285,
      longitude: 105.8542,
      traffic_direction: 180,
      sign_crop_url: 'https://s3.signmap.site/stm-sign-crops/original-far.jpg',
      last_verified_at: new Date('2026-08-01T00:00:00.000Z'),
    });

    this.signs.set(SIGN_CLOSED, {
      id: SIGN_CLOSED,
      sign_type_id: 10,
      status: 'ACTIVE',
      freshness_score: 1.0,
      latitude: 10.777,
      longitude: 106.701,
      traffic_direction: 0,
      sign_crop_url: 'https://s3.signmap.site/stm-sign-crops/original-closed.jpg',
      last_verified_at: new Date(),
    });

    this.tasks.set(TASK_OPEN, {
      id: TASK_OPEN,
      verifiedSignId: SIGN_NEAR,
      freshnessRuleId: 1,
      priority: TaskPriority.HIGH,
      rewardCredits: 25,
      urgency: 0.85,
      status: TaskStatus.OPEN,
      createdAt: new Date(),
      expiredAt: new Date(Date.now() + 7 * 86400 * 1000),
    });

    this.tasks.set(TASK_FAR, {
      id: TASK_FAR,
      verifiedSignId: SIGN_FAR,
      freshnessRuleId: 1,
      priority: TaskPriority.MEDIUM,
      rewardCredits: 15,
      urgency: 0.4,
      status: TaskStatus.OPEN,
      createdAt: new Date(),
      expiredAt: new Date(Date.now() + 10 * 86400 * 1000),
    });

    this.tasks.set(TASK_COMPLETED, {
      id: TASK_COMPLETED,
      verifiedSignId: SIGN_CLOSED,
      freshnessRuleId: 1,
      priority: TaskPriority.LOW,
      rewardCredits: 10,
      urgency: 0.1,
      status: TaskStatus.COMPLETED,
      createdAt: new Date(),
      expiredAt: null,
    });

    this.tasks.set(TASK_EXPIRED, {
      id: TASK_EXPIRED,
      verifiedSignId: SIGN_CLOSED,
      freshnessRuleId: 1,
      priority: TaskPriority.LOW,
      rewardCredits: 10,
      urgency: 0.1,
      status: TaskStatus.EXPIRED,
      createdAt: new Date(),
      expiredAt: new Date(Date.now() - 86400 * 1000),
    });
  }

  async executeQuery(sql: string, params: any[] = []): Promise<any[]> {
    const norm = sql.replace(/\s+/g, ' ').trim();

    // 1. Spatial radius task count & list
    if (norm.includes('ST_DWithin(vts.location::geography') && norm.includes('FROM revalidation_tasks rt')) {
      const [lon, lat, radius] = [Number(params[0]), Number(params[1]), Number(params[2])];
      const matching = [...this.tasks.values()]
        .filter((t) => t.status === TaskStatus.OPEN || t.status === TaskStatus.EVALUATING)
        .map((t) => {
          const s = this.signs.get(t.verifiedSignId)!;
          return { task: t, sign: s, distance: haversineMeters(lat, lon, s.latitude, s.longitude) };
        })
        .filter((item) => item.distance <= radius)
        .sort((a, b) => a.distance - b.distance);

      if (norm.startsWith('SELECT COUNT(*)')) return [{ cnt: matching.length }];
      return matching.map(({ task, sign, distance }) => ({
        id: task.id,
        signId: task.verifiedSignId,
        bounty: task.rewardCredits,
        rewardCredits: task.rewardCredits,
        urgency: task.urgency,
        priority: task.priority,
        status: task.status,
        expiresAt: task.expiredAt,
        createdAt: task.createdAt,
        lat: sign.latitude,
        lon: sign.longitude,
        distance_meters: distance,
      }));
    }

    // 2. BBox task count & list
    if (norm.includes('ST_Within(vts.location, ST_MakeEnvelope') && norm.includes('FROM revalidation_tasks rt')) {
      const [minLon, minLat, maxLon, maxLat] = [
        Number(params[0]),
        Number(params[1]),
        Number(params[2]),
        Number(params[3]),
      ];
      const matching = [...this.tasks.values()]
        .filter((t) => t.status === TaskStatus.OPEN || t.status === TaskStatus.EVALUATING)
        .filter((t) => {
          const s = this.signs.get(t.verifiedSignId)!;
          return (
            s.longitude >= minLon &&
            s.longitude <= maxLon &&
            s.latitude >= minLat &&
            s.latitude <= maxLat
          );
        });
      if (norm.startsWith('SELECT COUNT(*)')) return [{ cnt: matching.length }];
      return matching.map((t) => {
        const s = this.signs.get(t.verifiedSignId)!;
        const st = this.signTypes.get(s.sign_type_id);
        return {
          id: t.id,
          verified_sign_id: t.verifiedSignId,
          priority: t.priority,
          reward_credits: t.rewardCredits,
          urgency: t.urgency,
          status: t.status,
          sign_type_id: s.sign_type_id,
          sign_status: s.status,
          freshness_score: s.freshness_score,
          longitude: s.longitude,
          latitude: s.latitude,
          sign_crop_url: s.sign_crop_url,
          sign_code: st?.signCode ?? null,
          name_en: st?.nameEn ?? null,
          name_vi: st?.nameVi ?? null,
        };
      });
    }

    // 3. ST_DistanceSphere check for submitEvidence / checkInEligibility
    if (norm.includes('ST_DistanceSphere') && norm.includes('FROM revalidation_tasks rt')) {
      const [lon, lat, taskId] = [Number(params[0]), Number(params[1]), String(params[2])];
      const task = this.tasks.get(taskId);
      if (!task) return [];
      const sign = this.signs.get(task.verifiedSignId);
      if (!sign) return [];
      return [
        {
          distance_meters: haversineMeters(lat, lon, sign.latitude, sign.longitude),
          target_lat: sign.latitude,
          target_lon: sign.longitude,
          verified_sign_id: sign.id,
        },
      ];
    }

    // 4. Target sign type lookup & nearby ambiguous signs
    if (norm === 'SELECT id, sign_type_id FROM verified_traffic_signs WHERE id = $1') {
      const s = this.signs.get(String(params[0]));
      return s ? [{ id: s.id, sign_type_id: s.sign_type_id }] : [];
    }
    if (norm.includes('WHERE vts.id <> $3 AND vts.sign_type_id = $4')) {
      return [];
    }

    // 5. Daily submission count (24h)
    if (norm.includes('SELECT COUNT(*)::int AS cnt FROM revalidation_evidences WHERE task_id = $1')) {
      const taskId = String(params[0]);
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      const cnt = [...this.evidences.values()].filter(
        (e) => e.taskId === taskId && e.submittedAt.getTime() >= cutoff,
      ).length;
      return [{ cnt }];
    }

    // 6. Duplicate surveyor evidence check
    if (norm.includes('FROM revalidation_evidences ev WHERE ev.task_id = $1 AND ev.user_id = $2')) {
      const [taskId, userId] = [String(params[0]), String(params[1])];
      const existing = [...this.evidences.values()].find((e) => {
        if (e.taskId !== taskId || e.userId !== userId) return false;
        const hasUnclearOrInvalid = this.decisions.some(
          (d) => d.evidenceId === e.id && (d.decision === 'UNCLEAR' || d.decision === 'INVALID'),
        );
        return !hasUnclearOrInvalid;
      });
      return existing ? [{ id: existing.id }] : [];
    }

    // 7. FOR UPDATE lock on revalidation_tasks by id
    if (norm.startsWith('SELECT status FROM revalidation_tasks WHERE id = $1 FOR UPDATE')) {
      const task = this.tasks.get(String(params[0]));
      if (!task) return [];
      this.activeLocks.add(`task:${task.id}`);
      return [{ status: task.status }];
    }
    if (norm.startsWith('SELECT id, verified_sign_id, freshness_rule_id, reward_credits, status FROM revalidation_tasks WHERE id = $1 FOR UPDATE')) {
      const task = this.tasks.get(String(params[0]));
      if (!task) return [];
      this.activeLocks.add(`task:${task.id}`);
      return [
        {
          id: task.id,
          verified_sign_id: task.verifiedSignId,
          freshness_rule_id: task.freshnessRuleId,
          reward_credits: task.rewardCredits,
          status: task.status,
        },
      ];
    }
    if (norm.startsWith('SELECT verified_sign_id FROM revalidation_tasks WHERE id = $1')) {
      const task = this.tasks.get(String(params[0]));
      return task ? [{ verified_sign_id: task.verifiedSignId }] : [];
    }
    if (norm.startsWith('SELECT id FROM verified_traffic_signs WHERE id = $1 FOR UPDATE')) {
      const sign = this.signs.get(String(params[0]));
      if (!sign) return [];
      this.activeLocks.add(`sign:${sign.id}`);
      return [{ id: sign.id }];
    }
    if (norm.includes('FROM revalidation_tasks rt JOIN revalidation_evidences ev ON ev.task_id = rt.id WHERE ev.id = $1 FOR UPDATE OF rt')) {
      const ev = this.evidences.get(String(params[0]));
      if (!ev) return [];
      const task = this.tasks.get(ev.taskId);
      if (!task) return [];
      this.activeLocks.add(`task:${task.id}`);
      return [{ status: task.status }];
    }

    // 8. INSERT revalidation_evidences
    if (norm.startsWith('INSERT INTO revalidation_evidences')) {
      const [id, taskId, userId, mediaUrl, lon, lat, evidenceType, isLiveCapture, accuracyMeters, headingDegrees] = params;
      this.evidences.set(String(id), {
        id: String(id),
        taskId: String(taskId),
        userId: String(userId),
        mediaUrl: String(mediaUrl),
        longitude: Number(lon),
        latitude: Number(lat),
        evidenceType: String(evidenceType),
        isLiveCapture: Boolean(isLiveCapture),
        accuracyMeters: accuracyMeters != null ? Number(accuracyMeters) : null,
        headingDegrees: headingDegrees != null ? Number(headingDegrees) : null,
        submittedAt: new Date(),
      });
      return [];
    }

    // 9. UPDATE revalidation_tasks status
    if (norm.startsWith("UPDATE revalidation_tasks SET status = 'OPEN'")) {
      const task = this.tasks.get(String(params[0]));
      if (task) task.status = TaskStatus.OPEN;
      return [];
    }
    if (norm.startsWith("UPDATE revalidation_tasks SET status = 'EVALUATING'")) {
      const task = this.tasks.get(String(params[0]));
      if (task && task.status === TaskStatus.OPEN) task.status = TaskStatus.EVALUATING;
      return [];
    }
    if (norm.startsWith("UPDATE revalidation_tasks SET status = 'COMPLETED' WHERE id = $1")) {
      const task = this.tasks.get(String(params[0]));
      if (
        task &&
        (task.status === TaskStatus.OPEN ||
          task.status === TaskStatus.EVALUATING ||
          task.status === TaskStatus.ESCALATED_MODERATION)
      ) {
        task.status = TaskStatus.COMPLETED;
      }
      return [];
    }
    if (norm.startsWith("UPDATE revalidation_tasks SET status = 'COMPLETED' WHERE verified_sign_id = $1")) {
      const [signId, excludeTaskId] = [String(params[0]), String(params[1])];
      for (const t of this.tasks.values()) {
        if (
          t.verifiedSignId === signId &&
          t.id !== excludeTaskId &&
          (t.status === TaskStatus.OPEN ||
            t.status === TaskStatus.EVALUATING ||
            t.status === TaskStatus.ESCALATED_MODERATION)
        ) {
          t.status = TaskStatus.COMPLETED;
        }
      }
      return [];
    }
    if (norm.startsWith("UPDATE revalidation_tasks SET status = 'ESCALATED_MODERATION'")) {
      const task = this.tasks.get(String(params[0]));
      if (task) task.status = TaskStatus.ESCALATED_MODERATION;
      return [];
    }
    if (norm.startsWith("UPDATE moderation_cases SET status = 'RESOLVED'")) {
      const targetId = String(params[0]);
      const closed: Array<{ id: string }> = [];
      for (const mc of this.moderationCases) {
        if (
          mc.target_entity_type === 'revalidation_task' &&
          mc.target_entity_id === targetId &&
          (mc.status === 'PENDING' || mc.status === 'IN_REVIEW')
        ) {
          mc.status = 'RESOLVED';
          mc.resolution_note = String(params[2]);
          closed.push({ id: `mc-${closed.length + 1}` });
        }
      }
      return closed;
    }
    if (norm === 'SELECT id FROM verified_traffic_signs WHERE id = $1') {
      const s = this.signs.get(String(params[0]));
      return s ? [{ id: s.id }] : [];
    }
    if (norm.includes('AS active_tasks') && norm.includes('AS critical_stale_over_180_days')) {
      const allTasks = [...this.tasks.values()];
      const cutoff = Date.now() - 180 * 24 * 60 * 60 * 1000;
      const critical = allTasks.filter((t) => {
        if (![TaskStatus.OPEN, TaskStatus.EVALUATING, TaskStatus.ESCALATED_MODERATION].includes(t.status)) return false;
        const s = this.signs.get(t.verifiedSignId);
        return s ? s.last_verified_at.getTime() <= cutoff : false;
      }).length;
      return [
        {
          active_tasks: allTasks.filter((t) => t.status === TaskStatus.OPEN || t.status === TaskStatus.EVALUATING).length,
          open_tasks: allTasks.filter((t) => t.status === TaskStatus.OPEN).length,
          evaluating_tasks: allTasks.filter((t) => t.status === TaskStatus.EVALUATING).length,
          escalated_tasks: allTasks.filter((t) => t.status === TaskStatus.ESCALATED_MODERATION).length,
          completed_tasks: allTasks.filter((t) => t.status === TaskStatus.COMPLETED).length,
          expired_tasks: allTasks.filter((t) => t.status === TaskStatus.EXPIRED).length,
          critical_stale_over_180_days: critical,
          total_evidences_submitted: this.evidences.size,
        },
      ];
    }

    // 10. Evidences & decisions lookups for getTask / consensus
    if (norm.includes('FROM revalidation_evidences ev LEFT JOIN users u') && norm.includes('WHERE ev.task_id = $1')) {
      const taskId = String(params[0]);
      return [...this.evidences.values()]
        .filter((e) => e.taskId === taskId)
        .map((e) => ({
          id: e.id,
          task_id: e.taskId,
          user_id: e.userId,
          surveyor_name: `Surveyor ${e.userId.slice(0, 4)}`,
          surveyor_email: `${e.userId.slice(0, 4)}@stm.dev`,
          media_url: e.mediaUrl,
          evidence_type: e.evidenceType,
          is_live_capture: e.isLiveCapture,
          accuracy_meters: e.accuracyMeters,
          heading_degrees: e.headingDegrees,
          submitted_at: e.submittedAt,
          location_wkt: `POINT(${e.longitude} ${e.latitude})`,
        }));
    }
    if (norm.startsWith('SELECT id, user_id, media_url, evidence_type, submitted_at')) {
      const taskId = String(params[0]);
      return [...this.evidences.values()]
        .filter((e) => e.taskId === taskId)
        .sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime())
        .map((e) => ({
          id: e.id,
          user_id: e.userId,
          media_url: e.mediaUrl,
          evidence_type: e.evidenceType,
          submitted_at: e.submittedAt,
          latitude: e.latitude,
          longitude: e.longitude,
        }));
    }
    if (norm.startsWith('SELECT decision, reviewer_id, evidence_id, suggested_sign_type_id FROM revalidation_decisions')) {
      const evIds = new Set<string>(params[0] as string[]);
      return this.decisions
        .filter((d) => evIds.has(d.evidenceId))
        .map((d) => ({
          decision: d.decision,
          reviewer_id: d.reviewerId,
          evidence_id: d.evidenceId,
          suggested_sign_type_id: d.suggestedSignTypeId,
        }));
    }
    if (norm.includes('FROM revalidation_decisions rd LEFT JOIN users u')) {
      const evIds = new Set<string>(params[0] as string[]);
      return this.decisions
        .filter((d) => evIds.has(d.evidenceId))
        .map((d) => ({
          id: d.id,
          evidence_id: d.evidenceId,
          reviewer_id: d.reviewerId,
          reviewer_name: `Reviewer ${d.reviewerId.slice(0, 4)}`,
          reviewer_email: `${d.reviewerId.slice(0, 4)}@stm.dev`,
          decision: d.decision,
          suggested_sign_type_id: d.suggestedSignTypeId,
          note: d.note,
          decided_at: d.decidedAt,
        }));
    }

    // 11. Sign location & snapshot & updates
    if (norm.startsWith('SELECT ST_Y(location::geometry) as lat, ST_X(location::geometry) as lon FROM verified_traffic_signs')) {
      const s = this.signs.get(String(params[0]));
      return s ? [{ lat: s.latitude, lon: s.longitude }] : [];
    }
    if (norm.startsWith('SELECT sign_type_id, location, traffic_direction, sign_crop_url FROM verified_traffic_signs')) {
      const s = this.signs.get(String(params[0]));
      return s
        ? [
            {
              sign_type_id: s.sign_type_id,
              location: `POINT(${s.longitude} ${s.latitude})`,
              traffic_direction: s.traffic_direction,
              sign_crop_url: s.sign_crop_url,
            },
          ]
        : [];
    }
    if (norm.startsWith("UPDATE verified_traffic_signs SET status = 'ACTIVE', freshness_score = 1")) {
      const s = this.signs.get(String(params[0]));
      if (s) {
        s.status = 'ACTIVE';
        s.freshness_score = 1;
        if (params[1]) s.sign_crop_url = String(params[1]);
        s.last_verified_at = new Date();
      }
      return [];
    }
    if (norm.startsWith("UPDATE verified_traffic_signs SET status='ACTIVE', freshness_score=1")) {
      const s = this.signs.get(String(params[0]));
      if (s) {
        s.status = 'ACTIVE';
        s.freshness_score = 1;
        s.last_verified_at = new Date();
      }
      return [];
    }
    if (norm.startsWith("UPDATE verified_traffic_signs SET status='DECOMMISSIONED', freshness_score=0")) {
      const s = this.signs.get(String(params[0]));
      if (s) {
        s.status = 'DECOMMISSIONED';
        s.freshness_score = 0;
      }
      return [];
    }
    if (norm.startsWith("UPDATE verified_traffic_signs SET sign_type_id = $1, status = 'ACTIVE'") ||
        norm.startsWith("UPDATE verified_traffic_signs SET sign_type_id=$1, status='ACTIVE'")) {
      const [newTypeId, signId] = [Number(params[0]), String(params[1])];
      const s = this.signs.get(signId);
      if (s) {
        s.sign_type_id = newTypeId;
        s.status = 'ACTIVE';
        s.freshness_score = 1;
        if (params[2]) s.sign_crop_url = String(params[2]);
        s.last_verified_at = new Date();
      }
      return [];
    }

    // 12. History, lifecycle events, moderation_cases, sign types, users
    if (norm.startsWith('INSERT INTO verified_sign_history')) {
      const reason = norm.includes('REVALIDATION_DECOMMISSIONED')
        ? 'REVALIDATION_DECOMMISSIONED'
        : 'REVALIDATION_UPDATE';
      this.signHistory.push({
        verified_sign_id: String(params[0]),
        previous_sign_type_id: params[1] != null ? Number(params[1]) : null,
        previous_crop_url: params[4] != null ? String(params[4]) : null,
        change_reason: reason,
      });
      return [];
    }
    if (norm.startsWith('INSERT INTO sign_lifecycle_events')) {
      const eventType = norm.includes("'REVALIDATED'")
        ? 'REVALIDATED'
        : norm.includes("'DECOMMISSIONED'")
          ? 'DECOMMISSIONED'
          : 'REVALIDATION_CHANGED';
      this.lifecycleEvents.push({
        verified_sign_id: String(params[0]),
        event_type: eventType,
        note: params[1] ? String(params[1]) : eventType,
      });
      return [];
    }
    if (norm.startsWith('INSERT INTO moderation_cases')) {
      this.moderationCases.push({
        case_type: 'REVIEW_CONFLICT',
        target_entity_type: 'revalidation_task',
        target_entity_id: String(params[0]),
        status: 'PENDING',
        resolution_note: String(params[1]),
      });
      return [];
    }
    if (norm === 'SELECT id FROM traffic_sign_types WHERE id=$1') {
      const st = this.signTypes.get(Number(params[0]));
      return st ? [{ id: st.id }] : [];
    }
    if (norm.startsWith('SELECT id, full_name, email FROM users WHERE id = ANY')) {
      const ids = params[0] as string[];
      return ids.map((id) => ({ id, full_name: `User ${id.slice(0, 4)}`, email: `${id.slice(0, 4)}@stm.dev` }));
    }
    if (norm.includes('FROM sign_confirmations')) {
      return [];
    }

    return [];
  }
}

describe('Flow 3: Traffic Sign Revalidation — Supertest Integration Suite (Report 5)', () => {
  let app: INestApplication;
  let db: RevalidationTestDatabase;
  let aiInferenceMock: { classifyEarly: jest.Mock };

  beforeAll(async () => {
    db = new RevalidationTestDatabase();
    aiInferenceMock = {
      classifyEarly: jest.fn().mockResolvedValue({
        className: 'Speed_limit_50',
        standardCode: 'P.127',
        confidence: 0.96,
      }),
    };

    const makeEntityManager = () => ({
      query: (sql: string, params?: any[]) => db.executeQuery(sql, params),
      findOne: async (entity: any, opts: any) => {
        if (entity === RevalidationDecision) {
          const { evidenceId, reviewerId } = opts.where;
          return db.decisions.find((d) => d.evidenceId === evidenceId && d.reviewerId === reviewerId) ?? null;
        }
        return null;
      },
      create: (_entity: any, data: any) => ({ ...data }),
      save: async (entity: any, data: any) => {
        if (entity === RevalidationDecision) {
          const existingIdx = db.decisions.findIndex(
            (d) => d.evidenceId === data.evidenceId && d.reviewerId === data.reviewerId,
          );
          const record: DecisionRecord = {
            id: data.id ?? `dec-${db.decisions.length + 1}`,
            evidenceId: data.evidenceId,
            reviewerId: data.reviewerId,
            decision: data.decision,
            suggestedSignTypeId: data.suggestedSignTypeId ?? null,
            note: data.note ?? null,
            decidedAt: new Date(),
          };
          if (existingIdx >= 0) {
            db.decisions[existingIdx] = record;
          } else {
            db.decisions.push(record);
          }
          return record;
        }
        return data;
      },
    });

    const dataSourceMock = {
      query: (sql: string, params?: any[]) => db.executeQuery(sql, params),
      transaction: async <T>(cb: (manager: any) => Promise<T>): Promise<T> => {
        return cb(makeEntityManager());
      },
    } as unknown as DataSource;

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [RevalidationController],
      providers: [
        RevalidationService,
        {
          provide: getRepositoryToken(RevalidationTask),
          useValue: {
            findOne: jest.fn(async ({ where }: any) => {
              if (where.id) return db.tasks.get(where.id) ?? null;
              if (where.verifiedSignId) {
                return (
                  [...db.tasks.values()].find(
                    (t) =>
                      t.verifiedSignId === where.verifiedSignId &&
                      (t.status === TaskStatus.OPEN || t.status === TaskStatus.EVALUATING),
                  ) ?? null
                );
              }
              return null;
            }),
            create: jest.fn((v: any) => ({ id: `manual-task-${db.tasks.size + 1}`, ...v })),
            save: jest.fn(async (v: any) => {
              db.tasks.set(v.id, v);
              return v;
            }),
          },
        },
        {
          provide: getRepositoryToken(RevalidationEvidence),
          useValue: {
            findOne: jest.fn(async ({ where }: any) => db.evidences.get(where.id) ?? null),
          },
        },
        {
          provide: getRepositoryToken(RevalidationDecision),
          useValue: {
            find: jest.fn(async ({ where }: any) =>
              db.decisions.filter((d) => d.evidenceId === where.evidenceId),
            ),
          },
        },
        {
          provide: getRepositoryToken(FreshnessRule),
          useValue: {
            findOne: jest.fn(async ({ where }: any) => db.freshnessRules.get(where.id) ?? null),
          },
        },
        {
          provide: getRepositoryToken(ConsensusConfig),
          useValue: {
            findOne: jest.fn(async () => ({ minVotesRequired: db.minVotesRequired })),
          },
        },
        { provide: getRepositoryToken(VerifiedSignOrmEntity), useValue: {} },
        { provide: getRepositoryToken(SignLifecycleEvent), useValue: {} },
        { provide: getRepositoryToken(VerifiedSignHistory), useValue: {} },
        { provide: getRepositoryToken(ModerationCase), useValue: {} },
        { provide: getRepositoryToken(SurveyorProfile), useValue: {} },
        { provide: getRepositoryToken(TrafficSignType), useValue: {} },
        { provide: DataSource, useValue: dataSourceMock },
        {
          provide: MinioStorageService,
          useValue: {
            putObject: jest.fn(async (bucket: string, key: string, _buf: Buffer, contentType: string) => {
              db.uploadedObjects.push({ bucket, key, contentType });
              return { bucket, key };
            }),
            getPublicUrl: jest.fn((bucket: string, key: string) => `https://s3.signmap.site/${bucket}/${key}`),
          },
        },
        {
          provide: WalletService,
          useValue: {
            resolveRewardAmount: jest.fn(async (_txType: string, defaultAmount: number) => defaultAmount),
            creditUser: jest.fn(
              async (
                userId: string,
                amount: number,
                txType: string,
                _entityType: string,
                entityId: string,
                description: string,
                opts?: { idempotencyKey?: string },
              ) => {
                const key = opts?.idempotencyKey ?? `${entityId}:${userId}`;
                if (!db.creditTransactions.some((tx) => tx.idempotencyKey === key)) {
                  db.creditTransactions.push({
                    idempotencyKey: key,
                    userId,
                    amount,
                    txType,
                    entityId,
                    description,
                  });
                }
                return { transactionId: `tx-${db.creditTransactions.length}`, newBalance: amount };
              },
            ),
          },
        },
        {
          provide: NotificationsService,
          useValue: {
            create: jest.fn(
              async (
                userId: string,
                type: string,
                title: string,
                message: string,
                relatedEntityType?: string,
                relatedEntityId?: string,
              ) => {
                db.notifications.push({ userId, type, title, message, relatedEntityType, relatedEntityId });
              },
            ),
            createBulk: jest.fn(async (items: NotificationRecord[]) => {
              db.notifications.push(...items);
            }),
          },
        },
        {
          provide: DailyTasksService,
          useValue: { recordProgress: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: AiInferenceService, useValue: aiInferenceMock },
        {
          provide: SystemParametersService,
          useValue: {
            getNumber: jest.fn(async (_k: string, fallback: number) => fallback),
            getString: jest.fn(async (_k: string, fallback: string) => fallback),
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication(new ExpressAdapter());
    app.setGlobalPrefix('api/v1');
    app.use((req: any, _res: any, next: () => void) => {
      req.user = {
        id: req.headers['x-test-user-id'] || SURVEYOR_1,
        role: req.headers['x-test-user-role'] || 'ADMIN',
      };
      next();
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        validatorPackage: classValidator,
        transformerPackage: classTransformer,
      }),
    );
    await app.init();
  });

  beforeEach(() => {
    db.resetAndSeed();
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Ensure clean state and no leaked test records between cases
    db.activeLocks.clear();
  });

  afterAll(async () => {
    await app.close();
  });

  // =========================================================================
  // 1. TASK DISCOVERY
  // =========================================================================
  describe('1. Task Discovery (GET /api/v1/revalidation/tasks, /map, /:taskId)', () => {
    it('TC-REV-01 [PASS]: filters active tasks by GPS radius (lat, lon, radiusMeters)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/revalidation/tasks?lat=10.7769&lon=106.7009&radiusMeters=1000')
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.items[0]).toMatchObject({
        id: TASK_OPEN,
        signId: SIGN_NEAR,
        status: TaskStatus.OPEN,
        distanceMeters: 0,
      });
    });

    it('TC-REV-02 [PASS]: filters active tasks by map Bounding Box (min_lat, min_lon, max_lat, max_lon)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/revalidation/tasks/map?min_lat=10.7&min_lon=106.6&max_lat=10.85&max_lon=106.8')
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.items[0].id).toBe(TASK_OPEN);
    });

    it('TC-REV-03 [PASS]: retrieves task detail with resolved MinIO public URL on evidences', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/revalidation/tasks/${TASK_OPEN}/evidence`)
        .set('x-test-user-id', SURVEYOR_1)
        .set('x-test-user-role', 'SURVEYOR')
        .field('latitude', '10.7769')
        .field('longitude', '106.7009')
        .field('evidenceType', 'STILL_ACTIVE')
        .attach('file', VALID_PNG_BUFFER, { filename: 'sign.png', contentType: 'image/png' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/revalidation/tasks/${TASK_OPEN}`)
        .expect(200);

      expect(res.body.id).toBe(TASK_OPEN);
      expect(res.body.location).toEqual({ lat: 10.7769, lon: 106.7009 });
      expect(res.body.evidences).toHaveLength(1);
      expect(res.body.evidences[0].mediaUrl).toMatch(/^https:\/\/s3\.signmap\.site\/stm-sign-crops\/revalidation\//);
    });

    it('TC-REV-04 [FAIL]: returns 400 Bad Request for out-of-range coordinates (lat > 90)', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/revalidation/tasks?lat=95&lon=106.7&radiusMeters=1000')
        .expect(400);

      await request(app.getHttpServer())
        .get('/api/v1/revalidation/tasks/map?min_lat=10&min_lon=106&max_lat=95&max_lon=107')
        .expect(400);
    });

    it('TC-REV-05 [FAIL]: returns 404 Not Found for non-existent taskId', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/revalidation/tasks/${TASK_UNKNOWN}`)
        .expect(404);
    });
  });

  // =========================================================================
  // 2. EVIDENCE SUBMISSION
  // =========================================================================
  describe('2. Evidence Submission (POST /api/v1/revalidation/tasks/:taskId/evidence)', () => {
    it('TC-REV-06 [PASS]: accepts valid image within <= 50m, uploads to MinIO, and flips task OPEN -> EVALUATING', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/revalidation/tasks/${TASK_OPEN}/evidence`)
        .set('x-test-user-id', SURVEYOR_1)
        .set('x-test-user-role', 'SURVEYOR')
        .field('latitude', '10.7770') // ~11m north of 10.7769
        .field('longitude', '106.7009')
        .field('evidenceType', 'STILL_ACTIVE')
        .field('isLiveCapture', 'true')
        .attach('file', VALID_PNG_BUFFER, { filename: 'field.png', contentType: 'image/png' })
        .expect(201);

      expect(res.body.distanceMeters).toBeLessThanOrEqual(50);
      expect(res.body.isLiveCapture).toBe(true);
      expect(db.tasks.get(TASK_OPEN)?.status).toBe(TaskStatus.EVALUATING);
      expect(db.uploadedObjects).toHaveLength(1);
      expect(db.activeLocks.has(`task:${TASK_OPEN}`)).toBe(true);
    });

    it('TC-REV-07 [FAIL - GPS Guardrail]: rejects evidence > 50m away from sign with 400 Bad Request', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/revalidation/tasks/${TASK_OPEN}/evidence`)
        .set('x-test-user-id', SURVEYOR_1)
        .set('x-test-user-role', 'SURVEYOR')
        .field('latitude', '10.7780') // ~122m away
        .field('longitude', '106.7009')
        .field('evidenceType', 'STILL_ACTIVE')
        .attach('file', VALID_PNG_BUFFER, { filename: 'far.png', contentType: 'image/png' })
        .expect(400);

      expect(res.body.message).toMatch(/too far from target sign/i);
      expect(db.tasks.get(TASK_OPEN)?.status).toBe(TaskStatus.OPEN);
    });

    it('TC-REV-08 [FAIL - Rate Limit]: rejects 4th submission within 24h (> dailySubmissionLimit=3) with 429', async () => {
      for (const surveyorId of [SURVEYOR_1, SURVEYOR_2, SURVEYOR_3]) {
        await request(app.getHttpServer())
          .post(`/api/v1/revalidation/tasks/${TASK_OPEN}/evidence`)
          .set('x-test-user-id', surveyorId)
          .set('x-test-user-role', 'SURVEYOR')
          .field('latitude', '10.7769')
          .field('longitude', '106.7009')
          .field('evidenceType', 'STILL_ACTIVE')
          .attach('file', VALID_PNG_BUFFER, { filename: `${surveyorId}.png`, contentType: 'image/png' })
          .expect(201);
      }

      const res = await request(app.getHttpServer())
        .post(`/api/v1/revalidation/tasks/${TASK_OPEN}/evidence`)
        .set('x-test-user-id', SURVEYOR_4)
        .set('x-test-user-role', 'SURVEYOR')
        .field('latitude', '10.7769')
        .field('longitude', '106.7009')
        .field('evidenceType', 'STILL_ACTIVE')
        .attach('file', VALID_PNG_BUFFER, { filename: 'fourth.png', contentType: 'image/png' })
        .expect(429);

      expect(res.body.message).toMatch(/Daily submission limit/i);
    });

    it('TC-REV-09 [FAIL - Invalid State]: rejects evidence on COMPLETED or EXPIRED tasks with 400 Bad Request', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/revalidation/tasks/${TASK_COMPLETED}/evidence`)
        .set('x-test-user-id', SURVEYOR_1)
        .set('x-test-user-role', 'SURVEYOR')
        .field('latitude', '10.7770')
        .field('longitude', '106.7010')
        .attach('file', VALID_PNG_BUFFER, { filename: 'closed.png', contentType: 'image/png' })
        .expect(400);

      await request(app.getHttpServer())
        .post(`/api/v1/revalidation/tasks/${TASK_EXPIRED}/evidence`)
        .set('x-test-user-id', SURVEYOR_1)
        .set('x-test-user-role', 'SURVEYOR')
        .field('latitude', '10.7770')
        .field('longitude', '106.7010')
        .attach('file', VALID_PNG_BUFFER, { filename: 'expired.png', contentType: 'image/png' })
        .expect(400);
    });
  });

  // =========================================================================
  // 3. REVIEW VOTING & CONSENSUS ENGINE
  // =========================================================================
  describe('3. Peer Review Voting & Consensus (POST /api/v1/revalidation/evidence/:evidenceId/vote)', () => {
    async function submitFieldEvidence(evidenceType: 'STILL_ACTIVE' | 'REMOVED' | 'CHANGED', userId = SURVEYOR_1): Promise<string> {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/revalidation/tasks/${TASK_OPEN}/evidence`)
        .set('x-test-user-id', userId)
        .set('x-test-user-role', 'SURVEYOR')
        .field('latitude', '10.7769')
        .field('longitude', '106.7009')
        .field('evidenceType', evidenceType)
        .attach('file', VALID_PNG_BUFFER, { filename: `${evidenceType}.png`, contentType: 'image/png' })
        .expect(201);
      return res.body.id;
    }

    it('TC-REV-10 [PASS - Unchanged]: STILL_ACTIVE consensus resets freshness_score=1, records history, and credits Surveyor & Reviewer idempotently', async () => {
      const evidenceId = await submitFieldEvidence('STILL_ACTIVE');

      const res = await request(app.getHttpServer())
        .post(`/api/v1/revalidation/evidence/${evidenceId}/vote`)
        .set('x-test-user-id', REVIEWER_1)
        .set('x-test-user-role', 'REVIEWER')
        .send({ decision: 'STILL_ACTIVE', note: 'Sign clearly visible' })
        .expect(201);

      expect(res.body.consensus).toMatchObject({
        evaluated: true,
        reason: 'CONSENSUS_REACHED',
        winningDecision: 'STILL_ACTIVE',
        signAction: 'REFRESHED',
        creditedSubmitters: 1,
        creditedReviewers: 1,
      });
      expect(db.tasks.get(TASK_OPEN)?.status).toBe(TaskStatus.COMPLETED);
      expect(db.signs.get(SIGN_NEAR)?.freshness_score).toBe(1);
      expect(db.signs.get(SIGN_NEAR)?.status).toBe('ACTIVE');
      expect(db.signHistory).toHaveLength(1);
      expect(db.lifecycleEvents.some((e) => e.event_type === 'REVALIDATED')).toBe(true);
      expect(db.creditTransactions).toHaveLength(2);
      expect(db.creditTransactions.map((t) => t.userId).sort()).toEqual([SURVEYOR_1, REVIEWER_1].sort());
      expect(db.creditTransactions.every((t) => t.idempotencyKey.startsWith(`revalidation:${TASK_OPEN}:`))).toBe(true);
    });

    it('TC-REV-11 [PASS - Removed]: REMOVED consensus transitions sign to DECOMMISSIONED with freshness_score=0', async () => {
      const evidenceId = await submitFieldEvidence('REMOVED');

      const res = await request(app.getHttpServer())
        .post(`/api/v1/revalidation/evidence/${evidenceId}/vote`)
        .set('x-test-user-id', REVIEWER_1)
        .set('x-test-user-role', 'REVIEWER')
        .send({ decision: 'REMOVED', note: 'Pole removed' })
        .expect(201);

      expect(res.body.consensus).toMatchObject({
        evaluated: true,
        winningDecision: 'REMOVED',
        signAction: 'DECOMMISSIONED',
      });
      expect(db.signs.get(SIGN_NEAR)?.status).toBe('DECOMMISSIONED');
      expect(db.signs.get(SIGN_NEAR)?.freshness_score).toBe(0);
      expect(db.signHistory[0]?.change_reason).toBe('REVALIDATION_DECOMMISSIONED');
      expect(db.lifecycleEvents.some((e) => e.event_type === 'DECOMMISSIONED')).toBe(true);
    });

    it('TC-REV-12 [PASS - Changed]: CHANGED consensus updates sign_type_id and archives previous type in verified_sign_history', async () => {
      const evidenceId = await submitFieldEvidence('CHANGED');

      const res = await request(app.getHttpServer())
        .post(`/api/v1/revalidation/evidence/${evidenceId}/vote`)
        .set('x-test-user-id', REVIEWER_1)
        .set('x-test-user-role', 'REVIEWER')
        .send({ decision: 'CHANGED', suggestedSignTypeId: 42, note: 'Replaced with Speed Limit 50' })
        .expect(201);

      expect(res.body.consensus).toMatchObject({
        evaluated: true,
        winningDecision: 'CHANGED',
        signAction: 'UPDATED_TYPE',
      });
      expect(db.signs.get(SIGN_NEAR)?.sign_type_id).toBe(42);
      expect(db.signs.get(SIGN_NEAR)?.freshness_score).toBe(1);
      expect(db.signHistory[0]?.previous_sign_type_id).toBe(10);
      expect(db.lifecycleEvents.some((e) => e.event_type === 'REVALIDATION_CHANGED')).toBe(true);
    });

    it('TC-REV-13 [FAIL - Self-Review]: returns 403 Forbidden when surveyor votes on own evidence', async () => {
      const evidenceId = await submitFieldEvidence('STILL_ACTIVE', SURVEYOR_1);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/revalidation/evidence/${evidenceId}/vote`)
        .set('x-test-user-id', SURVEYOR_1)
        .set('x-test-user-role', 'REVIEWER')
        .send({ decision: 'STILL_ACTIVE' })
        .expect(403);

      expect(res.body.message).toMatch(/cannot vote on your own/i);
    });

    it('TC-REV-14 [FAIL - Duplicate Vote]: returns 400 Bad Request when same reviewer votes twice on same evidence', async () => {
      db.minVotesRequired = 2;
      const evidenceId = await submitFieldEvidence('STILL_ACTIVE');

      await request(app.getHttpServer())
        .post(`/api/v1/revalidation/evidence/${evidenceId}/vote`)
        .set('x-test-user-id', REVIEWER_1)
        .set('x-test-user-role', 'REVIEWER')
        .send({ decision: 'STILL_ACTIVE' })
        .expect(201);

      const dupRes = await request(app.getHttpServer())
        .post(`/api/v1/revalidation/evidence/${evidenceId}/vote`)
        .set('x-test-user-id', REVIEWER_1)
        .set('x-test-user-role', 'REVIEWER')
        .send({ decision: 'STILL_ACTIVE' })
        .expect(400);

      expect(dupRes.body.message).toMatch(/already voted/i);
    });

    it('TC-REV-15 [EDGE - Conflict Escalation]: tie between STILL_ACTIVE and REMOVED escalates task to ESCALATED_MODERATION and creates moderation_cases', async () => {
      db.minVotesRequired = 2;
      const evidenceId = await submitFieldEvidence('STILL_ACTIVE');

      await request(app.getHttpServer())
        .post(`/api/v1/revalidation/evidence/${evidenceId}/vote`)
        .set('x-test-user-id', REVIEWER_1)
        .set('x-test-user-role', 'REVIEWER')
        .send({ decision: 'STILL_ACTIVE' })
        .expect(201);

      const tieRes = await request(app.getHttpServer())
        .post(`/api/v1/revalidation/evidence/${evidenceId}/vote`)
        .set('x-test-user-id', REVIEWER_2)
        .set('x-test-user-role', 'REVIEWER')
        .send({ decision: 'REMOVED' })
        .expect(201);

      expect(tieRes.body.consensus).toMatchObject({
        evaluated: true,
        reason: 'CONFLICT',
        escalatedToModeration: true,
      });
      expect(db.tasks.get(TASK_OPEN)?.status).toBe(TaskStatus.ESCALATED_MODERATION);
      expect(db.moderationCases).toHaveLength(1);
      expect(db.moderationCases[0]).toMatchObject({
        case_type: 'REVIEW_CONFLICT',
        target_entity_type: 'revalidation_task',
        target_entity_id: TASK_OPEN,
        status: 'PENDING',
      });
      expect(db.creditTransactions).toHaveLength(0);
    });
  });

  // =========================================================================
  // 4. RECAPTURE REQUEST & MANUAL FINALIZE
  // =========================================================================
  describe('4. Recapture Request & Staff Finalize', () => {
    it('TC-REV-16 [PASS]: request-recapture stores UNCLEAR decision and dispatches REVALIDATION_RECAPTURE_REQUESTED notification', async () => {
      const evRes = await request(app.getHttpServer())
        .post(`/api/v1/revalidation/tasks/${TASK_OPEN}/evidence`)
        .set('x-test-user-id', SURVEYOR_1)
        .set('x-test-user-role', 'SURVEYOR')
        .field('latitude', '10.7769')
        .field('longitude', '106.7009')
        .field('evidenceType', 'STILL_ACTIVE')
        .attach('file', VALID_PNG_BUFFER, { filename: 'blurry.png', contentType: 'image/png' })
        .expect(201);

      const evidenceId = evRes.body.id;

      const res = await request(app.getHttpServer())
        .post(`/api/v1/revalidation/evidence/${evidenceId}/request-recapture`)
        .set('x-test-user-id', REVIEWER_1)
        .set('x-test-user-role', 'REVIEWER')
        .send({ reason: 'BLURRY', note: 'Biển báo bị lóa sáng' })
        .expect(201);

      expect(res.body).toMatchObject({
        success: true,
        evidenceId,
        notificationSent: true,
      });
      expect(db.decisions).toHaveLength(1);
      expect(db.decisions[0].decision).toBe('UNCLEAR');
      expect(db.notifications).toContainEqual(
        expect.objectContaining({
          userId: SURVEYOR_1,
          type: 'REVALIDATION_RECAPTURE_REQUESTED',
          relatedEntityId: evidenceId,
        }),
      );
    });

    it('TC-REV-17 [PASS]: Staff finalize settles an evaluating task with existing votes into COMPLETED', async () => {
      db.minVotesRequired = 3; // Prevent auto-consensus after 1 vote so Staff can manually finalize
      const evRes = await request(app.getHttpServer())
        .post(`/api/v1/revalidation/tasks/${TASK_OPEN}/evidence`)
        .set('x-test-user-id', SURVEYOR_1)
        .set('x-test-user-role', 'SURVEYOR')
        .field('latitude', '10.7769')
        .field('longitude', '106.7009')
        .field('evidenceType', 'STILL_ACTIVE')
        .attach('file', VALID_PNG_BUFFER, { filename: 'valid.png', contentType: 'image/png' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/revalidation/evidence/${evRes.body.id}/vote`)
        .set('x-test-user-id', REVIEWER_1)
        .set('x-test-user-role', 'REVIEWER')
        .send({ decision: 'STILL_ACTIVE' })
        .expect(201);

      expect(db.tasks.get(TASK_OPEN)?.status).toBe(TaskStatus.EVALUATING);

      const finRes = await request(app.getHttpServer())
        .post(`/api/v1/revalidation/tasks/${TASK_OPEN}/finalize`)
        .set('x-test-user-id', STAFF_USER)
        .set('x-test-user-role', 'STAFF')
        .expect(201);

      expect(finRes.body).toMatchObject({
        evaluated: true,
        reason: 'CONSENSUS_REACHED',
        winningDecision: 'STILL_ACTIVE',
        signAction: 'REFRESHED',
      });
      expect(db.tasks.get(TASK_OPEN)?.status).toBe(TaskStatus.COMPLETED);
      expect(db.creditTransactions).toHaveLength(2);
    });
  });

  // =========================================================================
  // 5. STAFF MANUAL TASK CREATION (UC #32), KPI SUMMARY & ESCALATED RESOLUTION (UC #33)
  // =========================================================================
  describe('5. Staff Operations: Manual Task Creation, KPI Summary & Escalated Resolution', () => {
    it('TC-REV-18 [PASS]: Staff creates a manual revalidation task for a sign without active tasks, and blocks duplicate active tasks with 409', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/revalidation/tasks')
        .set('x-test-user-id', STAFF_USER)
        .set('x-test-user-role', 'STAFF')
        .send({
          verifiedSignId: SIGN_CLOSED,
          priority: 'HIGH',
          rewardCredits: 40,
          expiresInDays: 7,
          note: 'Citizen reported missing school zone warning sign',
        })
        .expect(201);

      expect(res.body).toMatchObject({
        verifiedSignId: SIGN_CLOSED,
        priority: 'HIGH',
        rewardCredits: 40,
        status: TaskStatus.OPEN,
      });

      // Second manual task for same sign while active -> 409 Conflict
      await request(app.getHttpServer())
        .post('/api/v1/revalidation/tasks')
        .set('x-test-user-id', STAFF_USER)
        .set('x-test-user-role', 'STAFF')
        .send({ verifiedSignId: SIGN_CLOSED })
        .expect(409);
    });

    it('TC-REV-19 [PASS]: GET /api/v1/revalidation/tasks/summary returns operational KPI metrics', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/revalidation/tasks/summary')
        .set('x-test-user-id', STAFF_USER)
        .set('x-test-user-role', 'STAFF')
        .expect(200);

      expect(res.body).toMatchObject({
        activeTasks: 2,
        openTasks: 2,
        evaluatingTasks: 0,
        escalatedTasks: 0,
        completedTasks: 1,
        expiredTasks: 1,
        totalEvidencesSubmitted: 0,
      });
    });

    it('TC-REV-20 [PASS]: Staff resolves an ESCALATED_MODERATION task as CHANGED, updates sign, credits rewards, and closes moderation_cases', async () => {
      db.minVotesRequired = 2;
      const evRes = await request(app.getHttpServer())
        .post(`/api/v1/revalidation/tasks/${TASK_OPEN}/evidence`)
        .set('x-test-user-id', SURVEYOR_1)
        .set('x-test-user-role', 'SURVEYOR')
        .field('latitude', '10.7769')
        .field('longitude', '106.7009')
        .field('evidenceType', 'CHANGED')
        .attach('file', VALID_PNG_BUFFER, { filename: 'changed-tie.png', contentType: 'image/png' })
        .expect(201);

      // Create tie -> ESCALATED_MODERATION + PENDING moderation_case
      await request(app.getHttpServer())
        .post(`/api/v1/revalidation/evidence/${evRes.body.id}/vote`)
        .set('x-test-user-id', REVIEWER_1)
        .set('x-test-user-role', 'REVIEWER')
        .send({ decision: 'STILL_ACTIVE' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/revalidation/evidence/${evRes.body.id}/vote`)
        .set('x-test-user-id', REVIEWER_2)
        .set('x-test-user-role', 'REVIEWER')
        .send({ decision: 'REMOVED' })
        .expect(201);

      expect(db.tasks.get(TASK_OPEN)?.status).toBe(TaskStatus.ESCALATED_MODERATION);
      expect(db.moderationCases[0]?.status).toBe('PENDING');

      const resolveRes = await request(app.getHttpServer())
        .post(`/api/v1/revalidation/tasks/${TASK_OPEN}/resolve`)
        .set('x-test-user-id', STAFF_USER)
        .set('x-test-user-role', 'STAFF')
        .send({
          decision: 'CHANGED',
          suggestedSignTypeId: 42,
          note: 'Verified replacement speed limit 50 sign',
        })
        .expect(201);

      expect(resolveRes.body).toMatchObject({
        evaluated: true,
        reason: 'STAFF_RESOLVED',
        winningDecision: 'CHANGED',
        signAction: 'UPDATED_TYPE',
        resolvedBy: STAFF_USER,
        moderationCasesClosed: 1,
      });
      expect(db.tasks.get(TASK_OPEN)?.status).toBe(TaskStatus.COMPLETED);
      expect(db.signs.get(SIGN_NEAR)?.sign_type_id).toBe(42);
      expect(db.moderationCases[0]?.status).toBe('RESOLVED');
    });

    it('TC-REV-21 [PASS]: Staff resolving escalated task as INVALID rejects evidence and reopens task to OPEN without paying rewards', async () => {
      db.tasks.get(TASK_OPEN)!.status = TaskStatus.ESCALATED_MODERATION;
      db.moderationCases.push({
        case_type: 'REVIEW_CONFLICT',
        target_entity_type: 'revalidation_task',
        target_entity_id: TASK_OPEN,
        status: 'PENDING',
        resolution_note: 'All votes UNCLEAR',
      });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/revalidation/tasks/${TASK_OPEN}/resolve`)
        .set('x-test-user-id', STAFF_USER)
        .set('x-test-user-role', 'STAFF')
        .send({ decision: 'INVALID', note: 'Blurry photo, reopen for fresh capture' })
        .expect(201);

      expect(res.body).toMatchObject({
        reason: 'EVIDENCE_REJECTED_REOPENED',
        signAction: 'NO_CHANGE',
        moderationCasesClosed: 1,
      });
      expect(db.tasks.get(TASK_OPEN)?.status).toBe(TaskStatus.OPEN);
      expect(db.moderationCases[0]?.status).toBe('RESOLVED');
      expect(db.creditTransactions).toHaveLength(0);
    });
  });
});
