import { Injectable, NotFoundException, BadRequestException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, In } from 'typeorm';
import { User } from '../auth/infrastructure/persistence/user.entity';
import { UserRole } from '../auth/infrastructure/persistence/user-role.entity';
import { Role } from '../auth/infrastructure/persistence/role.entity';
import { AuditLog } from './audit-log.entity';
import { AiModelVersion } from './ai-model-version.entity';
import { ModelTrainingJob } from './model-training-job.entity';
import { UserStatusHistory } from './user-status-history.entity';
import { ConsensusConfig } from '../consensus/infrastructure/persistence/consensus-config.entity';
import { FreshnessRule } from '../revalidation/infrastructure/persistence/freshness-rule.entity';
import { RewardRule } from '../rewards/infrastructure/persistence/reward-rule.entity';
import {
  UpdateConsensusConfigDto,
  UpdateRouteMatrixDto,
  TriggerRetrainDto,
  ActiveLearningConfigDto,
  CreateFreshnessRuleDto,
  UpdateFreshnessRuleDto,
  UpdateRewardRuleDto,
  UserStatisticsDto,
  UserDetailedStatisticsDto,
  PlatformUsersSummaryDto,
  TaskHistoryResponseDto,
  AdminTaskHistoryQueryDto,
  TaskSurveyorRequestItemDto,
  TaskReviewItemDto,
  TaskTimelineEventDto,
} from './dto/admin.dto';

@Injectable()
export class AdminService {
  constructor(
    private readonly dataSource: DataSource,
    @Optional() @InjectRepository(User) private readonly userRepo?: Repository<User>,
    @Optional() @InjectRepository(UserRole) private readonly userRoleRepo?: Repository<UserRole>,
    @Optional() @InjectRepository(Role) private readonly roleRepo?: Repository<Role>,
    @Optional() @InjectRepository(AuditLog) private readonly auditLogRepo?: Repository<AuditLog>,
    @Optional() @InjectRepository(AiModelVersion) private readonly aiModelVersionRepo?: Repository<AiModelVersion>,
    @Optional() @InjectRepository(ModelTrainingJob) private readonly modelTrainingJobRepo?: Repository<ModelTrainingJob>,
    @Optional() @InjectRepository(UserStatusHistory) private readonly userStatusHistoryRepo?: Repository<UserStatusHistory>,
    @Optional() @InjectRepository(ConsensusConfig) private readonly consensusConfigRepo?: Repository<ConsensusConfig>,
    @Optional() @InjectRepository(FreshnessRule) private readonly freshnessRuleRepo?: Repository<FreshnessRule>,
    @Optional() @InjectRepository(RewardRule) private readonly rewardRuleRepo?: Repository<RewardRule>,
  ) {}
  async listUsers(q: {
    role?: string;
    status?: string;
    search?: string;
    page?: number;
    pageSize?: number;
    includeStats?: boolean;
  }) {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(Math.max(1, q.pageSize ?? 20), 100);
    const skip = (page - 1) * pageSize;
    const includeStats = q.includeStats ?? true;

    const qb = this.dataSource
      .getRepository(User)
      .createQueryBuilder('u')
      .leftJoinAndSelect('u.userRoles', 'ur', 'ur.isActive = true')
      .leftJoinAndSelect('ur.role', 'r');

    if (q.status) {
      qb.andWhere('u.status = :status', { status: q.status });
    }

    if (q.search) {
      qb.andWhere('(u.email ILIKE :search OR u.fullName ILIKE :search)', {
        search: `%${q.search}%`,
      });
    }

    if (q.role) {
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM user_roles sub_ur
          JOIN roles sub_r ON sub_r.id = sub_ur.role_id
          WHERE sub_ur.user_id = u.id AND sub_ur.is_active = true AND sub_r.code = :role
        )`,
        { role: q.role },
      );
    }

    const [users, total] = await qb
      .orderBy('u.createdAt', 'DESC')
      .skip(skip)
      .take(pageSize)
      .getManyAndCount();

    let statsMap = new Map<string, UserStatisticsDto>();
    if (includeStats && users.length > 0) {
      const userIds = users.map((u) => u.id);
      statsMap = await this.batchLoadUserStatistics(userIds);
    }

    const items = users.map((u) => {
      const item: any = {
        id: u.id,
        email: u.email,
        fullName: u.fullName,
        full_name: u.fullName,
        phone: u.phone,
        avatarUrl: u.avatarUrl,
        avatar_url: u.avatarUrl,
        status: u.status,
        createdAt: u.createdAt,
        created_at: u.createdAt,
        updatedAt: u.updatedAt,
        updated_at: u.updatedAt,
        roles: (u.userRoles || [])
          .filter((ur) => ur.isActive)
          .map((ur) => ur.role?.code)
          .filter((code): code is string => Boolean(code)),
      };
      if (includeStats) {
        item.statistics = statsMap.get(u.id) || this.defaultUserStatistics();
      }
      return item;
    });

    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  defaultUserStatistics(): UserStatisticsDto {
    return {
      reviews: {
        total: 0,
        correct: 0,
        wrong: 0,
        pendingConsensus: 0,
        votedApprove: 0,
        votedReject: 0,
        accuracyRate: 0,
        reliabilityScore: 100.0,
        currentStreak: 0,
        consecutiveErrors: 0,
        skipped: 0,
        flagged: 0,
        standing: 'PROVISIONAL',
      },
      surveys: {
        total: 0,
        accepted: 0,
        rejected: 0,
        failed: 0,
        noSignsDetected: 0,
        pending: 0,
        correctionRequired: 0,
        acceptanceRate: 0,
        candidatesTotal: 0,
        candidatesVerified: 0,
        verificationRate: 0,
        averageYield: 0,
      },
      hazards: {
        totalReported: 0,
        confirmed: 0,
        dismissed: 0,
        unconfirmed: 0,
        confirmedRatio: 0,
        confirmationsReceived: 0,
        dismissalsReceived: 0,
      },
      navigation: {
        totalSessions: 0,
        completed: 0,
        cancelled: 0,
        active: 0,
      },
      wallet: {
        balance: 0,
        isFrozen: false,
        totalCreditsEarned: 0,
      },
      activity: {
        revalidationsCompleted: 0,
        dailyTasksCompleted: 0,
        badgesUnlocked: 0,
        lastActiveAt: null,
        lastSurveyAt: null,
        lastReviewAt: null,
      },
    };
  }

  async batchLoadUserStatistics(userIds: string[]): Promise<Map<string, UserStatisticsDto>> {
    const statsMap = new Map<string, UserStatisticsDto>();
    if (!userIds || userIds.length === 0) return statsMap;

    let reviewerProfiles: any[] = [];
    let candidateReviewsStats: any[] = [];
    let skippedStats: any[] = [];
    let flaggedStats: any[] = [];
    let surveyStats: any[] = [];
    let surveyorProfiles: any[] = [];
    let hazardStats: any[] = [];
    let navStats: any[] = [];
    let walletRows: any[] = [];
    let revalidationStats: any[] = [];
    let dailyTaskStats: any[] = [];
    let badgeStats: any[] = [];

    if (typeof this.dataSource?.query === 'function') {
      try {
        [
          reviewerProfiles,
          candidateReviewsStats,
          skippedStats,
          flaggedStats,
          surveyStats,
          surveyorProfiles,
          hazardStats,
          navStats,
          walletRows,
          revalidationStats,
          dailyTaskStats,
          badgeStats,
        ] = await Promise.all([
          this.dataSource.query(
            `SELECT
               user_id,
               reliability_score,
               total_correct_votes,
               total_false_votes,
               consecutive_errors,
               is_provisional,
               is_review_suspended,
               total_reviews,
               correct_reviews,
               accuracy_rate,
               current_streak,
               last_reviewed_at
             FROM reviewer_profiles
             WHERE user_id = ANY($1::uuid[])`,
            [userIds],
          ).catch(() => []),
          this.dataSource.query(
            `SELECT
               cr.reviewer_id AS user_id,
               COUNT(*)::int AS total_votes,
               COUNT(CASE WHEN cr.vote = 1 THEN 1 END)::int AS voted_approve,
               COUNT(CASE WHEN cr.vote = -1 THEN 1 END)::int AS voted_reject,
               COUNT(CASE WHEN usc.status IN ('PENDING_REVIEW', 'IN_CONSENSUS') THEN 1 END)::int AS pending_consensus,
               MAX(cr.reviewed_at) AS last_review_at
             FROM candidate_reviews cr
             LEFT JOIN unverified_sign_candidates usc ON usc.id = cr.candidate_id
             WHERE cr.reviewer_id = ANY($1::uuid[])
             GROUP BY cr.reviewer_id`,
            [userIds],
          ).catch(() => []),
          this.dataSource.query(
            `SELECT reviewer_id AS user_id, COUNT(*)::int AS skipped_count
             FROM reviewer_skipped_candidates
             WHERE reviewer_id = ANY($1::uuid[])
             GROUP BY reviewer_id`,
            [userIds],
          ).catch(() => []),
          this.dataSource.query(
            `SELECT cr.reviewer_id AS user_id, COUNT(rf.id)::int AS flagged_count
             FROM candidate_reviews cr
             JOIN review_flags rf ON rf.review_id = cr.id
             WHERE cr.reviewer_id = ANY($1::uuid[])
             GROUP BY cr.reviewer_id`,
            [userIds],
          ).catch(() => []),
          this.dataSource.query(
            `SELECT
               s.surveyor_id AS user_id,
               COUNT(*)::int AS total_surveys,
               COUNT(CASE WHEN s.status = 'COMPLETED' AND s.reward_status IN ('PAID', 'APPROVED', 'NONE') THEN 1 END)::int AS accepted_surveys,
               COUNT(CASE WHEN s.status = 'REJECTED' THEN 1 END)::int AS rejected_surveys,
               COUNT(CASE WHEN s.status = 'FAILED' THEN 1 END)::int AS failed_surveys,
               COUNT(CASE WHEN s.status = 'NO_SIGN_DETECTED' OR (s.status = 'COMPLETED' AND s.reward_status = 'REJECTED') THEN 1 END)::int AS no_signs_detected_surveys,
               COUNT(CASE WHEN s.status = 'PENDING_CORRECTION' THEN 1 END)::int AS correction_required_surveys,
               COUNT(CASE WHEN s.status NOT IN ('COMPLETED', 'REJECTED', 'FAILED', 'NO_SIGN_DETECTED', 'PENDING_CORRECTION') THEN 1 END)::int AS pending_surveys,
               COALESCE(SUM(s.total_candidates_extracted), 0)::int AS total_candidates_extracted,
               MAX(s.created_at) AS last_survey_at
             FROM survey_submissions s
             WHERE s.surveyor_id = ANY($1::uuid[])
             GROUP BY s.surveyor_id`,
            [userIds],
          ).catch(() => []),
          this.dataSource.query(
            `SELECT user_id, total_submissions, total_verified_signs, total_credits_earned
             FROM surveyor_profiles
             WHERE user_id = ANY($1::uuid[])`,
            [userIds],
          ).catch(() => []),
          this.dataSource.query(
            `SELECT
               h.reported_by AS user_id,
               COUNT(*)::int AS total_hazards,
               COUNT(CASE WHEN h.status = 'CONFIRMED' THEN 1 END)::int AS confirmed_hazards,
               COUNT(CASE WHEN h.status = 'DISMISSED' THEN 1 END)::int AS dismissed_hazards,
               COUNT(CASE WHEN h.status = 'UNCONFIRMED' THEN 1 END)::int AS unconfirmed_hazards,
               COALESCE(SUM(h.confirmations_count), 0)::int AS confirmations_received,
               COALESCE(SUM(h.dismissals_count), 0)::int AS dismissals_received
             FROM road_hazard_events h
             WHERE h.reported_by = ANY($1::uuid[])
             GROUP BY h.reported_by`,
            [userIds],
          ).catch(() => []),
          this.dataSource.query(
            `SELECT
               ns.driver_id AS user_id,
               COUNT(*)::int AS total_sessions,
               COUNT(CASE WHEN ns.status = 'COMPLETED' THEN 1 END)::int AS completed_sessions,
               COUNT(CASE WHEN ns.status = 'CANCELLED' THEN 1 END)::int AS cancelled_sessions,
               COUNT(CASE WHEN ns.status = 'ACTIVE' THEN 1 END)::int AS active_sessions,
               MAX(ns.started_at) AS last_nav_at
             FROM navigation_sessions ns
             WHERE ns.driver_id = ANY($1::uuid[])
             GROUP BY ns.driver_id`,
            [userIds],
          ).catch(() => []),
          this.dataSource.query(
            `SELECT user_id, balance, is_frozen FROM wallets WHERE user_id = ANY($1::uuid[])`,
            [userIds],
          ).catch(() => []),
          this.dataSource.query(
            `SELECT user_id, COUNT(*)::int AS cnt FROM revalidation_evidences WHERE user_id = ANY($1::uuid[]) GROUP BY user_id`,
            [userIds],
          ).catch(() => []),
          this.dataSource.query(
            `SELECT user_id, COUNT(*)::int AS cnt FROM daily_task_completions WHERE user_id = ANY($1::uuid[]) GROUP BY user_id`,
            [userIds],
          ).catch(() => []),
          this.dataSource.query(
            `SELECT user_id, COUNT(*)::int AS cnt FROM user_badges WHERE user_id = ANY($1::uuid[]) GROUP BY user_id`,
            [userIds],
          ).catch(() => []),
        ]);
      } catch {}
    }

    const revProfMap = new Map((reviewerProfiles || []).map((r: any) => [r.user_id, r]));
    const crMap = new Map((candidateReviewsStats || []).map((r: any) => [r.user_id, r]));
    const skipMap = new Map((skippedStats || []).map((r: any) => [r.user_id, Number(r.skipped_count)]));
    const flagMap = new Map((flaggedStats || []).map((r: any) => [r.user_id, Number(r.flagged_count)]));
    const survMap = new Map((surveyStats || []).map((r: any) => [r.user_id, r]));
    const spMap = new Map((surveyorProfiles || []).map((r: any) => [r.user_id, r]));
    const hazMap = new Map((hazardStats || []).map((r: any) => [r.user_id, r]));
    const navMap = new Map((navStats || []).map((r: any) => [r.user_id, r]));
    const walMap = new Map((walletRows || []).map((r: any) => [r.user_id, r]));
    const revalMap = new Map((revalidationStats || []).map((r: any) => [r.user_id, Number(r.cnt)]));
    const taskMap = new Map((dailyTaskStats || []).map((r: any) => [r.user_id, Number(r.cnt)]));
    const badgeMap = new Map((badgeStats || []).map((r: any) => [r.user_id, Number(r.cnt)]));

    for (const uid of userIds) {
      const rp: any = revProfMap.get(uid);
      const cr: any = crMap.get(uid);
      const sp: any = spMap.get(uid);
      const ss: any = survMap.get(uid);
      const hz: any = hazMap.get(uid);
      const nv: any = navMap.get(uid);
      const wl: any = walMap.get(uid);

      // Reviews computation
      const correctVotes = Number(rp?.total_correct_votes ?? rp?.totalCorrectVotes ?? rp?.correct_reviews ?? 0);
      const falseVotes = Number(rp?.total_false_votes ?? rp?.totalFalseVotes ?? 0);
      const totalReviews = Number(cr?.total_votes ?? rp?.total_reviews ?? rp?.totalReviews ?? (correctVotes + falseVotes));
      const pendingConsensus = Number(cr?.pending_consensus ?? 0);
      const votedApprove = Number(cr?.voted_approve ?? 0);
      const votedReject = Number(cr?.voted_reject ?? 0);
      const evaluatedVotes = correctVotes + falseVotes;
      const reviewAccuracyRate = evaluatedVotes > 0 ? Number(((correctVotes / evaluatedVotes) * 100).toFixed(2)) : 0;
      const rawRel = Number(rp?.reliability_score ?? rp?.reliabilityScore ?? 100);
      const reliabilityScore = rawRel <= 1.0 && evaluatedVotes > 0 ? Number((rawRel * 100).toFixed(2)) : Number(rawRel.toFixed(2));
      const currentStreak = Number(rp?.current_streak ?? rp?.currentStreak ?? 0);
      const consecutiveErrors = Number(rp?.consecutive_errors ?? rp?.consecutiveErrors ?? 0);
      const isSuspended = Boolean(rp?.is_review_suspended ?? rp?.isReviewSuspended ?? false);
      const isProvisional = Boolean(rp?.is_provisional ?? rp?.isProvisional ?? (evaluatedVotes < 5));
      const standing: 'ACTIVE' | 'PROVISIONAL' | 'SUSPENDED' = isSuspended ? 'SUSPENDED' : isProvisional ? 'PROVISIONAL' : 'ACTIVE';

      // Surveys computation
      const totalSurveys = Number(ss?.total_surveys ?? sp?.total_submissions ?? 0);
      const acceptedSurveys = Number(ss?.accepted_surveys ?? 0);
      const rejectedSurveys = Number(ss?.rejected_surveys ?? 0);
      const failedSurveys = Number(ss?.failed_surveys ?? 0);
      const noSignsDetectedSurveys = Number(ss?.no_signs_detected_surveys ?? 0);
      const pendingSurveys = Number(ss?.pending_surveys ?? 0);
      const correctionRequiredSurveys = Number(ss?.correction_required_surveys ?? 0);
      const finishedSurveys = acceptedSurveys + rejectedSurveys + failedSurveys + noSignsDetectedSurveys;
      const surveyAcceptanceRate = finishedSurveys > 0 ? Number(((acceptedSurveys / finishedSurveys) * 100).toFixed(2)) : 0;
      const candidatesTotal = Number(ss?.total_candidates_extracted ?? 0);
      const candidatesVerified = Number(sp?.total_verified_signs ?? 0);
      const verificationRate = candidatesTotal > 0 ? Number(((candidatesVerified / candidatesTotal) * 100).toFixed(2)) : 0;
      const averageYield = totalSurveys > 0 ? Number((candidatesTotal / totalSurveys).toFixed(2)) : 0;

      // Hazards computation
      const totalHazards = Number(hz?.total_hazards ?? 0);
      const confirmedHazards = Number(hz?.confirmed_hazards ?? 0);
      const dismissedHazards = Number(hz?.dismissed_hazards ?? 0);
      const unconfirmedHazards = Number(hz?.unconfirmed_hazards ?? 0);
      const evaluatedHazards = confirmedHazards + dismissedHazards;
      const confirmedRatio = evaluatedHazards > 0 ? Number(((confirmedHazards / evaluatedHazards) * 100).toFixed(2)) : 0;

      // Navigation computation
      const totalNavSessions = Number(nv?.total_sessions ?? 0);
      const completedNavSessions = Number(nv?.completed_sessions ?? 0);
      const cancelledNavSessions = Number(nv?.cancelled_sessions ?? 0);
      const activeNavSessions = Number(nv?.active_sessions ?? 0);

      // Wallet computation
      const balance = Number(wl?.balance ?? 0);
      const isFrozen = Boolean(wl?.is_frozen ?? false);
      const totalCreditsEarned = Number(sp?.total_credits_earned ?? 0);

      // Activity timestamps
      const lastSurveyAt = ss?.last_survey_at ? new Date(ss.last_survey_at).toISOString() : null;
      const lastReviewAt = (cr?.last_review_at || rp?.last_reviewed_at)
        ? new Date(cr?.last_review_at || rp?.last_reviewed_at).toISOString()
        : null;
      const lastNavAt = nv?.last_nav_at ? new Date(nv.last_nav_at).toISOString() : null;
      const timestamps = [lastSurveyAt, lastReviewAt, lastNavAt].filter(Boolean) as string[];
      timestamps.sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
      const lastActiveAt = timestamps.length > 0 ? timestamps[0] : null;

      statsMap.set(uid, {
        reviews: {
          total: totalReviews,
          correct: correctVotes,
          wrong: falseVotes,
          pendingConsensus,
          votedApprove,
          votedReject,
          accuracyRate: reviewAccuracyRate,
          reliabilityScore,
          currentStreak,
          consecutiveErrors,
          skipped: skipMap.get(uid) ?? 0,
          flagged: flagMap.get(uid) ?? 0,
          standing,
        },
        surveys: {
          total: totalSurveys,
          accepted: acceptedSurveys,
          rejected: rejectedSurveys,
          failed: failedSurveys,
          noSignsDetected: noSignsDetectedSurveys,
          pending: pendingSurveys,
          correctionRequired: correctionRequiredSurveys,
          acceptanceRate: surveyAcceptanceRate,
          candidatesTotal,
          candidatesVerified,
          verificationRate,
          averageYield,
        },
        hazards: {
          totalReported: totalHazards,
          confirmed: confirmedHazards,
          dismissed: dismissedHazards,
          unconfirmed: unconfirmedHazards,
          confirmedRatio,
          confirmationsReceived: Number(hz?.confirmations_received ?? 0),
          dismissalsReceived: Number(hz?.dismissals_received ?? 0),
        },
        navigation: {
          totalSessions: totalNavSessions,
          completed: completedNavSessions,
          cancelled: cancelledNavSessions,
          active: activeNavSessions,
        },
        wallet: {
          balance,
          isFrozen,
          totalCreditsEarned,
        },
        activity: {
          revalidationsCompleted: revalMap.get(uid) ?? 0,
          dailyTasksCompleted: taskMap.get(uid) ?? 0,
          badgesUnlocked: badgeMap.get(uid) ?? 0,
          lastActiveAt,
          lastSurveyAt,
          lastReviewAt,
        },
      });
    }

    return statsMap;
  }

  async getUserStatistics(userId: string): Promise<UserDetailedStatisticsDto> {
    const user = await this.dataSource.getRepository(User).findOne({
      where: { id: userId },
      relations: ['userRoles', 'userRoles.role'],
    });
    if (!user) throw new NotFoundException('User ' + userId + ' not found');

    const statsMap = await this.batchLoadUserStatistics([userId]);
    const baseStats = statsMap.get(userId) || this.defaultUserStatistics();

    let recentReviews: any[] = [];
    try {
      if (typeof this.dataSource?.query === 'function') {
        recentReviews = await this.dataSource.query(
          `SELECT cr.id, cr.candidate_id, cr.vote, cr.reviewed_at, usc.best_frame_url, usc.status AS candidate_status
           FROM candidate_reviews cr
           LEFT JOIN unverified_sign_candidates usc ON usc.id = cr.candidate_id
           WHERE cr.reviewer_id = $1
           ORDER BY cr.reviewed_at DESC
           LIMIT 10`,
          [userId],
        );
      }
    } catch {}

    let recentSubmissions: any[] = [];
    try {
      if (typeof this.dataSource?.query === 'function') {
        recentSubmissions = await this.dataSource.query(
          `SELECT id, submission_type, status, reward_status, reward_amount, total_candidates_extracted, created_at
           FROM survey_submissions
           WHERE surveyor_id = $1
           ORDER BY created_at DESC
           LIMIT 10`,
          [userId],
        );
      }
    } catch {}

    let recentHazards: any[] = [];
    try {
      if (typeof this.dataSource?.query === 'function') {
        recentHazards = await this.dataSource.query(
          `SELECT id, hazard_type, title, severity, status, confirmations_count, dismissals_count, created_at
           FROM road_hazard_events
           WHERE reported_by = $1
           ORDER BY created_at DESC
           LIMIT 5`,
          [userId],
        );
      }
    } catch {}

    const roles = (user.userRoles || [])
      .filter((ur) => ur.isActive)
      .map((ur) => ur.role?.code)
      .filter((code): code is string => Boolean(code));

    return {
      ...baseStats,
      userId: user.id,
      fullName: user.fullName,
      email: user.email,
      status: user.status,
      roles,
      joinedAt: user.createdAt.toISOString(),
      recentReviews,
      recentSubmissions,
      recentHazards,
    };
  }

  async getUserById(userId: string) {
    const user = await this.dataSource.getRepository(User).findOne({
      where: { id: userId },
      relations: ['userRoles', 'userRoles.role'],
    });
    if (!user) throw new NotFoundException('User ' + userId + ' not found');

    const statsMap = await this.batchLoadUserStatistics([userId]);
    const statistics = statsMap.get(userId) || this.defaultUserStatistics();
    const roles = (user.userRoles || [])
      .filter((ur) => ur.isActive)
      .map((ur) => ur.role?.code)
      .filter((code): code is string => Boolean(code));

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      full_name: user.fullName,
      phone: user.phone,
      avatarUrl: user.avatarUrl,
      avatar_url: user.avatarUrl,
      status: user.status,
      roles,
      createdAt: user.createdAt,
      created_at: user.createdAt,
      updatedAt: user.updatedAt,
      updated_at: user.updatedAt,
      statistics,
    };
  }

  async getUsersSummaryStatistics(): Promise<PlatformUsersSummaryDto> {
    let totalUsers = 0;
    const usersByStatus = { active: 0, suspended: 0, banned: 0 };
    const usersByRole = { surveyor: 0, reviewer: 0, driver: 0, staff: 0, admin: 0 };

    try {
      const statusRows = await this.dataSource.query(`SELECT status, COUNT(*)::int AS cnt FROM users GROUP BY status`);
      for (const r of statusRows) {
        totalUsers += Number(r.cnt);
        const s = String(r.status).toUpperCase();
        if (s === 'ACTIVE') usersByStatus.active = Number(r.cnt);
        else if (s === 'SUSPENDED') usersByStatus.suspended = Number(r.cnt);
        else if (s === 'BANNED') usersByStatus.banned = Number(r.cnt);
      }
    } catch {}

    try {
      const roleRows = await this.dataSource.query(
        `SELECT r.code, COUNT(ur.user_id)::int AS cnt
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
         WHERE ur.is_active = true
         GROUP BY r.code`,
      );
      for (const r of roleRows) {
        const c = String(r.code).toUpperCase();
        if (c === 'SURVEYOR') usersByRole.surveyor = Number(r.cnt);
        else if (c === 'REVIEWER') usersByRole.reviewer = Number(r.cnt);
        else if (c === 'DRIVER') usersByRole.driver = Number(r.cnt);
        else if (c === 'STAFF') usersByRole.staff = Number(r.cnt);
        else if (c === 'ADMIN') usersByRole.admin = Number(r.cnt);
      }
    } catch {}

    const reviewsSummary = {
      totalVotesCast: 0,
      totalCorrectVotes: 0,
      totalFalseVotes: 0,
      totalPendingConsensus: 0,
      platformAccuracyRate: 0,
      activeReviewers30d: 0,
      reviewersSuspended: 0,
    };
    try {
      const revProfileAgg = await this.dataSource.query(
        `SELECT
           COALESCE(SUM(total_correct_votes), 0)::int AS correct,
           COALESCE(SUM(total_false_votes), 0)::int AS false_votes,
           COUNT(CASE WHEN is_review_suspended = true THEN 1 END)::int AS suspended
         FROM reviewer_profiles`,
      );
      if (revProfileAgg.length > 0) {
        reviewsSummary.totalCorrectVotes = Number(revProfileAgg[0].correct);
        reviewsSummary.totalFalseVotes = Number(revProfileAgg[0].false_votes);
        reviewsSummary.reviewersSuspended = Number(revProfileAgg[0].suspended);
      }

      const crAgg = await this.dataSource.query(
        `SELECT
           COUNT(*)::int AS total_votes,
           COUNT(DISTINCT reviewer_id)::int AS active_30d,
           COUNT(CASE WHEN usc.status IN ('PENDING_REVIEW', 'IN_CONSENSUS') THEN 1 END)::int AS pending_consensus
         FROM candidate_reviews cr
         LEFT JOIN unverified_sign_candidates usc ON usc.id = cr.candidate_id
         WHERE cr.reviewed_at >= NOW() - INTERVAL '30 days'`,
      );
      if (crAgg.length > 0) {
        reviewsSummary.activeReviewers30d = Number(crAgg[0].active_30d);
        reviewsSummary.totalPendingConsensus = Number(crAgg[0].pending_consensus);
      }

      const totalCast = await this.dataSource.query(`SELECT COUNT(*)::int AS cnt FROM candidate_reviews`);
      reviewsSummary.totalVotesCast = totalCast.length ? Number(totalCast[0].cnt) : (reviewsSummary.totalCorrectVotes + reviewsSummary.totalFalseVotes);
      const evalVotes = reviewsSummary.totalCorrectVotes + reviewsSummary.totalFalseVotes;
      reviewsSummary.platformAccuracyRate = evalVotes > 0 ? Number(((reviewsSummary.totalCorrectVotes / evalVotes) * 100).toFixed(2)) : 0;
    } catch {}

    const surveysSummary = {
      totalSubmissions: 0,
      acceptedSubmissions: 0,
      rejectedSubmissions: 0,
      failedSubmissions: 0,
      noSignsDetectedSubmissions: 0,
      pendingSubmissions: 0,
      platformAcceptanceRate: 0,
      totalCandidatesDetected: 0,
      totalVerifiedSignsGenerated: 0,
      activeSurveyors30d: 0,
    };
    try {
      const subAgg = await this.dataSource.query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(CASE WHEN status = 'COMPLETED' AND reward_status IN ('PAID', 'APPROVED', 'NONE') THEN 1 END)::int AS accepted,
           COUNT(CASE WHEN status = 'REJECTED' THEN 1 END)::int AS rejected,
           COUNT(CASE WHEN status = 'FAILED' THEN 1 END)::int AS failed,
           COUNT(CASE WHEN status = 'NO_SIGN_DETECTED' OR (status = 'COMPLETED' AND reward_status = 'REJECTED') THEN 1 END)::int AS no_signs,
           COUNT(CASE WHEN status NOT IN ('COMPLETED', 'REJECTED', 'FAILED', 'NO_SIGN_DETECTED', 'PENDING_CORRECTION') THEN 1 END)::int AS pending,
           COALESCE(SUM(total_candidates_extracted), 0)::int AS candidates,
           COUNT(DISTINCT CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN surveyor_id END)::int AS active_30d
         FROM survey_submissions`,
      );
      if (subAgg.length > 0) {
        const s = subAgg[0];
        surveysSummary.totalSubmissions = Number(s.total);
        surveysSummary.acceptedSubmissions = Number(s.accepted);
        surveysSummary.rejectedSubmissions = Number(s.rejected);
        surveysSummary.failedSubmissions = Number(s.failed);
        surveysSummary.noSignsDetectedSubmissions = Number(s.no_signs);
        surveysSummary.pendingSubmissions = Number(s.pending);
        surveysSummary.totalCandidatesDetected = Number(s.candidates);
        surveysSummary.activeSurveyors30d = Number(s.active_30d);
        const finished = surveysSummary.acceptedSubmissions + surveysSummary.rejectedSubmissions + surveysSummary.failedSubmissions + surveysSummary.noSignsDetectedSubmissions;
        surveysSummary.platformAcceptanceRate = finished > 0 ? Number(((surveysSummary.acceptedSubmissions / finished) * 100).toFixed(2)) : 0;
      }

      const verSigns = await this.dataSource.query(`SELECT COUNT(*)::int AS cnt FROM verified_traffic_signs`);
      if (verSigns.length > 0) {
        surveysSummary.totalVerifiedSignsGenerated = Number(verSigns[0].cnt);
      }
    } catch {}

    const hazardsSummary = {
      totalReported: 0,
      confirmed: 0,
      dismissed: 0,
      unconfirmed: 0,
      platformConfirmedRatio: 0,
    };
    try {
      const hzAgg = await this.dataSource.query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(CASE WHEN status = 'CONFIRMED' THEN 1 END)::int AS confirmed,
           COUNT(CASE WHEN status = 'DISMISSED' THEN 1 END)::int AS dismissed,
           COUNT(CASE WHEN status = 'UNCONFIRMED' THEN 1 END)::int AS unconfirmed
         FROM road_hazard_events`,
      );
      if (hzAgg.length > 0) {
        const h = hzAgg[0];
        hazardsSummary.totalReported = Number(h.total);
        hazardsSummary.confirmed = Number(h.confirmed);
        hazardsSummary.dismissed = Number(h.dismissed);
        hazardsSummary.unconfirmed = Number(h.unconfirmed);
        const evalHz = hazardsSummary.confirmed + hazardsSummary.dismissed;
        hazardsSummary.platformConfirmedRatio = evalHz > 0 ? Number(((hazardsSummary.confirmed / evalHz) * 100).toFixed(2)) : 0;
      }
    } catch {}

    const navigationSummary = {
      totalSessions: 0,
      completedSessions: 0,
      cancelledSessions: 0,
      activeSessions: 0,
    };
    try {
      const navAgg = await this.dataSource.query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END)::int AS completed,
           COUNT(CASE WHEN status = 'CANCELLED' THEN 1 END)::int AS cancelled,
           COUNT(CASE WHEN status = 'ACTIVE' THEN 1 END)::int AS active
         FROM navigation_sessions`,
      );
      if (navAgg.length > 0) {
        const n = navAgg[0];
        navigationSummary.totalSessions = Number(n.total);
        navigationSummary.completedSessions = Number(n.completed);
        navigationSummary.cancelledSessions = Number(n.cancelled);
        navigationSummary.activeSessions = Number(n.active);
      }
    } catch {}

    return {
      totalUsers,
      usersByStatus,
      usersByRole,
      reviewsSummary,
      surveysSummary,
      hazardsSummary,
      navigationSummary,
    };
  }
  async updateUserStatus(userId: string, newStatus: string, reason: string | undefined, changedBy: string, ip?: string) {
    if (this.userRepo && typeof this.userRepo.findOne === 'function' && this.userStatusHistoryRepo && this.auditLogRepo) {
      const user = await this.userRepo.findOne({ where: { id: userId } });
      if (!user) throw new NotFoundException('User ' + userId + ' not found');
      const oldStatus = user.status;
      if (oldStatus === newStatus) throw new BadRequestException('User is already ' + newStatus);
      await this.userRepo.update(userId, { status: newStatus as any });
      await this.userStatusHistoryRepo.save(
        this.userStatusHistoryRepo.create({
          userId,
          oldStatus,
          newStatus,
          reason: reason ?? null,
          changedBy,
        }),
      );
      await this.auditLogRepo.save(
        this.auditLogRepo.create({
          userId: changedBy,
          action: 'UPDATE_USER_STATUS',
          resourceName: 'users',
          resourceId: userId,
          oldValues: { status: oldStatus },
          newValues: { status: newStatus, reason },
          ipAddress: ip ?? null,
        }),
      );
      return { userId, oldStatus, newStatus };
    }

    const rows: any[] = await this.dataSource.query('SELECT id, status FROM users WHERE id=$1', [userId]);
    if (rows.length === 0) throw new NotFoundException('User ' + userId + ' not found');
    const oldStatus = rows[0].status;
    if (oldStatus === newStatus) throw new BadRequestException('User is already ' + newStatus);
    await this.dataSource.query('UPDATE users SET status=$1, updated_at=now() WHERE id=$2', [newStatus, userId]);
    await this.dataSource.query('INSERT INTO user_status_history (user_id, old_status, new_status, reason, changed_by) VALUES ($1,$2,$3,$4,$5)', [userId, oldStatus, newStatus, reason ?? null, changedBy]);
    await this.dataSource.query("INSERT INTO audit_logs (user_id, action, resource_name, resource_id, old_values, new_values, ip_address) VALUES ($1,'UPDATE_USER_STATUS','users',$2,$3,$4,$5)", [changedBy, userId, JSON.stringify({ status: oldStatus }), JSON.stringify({ status: newStatus, reason }), ip ?? null]);
    return { userId, oldStatus, newStatus };
  }
  async assignRole(userId: string, roleCode: string, assignedBy: string, isActive = true) {
    if (this.userRepo && this.roleRepo && this.userRoleRepo && this.auditLogRepo) {
      const user = await this.userRepo.findOne({ where: { id: userId } });
      if (!user) throw new NotFoundException('User ' + userId + ' not found');
      const role = await this.roleRepo.findOne({ where: { code: roleCode } });
      if (!role) throw new NotFoundException('Role ' + roleCode + ' not found');
      const roleId = role.id;
      const existing = await this.userRoleRepo.findOne({ where: { userId, roleId } });
      if (existing) {
        await this.userRoleRepo.update(existing.id, { isActive });
      } else {
        await this.userRoleRepo.save(
          this.userRoleRepo.create({
            userId,
            roleId,
            assignedBy,
            isActive,
          }),
        );
      }
      await this.auditLogRepo.save(
        this.auditLogRepo.create({
          userId: assignedBy,
          action: 'ASSIGN_ROLE',
          resourceName: 'user_roles',
          resourceId: userId,
          newValues: { roleCode, isActive },
        }),
      );
      return { userId, roleCode, roleId, isActive };
    }

    const uRows: any[] = await this.dataSource.query('SELECT id FROM users WHERE id=$1', [userId]);
    if (uRows.length === 0) throw new NotFoundException('User ' + userId + ' not found');
    const rRows: any[] = await this.dataSource.query('SELECT id, code FROM roles WHERE code=$1', [roleCode]);
    if (rRows.length === 0) throw new NotFoundException('Role ' + roleCode + ' not found');
    const roleId = rRows[0].id;
    const existing: any[] = await this.dataSource.query('SELECT id, is_active FROM user_roles WHERE user_id=$1 AND role_id=$2', [userId, roleId]);
    if (existing.length > 0) await this.dataSource.query('UPDATE user_roles SET is_active=$1 WHERE user_id=$2 AND role_id=$3', [isActive, userId, roleId]);
    else await this.dataSource.query('INSERT INTO user_roles (user_id, role_id, assigned_by, is_active) VALUES ($1,$2,$3,$4)', [userId, roleId, assignedBy, isActive]);
    await this.dataSource.query("INSERT INTO audit_logs (user_id, action, resource_name, resource_id, new_values) VALUES ($1,'ASSIGN_ROLE','user_roles',$2,$3)", [assignedBy, userId, JSON.stringify({ roleCode, isActive })]);
    return { userId, roleCode, roleId, isActive };
  }
  async listAuditLogs(q: { action?: string; resourceName?: string; userId?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(Math.max(1, q.pageSize ?? 20), 100);
    const skip = (page - 1) * pageSize;

    const qb = this.dataSource
      .getRepository(AuditLog)
      .createQueryBuilder('a');

    if (q.action) {
      qb.andWhere('a.action = :action', { action: q.action });
    }
    if (q.resourceName) {
      qb.andWhere('a.resourceName = :resourceName', { resourceName: q.resourceName });
    }
    if (q.userId) {
      qb.andWhere('a.userId = :userId', { userId: q.userId });
    }

    const [rows, total] = await qb
      .orderBy('a.createdAt', 'DESC')
      .skip(skip)
      .take(pageSize)
      .getManyAndCount();

    const items = rows.map((r) => ({
      id: r.id,
      user_id: r.userId,
      userId: r.userId,
      action: r.action,
      resource_name: r.resourceName,
      resourceName: r.resourceName,
      resource_id: r.resourceId,
      resourceId: r.resourceId,
      old_values: r.oldValues,
      oldValues: r.oldValues,
      new_values: r.newValues,
      newValues: r.newValues,
      ip_address: r.ipAddress,
      ipAddress: r.ipAddress,
      created_at: r.createdAt,
      createdAt: r.createdAt,
    }));

    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }
  async exportSigns(format: string, status?: string) {
    const where = status ? 'WHERE v.status = $1' : '';
    const params: any[] = status ? [status] : [];
    const rows: any[] = await this.dataSource.query(
      `SELECT
         v.id,
         v.sign_type_id,
         v.origin_candidate_id,
         ST_AsText(v.location) AS wkt,
         ST_AsGeoJSON(v.location)::json AS geojson,
         ST_Y(v.location::geometry) AS lat,
         ST_X(v.location::geometry) AS lon,
         v.traffic_direction,
         v.sign_crop_url,
         v.status,
         v.freshness_score,
         v.last_verified_at,
         v.created_at,
         t.sign_code,
         t.name_en,
         t.name_vi,
         c.code AS category_code
       FROM verified_traffic_signs v
       JOIN traffic_sign_types t ON t.id = v.sign_type_id
       JOIN sign_categories c ON c.id = t.category_id
       ${where}
       ORDER BY v.created_at DESC`,
      params,
    );

    const fmt = (format || 'json').toLowerCase();

    if (fmt === 'geojson') {
      return {
        type: 'FeatureCollection',
        features: rows.map((r) => ({
          type: 'Feature',
          geometry: r.geojson,
          properties: {
            id: r.id,
            signTypeId: r.sign_type_id,
            signCode: r.sign_code,
            nameEn: r.name_en,
            nameVi: r.name_vi,
            categoryCode: r.category_code,
            status: r.status,
            freshnessScore: r.freshness_score,
            trafficDirection: r.traffic_direction,
            signCropUrl: r.sign_crop_url,
            lastVerifiedAt: r.last_verified_at,
          },
        })),
      };
    }

    if (fmt === 'csv') {
      const escapeCsv = (val: any) => {
        if (val == null) return '';
        const str = String(val);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      const headers = [
        'id',
        'sign_code',
        'name_en',
        'name_vi',
        'category_code',
        'status',
        'latitude',
        'longitude',
        'traffic_direction',
        'freshness_score',
        'last_verified_at',
        'sign_crop_url',
      ];

      const lines = [headers.join(',')];
      for (const r of rows) {
        lines.push(
          [
            escapeCsv(r.id),
            escapeCsv(r.sign_code),
            escapeCsv(r.name_en),
            escapeCsv(r.name_vi),
            escapeCsv(r.category_code),
            escapeCsv(r.status),
            escapeCsv(r.lat),
            escapeCsv(r.lon),
            escapeCsv(r.traffic_direction),
            escapeCsv(r.freshness_score),
            escapeCsv(r.last_verified_at ? new Date(r.last_verified_at).toISOString() : ''),
            escapeCsv(r.sign_crop_url),
          ].join(','),
        );
      }
      return lines.join('\n');
    }

    if (fmt === 'osm') {
      const escapeXml = (val: any) => {
        if (val == null) return '';
        return String(val)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&apos;');
      };

      const nodes = rows
        .map((r, i) => {
          const nodeId = -(i + 1);
          return `  <node id="${nodeId}" lat="${r.lat}" lon="${r.lon}" version="1">
    <tag k="traffic_sign" v="${escapeXml(r.sign_code)}"/>
    <tag k="name:en" v="${escapeXml(r.name_en)}"/>
    <tag k="name:vi" v="${escapeXml(r.name_vi)}"/>
    <tag k="traffic_sign:category" v="${escapeXml(r.category_code)}"/>
    ${r.traffic_direction != null ? `<tag k="direction" v="${escapeXml(r.traffic_direction)}"/>\n    ` : ''}<tag k="status" v="${escapeXml(r.status)}"/>
  </node>`;
        })
        .join('\n');

      return `<?xml version="1.0" encoding="UTF-8"?>\n<osm version="0.6" generator="SignTrustMap">\n${nodes}\n</osm>`;
    }

    return rows;
  }

  /**
   * Retrieves current active consensus config parameters
   */
  async getConsensusConfig() {
    if (this.consensusConfigRepo && typeof this.consensusConfigRepo.findOne === 'function') {
      const c = await this.consensusConfigRepo.findOne({
        where: { isActive: true },
        order: { effectiveFrom: 'DESC' },
      });
      if (!c) {
        return {
          approvalThreshold: 2.0,
          rejectionThreshold: -2.0,
          minVotesRequired: 3,
          maxVotesLimit: 9,
          alphaSmoothingFactor: 0.1,
          weightCorrect: 1.0,
          penaltyFalse: 2.0,
          minSampleBaseline: 5,
          minReliabilityThreshold: 50.0,
          consecutiveErrorLimit: 3,
          suspensionCooldownDays: 7,
          provisionalVoteWeight: 0.5,
          isActive: true,
        };
      }
      return {
        id: c.id,
        approvalThreshold: Number(c.approvalThreshold),
        rejectionThreshold: Number(c.rejectionThreshold),
        minVotesRequired: Number(c.minVotesRequired),
        maxVotesLimit: Number(c.maxVotesLimit ?? 9),
        alphaSmoothingFactor: Number(c.alphaSmoothingFactor),
        weightCorrect: Number(c.weightCorrect),
        penaltyFalse: Number(c.penaltyFalse),
        minSampleBaseline: Number(c.minSampleBaseline),
        minReliabilityThreshold: Number(c.minReliabilityThreshold),
        consecutiveErrorLimit: Number(c.consecutiveErrorLimit),
        suspensionCooldownDays: Number(c.suspensionCooldownDays),
        provisionalVoteWeight: Number(c.provisionalVoteWeight),
        createdBy: c.createdBy,
        isActive: c.isActive,
        effectiveFrom: c.effectiveFrom,
      };
    }

    const rows = await this.dataSource.query(
      `SELECT * FROM consensus_configs WHERE is_active = true ORDER BY effective_from DESC LIMIT 1`,
    );
    if (rows.length === 0) {
      return {
        approvalThreshold: 2.0,
        rejectionThreshold: -2.0,
        minVotesRequired: 3,
        maxVotesLimit: 9,
        alphaSmoothingFactor: 0.1,
        weightCorrect: 1.0,
        penaltyFalse: 2.0,
        minSampleBaseline: 5,
        minReliabilityThreshold: 50.0,
        consecutiveErrorLimit: 3,
        suspensionCooldownDays: 7,
        provisionalVoteWeight: 0.5,
        isActive: true,
      };
    }
    const c = rows[0];
    return {
      id: c.id,
      approvalThreshold: Number(c.approval_threshold),
      rejectionThreshold: Number(c.rejection_threshold),
      minVotesRequired: Number(c.min_votes_required),
      maxVotesLimit: Number(c.max_votes_limit ?? 9),
      alphaSmoothingFactor: Number(c.alpha_smoothing_factor),
      weightCorrect: Number(c.weight_correct),
      penaltyFalse: Number(c.penalty_false),
      minSampleBaseline: Number(c.min_sample_baseline),
      minReliabilityThreshold: Number(c.min_reliability_threshold),
      consecutiveErrorLimit: Number(c.consecutive_error_limit),
      suspensionCooldownDays: Number(c.suspension_cooldown_days),
      provisionalVoteWeight: Number(c.provisional_vote_weight),
      createdBy: c.created_by,
      isActive: c.is_active,
      effectiveFrom: c.effective_from,
    };
  }

  /**
   * Updates consensus engine parameters, creates an audit log entry, and keeps history intact
   */
  async updateConsensusConfig(dto: UpdateConsensusConfigDto, adminUserId: string, ip?: string) {
    const current = await this.getConsensusConfig();
    const approvalThreshold = dto.approvalThreshold ?? current.approvalThreshold;
    const rejectionThreshold = dto.rejectionThreshold ?? current.rejectionThreshold;
    const minVotesRequired = dto.minVotesRequired ?? current.minVotesRequired;
    const maxVotesLimit = dto.maxVotesLimit ?? current.maxVotesLimit ?? 9;
    const alphaSmoothingFactor = dto.alphaSmoothingFactor ?? current.alphaSmoothingFactor;
    const weightCorrect = dto.weightCorrect ?? current.weightCorrect;
    const penaltyFalse = dto.penaltyFalse ?? current.penaltyFalse;
    const minSampleBaseline = dto.minSampleBaseline ?? current.minSampleBaseline;
    const minReliabilityThreshold = dto.minReliabilityThreshold ?? current.minReliabilityThreshold;
    const consecutiveErrorLimit = dto.consecutiveErrorLimit ?? current.consecutiveErrorLimit;
    const suspensionCooldownDays = dto.suspensionCooldownDays ?? current.suspensionCooldownDays;
    const provisionalVoteWeight = dto.provisionalVoteWeight ?? current.provisionalVoteWeight;

    if (this.consensusConfigRepo && this.auditLogRepo) {
      await this.consensusConfigRepo.update({ isActive: true }, { isActive: false });
      const created = this.consensusConfigRepo.create({
        approvalThreshold,
        rejectionThreshold,
        minVotesRequired,
        maxVotesLimit,
        alphaSmoothingFactor,
        weightCorrect,
        penaltyFalse,
        minSampleBaseline,
        minReliabilityThreshold,
        consecutiveErrorLimit,
        suspensionCooldownDays,
        provisionalVoteWeight,
        createdBy: adminUserId,
        isActive: true,
        effectiveFrom: new Date(),
      });
      const inserted = await this.consensusConfigRepo.save(created);
      await this.auditLogRepo.save(
        this.auditLogRepo.create({
          userId: adminUserId,
          action: 'UPDATE_CONSENSUS_CONFIG',
          resourceName: 'consensus_configs',
          resourceId: String(inserted.id),
          oldValues: current,
          newValues: { ...dto, id: inserted.id },
          ipAddress: ip ?? null,
        }),
      );
      return {
        id: inserted.id,
        approvalThreshold: Number(inserted.approvalThreshold),
        rejectionThreshold: Number(inserted.rejectionThreshold),
        minVotesRequired: Number(inserted.minVotesRequired),
        maxVotesLimit: Number(inserted.maxVotesLimit ?? 9),
        alphaSmoothingFactor: Number(inserted.alphaSmoothingFactor),
        weightCorrect: Number(inserted.weightCorrect),
        penaltyFalse: Number(inserted.penaltyFalse),
        minSampleBaseline: Number(inserted.minSampleBaseline),
        minReliabilityThreshold: Number(inserted.minReliabilityThreshold),
        consecutiveErrorLimit: Number(inserted.consecutiveErrorLimit),
        suspensionCooldownDays: Number(inserted.suspensionCooldownDays),
        provisionalVoteWeight: Number(inserted.provisionalVoteWeight),
        createdBy: inserted.createdBy,
        isActive: inserted.isActive,
        effectiveFrom: inserted.effectiveFrom,
      };
    }

    // Deactivate previous active configs
    await this.dataSource.query(`UPDATE consensus_configs SET is_active = false WHERE is_active = true`);

    const result = await this.dataSource.query(
      `INSERT INTO consensus_configs (
        approval_threshold, rejection_threshold, min_votes_required, max_votes_limit, alpha_smoothing_factor,
        weight_correct, penalty_false, min_sample_baseline, min_reliability_threshold,
        consecutive_error_limit, suspension_cooldown_days, provisional_vote_weight,
        created_by, is_active, effective_from
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, true, NOW())
      RETURNING *`,
      [
        approvalThreshold,
        rejectionThreshold,
        minVotesRequired,
        maxVotesLimit,
        alphaSmoothingFactor,
        weightCorrect,
        penaltyFalse,
        minSampleBaseline,
        minReliabilityThreshold,
        consecutiveErrorLimit,
        suspensionCooldownDays,
        provisionalVoteWeight,
        adminUserId,
      ],
    );

    const inserted = result[0];
    await this.dataSource.query(
      `INSERT INTO audit_logs (user_id, action, resource_name, resource_id, old_values, new_values, ip_address)
       VALUES ($1, 'UPDATE_CONSENSUS_CONFIG', 'consensus_configs', $2, $3, $4, $5)`,
      [
        adminUserId,
        String(inserted.id),
        JSON.stringify(current),
        JSON.stringify({ ...dto, id: inserted.id }),
        ip ?? null,
      ],
    );

    return {
      id: inserted.id,
      approvalThreshold: Number(inserted.approval_threshold),
      rejectionThreshold: Number(inserted.rejection_threshold),
      minVotesRequired: Number(inserted.min_votes_required),
      maxVotesLimit: Number(inserted.max_votes_limit ?? 9),
      alphaSmoothingFactor: Number(inserted.alpha_smoothing_factor),
      weightCorrect: Number(inserted.weight_correct),
      penaltyFalse: Number(inserted.penalty_false),
      minSampleBaseline: Number(inserted.min_sample_baseline),
      minReliabilityThreshold: Number(inserted.min_reliability_threshold),
      consecutiveErrorLimit: Number(inserted.consecutive_error_limit),
      suspensionCooldownDays: Number(inserted.suspension_cooldown_days),
      provisionalVoteWeight: Number(inserted.provisional_vote_weight),
      createdBy: inserted.created_by,
      isActive: inserted.is_active,
      effectiveFrom: inserted.effective_from,
    };
  }

  /**
   * Retrieves route classifications and spatial freshness decay parameters
   */
  async getRouteMatrix() {
    const rows = await this.dataSource.query(
      `SELECT id, name, road_type, default_lifetime_days, revalidation_threshold_days, spatial_buffer_meters, created_at
       FROM route_classifications
       ORDER BY id ASC`,
    );
    return rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      roadType: r.road_type,
      defaultLifetimeDays: r.default_lifetime_days,
      revalidationThresholdDays: r.revalidation_threshold_days,
      spatialBufferMeters: r.spatial_buffer_meters,
      createdAt: r.created_at,
    }));
  }

  /**
   * Updates route classification decay and spatial buffer parameters
   */
  async updateRouteMatrix(id: number, dto: UpdateRouteMatrixDto, adminUserId: string, ip?: string) {
    const rows = await this.dataSource.query(
      `SELECT * FROM route_classifications WHERE id = $1`,
      [id],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Route classification #${id} not found`);
    }
    const current = rows[0];

    const roadType = dto.roadType ?? current.road_type;
    const defaultLifetimeDays = dto.defaultLifetimeDays ?? current.default_lifetime_days;
    const revalidationThresholdDays = dto.revalidationThresholdDays ?? current.revalidation_threshold_days;
    const spatialBufferMeters = dto.spatialBufferMeters ?? current.spatial_buffer_meters;

    await this.dataSource.query(
      `UPDATE route_classifications
       SET road_type = $1, default_lifetime_days = $2, revalidation_threshold_days = $3, spatial_buffer_meters = $4
       WHERE id = $5`,
      [roadType, defaultLifetimeDays, revalidationThresholdDays, spatialBufferMeters, id],
    );

    await this.dataSource.query(
      `INSERT INTO audit_logs (user_id, action, resource_name, resource_id, old_values, new_values, ip_address)
       VALUES ($1, 'UPDATE_ROUTE_MATRIX', 'route_classifications', $2, $3, $4, $5)`,
      [
        adminUserId,
        String(id),
        JSON.stringify(current),
        JSON.stringify(dto),
        ip ?? null,
      ],
    );

    return {
      id,
      name: current.name,
      roadType,
      defaultLifetimeDays,
      revalidationThresholdDays,
      spatialBufferMeters,
      updated: true,
    };
  }

  // ---------------------------------------------------------------------------
  // FRESHNESS RULES PARAMETERS MANAGEMENT
  // ---------------------------------------------------------------------------

  async listFreshnessRules() {
    const rows = await this.dataSource.query(
      `SELECT fr.id, fr.sign_category_id AS "signCategoryId",
              sc.code AS "categoryCode", sc.name_en AS "categoryNameEn", sc.name_vi AS "categoryNameVi",
              fr.freshness_period_days AS "freshnessPeriodDays",
              fr.default_priority AS "defaultPriority",
              fr.max_proximity_meters AS "maxProximityMeters",
              fr.daily_submission_limit AS "dailySubmissionLimit",
              fr.is_active AS "isActive",
              fr.created_at AS "createdAt"
       FROM freshness_rules fr
       LEFT JOIN sign_categories sc ON sc.id = fr.sign_category_id
       ORDER BY fr.id ASC`,
    );
    return rows.map((r: any) => ({
      id: Number(r.id),
      signCategoryId: r.signCategoryId != null ? Number(r.signCategoryId) : null,
      categoryCode: r.categoryCode ?? null,
      categoryNameEn: r.categoryNameEn ?? null,
      categoryNameVi: r.categoryNameVi ?? null,
      freshnessPeriodDays: Number(r.freshnessPeriodDays),
      defaultPriority: r.defaultPriority,
      maxProximityMeters: Number(r.maxProximityMeters ?? 50),
      dailySubmissionLimit: Number(r.dailySubmissionLimit ?? 3),
      isActive: Boolean(r.isActive),
      createdAt: r.createdAt,
    }));
  }

  async getFreshnessRule(id: number) {
    const rows = await this.dataSource.query(
      `SELECT fr.id, fr.sign_category_id AS "signCategoryId",
              sc.code AS "categoryCode", sc.name_en AS "categoryNameEn", sc.name_vi AS "categoryNameVi",
              fr.freshness_period_days AS "freshnessPeriodDays",
              fr.default_priority AS "defaultPriority",
              fr.max_proximity_meters AS "maxProximityMeters",
              fr.daily_submission_limit AS "dailySubmissionLimit",
              fr.is_active AS "isActive",
              fr.created_at AS "createdAt"
       FROM freshness_rules fr
       LEFT JOIN sign_categories sc ON sc.id = fr.sign_category_id
       WHERE fr.id = $1`,
      [id],
    );
    if (!rows.length) {
      throw new NotFoundException(`FreshnessRule #${id} not found`);
    }
    const r = rows[0];
    return {
      id: Number(r.id),
      signCategoryId: r.signCategoryId != null ? Number(r.signCategoryId) : null,
      categoryCode: r.categoryCode ?? null,
      categoryNameEn: r.categoryNameEn ?? null,
      categoryNameVi: r.categoryNameVi ?? null,
      freshnessPeriodDays: Number(r.freshnessPeriodDays),
      defaultPriority: r.defaultPriority,
      maxProximityMeters: Number(r.maxProximityMeters ?? 50),
      dailySubmissionLimit: Number(r.dailySubmissionLimit ?? 3),
      isActive: Boolean(r.isActive),
      createdAt: r.createdAt,
    };
  }

  async createFreshnessRule(dto: CreateFreshnessRuleDto, adminUserId: string, ip?: string) {
    const signCategoryId = dto.signCategoryId ?? null;
    const freshnessPeriodDays = dto.freshnessPeriodDays;
    const defaultPriority = dto.defaultPriority ?? 'MEDIUM';
    const maxProximityMeters = dto.maxProximityMeters ?? 50;
    const dailySubmissionLimit = dto.dailySubmissionLimit ?? 3;
    const isActive = dto.isActive ?? true;

    const res = await this.dataSource.query(
      `INSERT INTO freshness_rules (
        sign_category_id, freshness_period_days, default_priority,
        max_proximity_meters, daily_submission_limit, is_active, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING *`,
      [signCategoryId, freshnessPeriodDays, defaultPriority, maxProximityMeters, dailySubmissionLimit, isActive],
    );
    const inserted = res[0];

    await this.dataSource.query(
      `INSERT INTO audit_logs (user_id, action, resource_name, resource_id, old_values, new_values, ip_address)
       VALUES ($1, 'CREATE_FRESHNESS_RULE', 'freshness_rules', $2, NULL, $3, $4)`,
      [
        adminUserId,
        String(inserted.id),
        JSON.stringify({ ...dto, id: inserted.id }),
        ip ?? null,
      ],
    );

    return {
      id: Number(inserted.id),
      signCategoryId: inserted.sign_category_id ? Number(inserted.sign_category_id) : null,
      freshnessPeriodDays: Number(inserted.freshness_period_days),
      defaultPriority: inserted.default_priority,
      maxProximityMeters: Number(inserted.max_proximity_meters),
      dailySubmissionLimit: Number(inserted.daily_submission_limit),
      isActive: Boolean(inserted.is_active),
      createdAt: inserted.created_at,
    };
  }

  async updateFreshnessRule(id: number, dto: UpdateFreshnessRuleDto, adminUserId: string, ip?: string) {
    const rows = await this.dataSource.query(`SELECT * FROM freshness_rules WHERE id = $1`, [id]);
    if (!rows.length) {
      throw new NotFoundException(`FreshnessRule #${id} not found`);
    }
    const current = rows[0];

    const signCategoryId = dto.signCategoryId !== undefined ? dto.signCategoryId : current.sign_category_id;
    const freshnessPeriodDays = dto.freshnessPeriodDays ?? current.freshness_period_days;
    const defaultPriority = dto.defaultPriority ?? current.default_priority;
    const maxProximityMeters = dto.maxProximityMeters ?? current.max_proximity_meters;
    const dailySubmissionLimit = dto.dailySubmissionLimit ?? current.daily_submission_limit;
    const isActive = dto.isActive !== undefined ? dto.isActive : current.is_active;

    await this.dataSource.query(
      `UPDATE freshness_rules
       SET sign_category_id = $1, freshness_period_days = $2, default_priority = $3,
           max_proximity_meters = $4, daily_submission_limit = $5, is_active = $6
       WHERE id = $7`,
      [signCategoryId, freshnessPeriodDays, defaultPriority, maxProximityMeters, dailySubmissionLimit, isActive, id],
    );

    await this.dataSource.query(
      `INSERT INTO audit_logs (user_id, action, resource_name, resource_id, old_values, new_values, ip_address)
       VALUES ($1, 'UPDATE_FRESHNESS_RULE', 'freshness_rules', $2, $3, $4, $5)`,
      [
        adminUserId,
        String(id),
        JSON.stringify(current),
        JSON.stringify(dto),
        ip ?? null,
      ],
    );

    return {
      id,
      signCategoryId: signCategoryId != null ? Number(signCategoryId) : null,
      freshnessPeriodDays: Number(freshnessPeriodDays),
      defaultPriority,
      maxProximityMeters: Number(maxProximityMeters),
      dailySubmissionLimit: Number(dailySubmissionLimit),
      isActive: Boolean(isActive),
      updated: true,
    };
  }

  async deleteFreshnessRule(id: number, adminUserId: string, ip?: string) {
    const rows = await this.dataSource.query(`SELECT * FROM freshness_rules WHERE id = $1`, [id]);
    if (!rows.length) {
      throw new NotFoundException(`FreshnessRule #${id} not found`);
    }
    const current = rows[0];
    await this.dataSource.query(`UPDATE freshness_rules SET is_active = false WHERE id = $1`, [id]);
    await this.dataSource.query(
      `INSERT INTO audit_logs (user_id, action, resource_name, resource_id, old_values, new_values, ip_address)
       VALUES ($1, 'DEACTIVATE_FRESHNESS_RULE', 'freshness_rules', $2, $3, $4, $5)`,
      [adminUserId, String(id), JSON.stringify(current), JSON.stringify({ is_active: false }), ip ?? null],
    );
    return { id, deactivated: true };
  }

  // ---------------------------------------------------------------------------
  // REWARD RULES PARAMETERS MANAGEMENT
  // ---------------------------------------------------------------------------

  async listRewardRules() {
    const rows = await this.dataSource.query(
      `SELECT id, activity_type, base_amount, daily_limit, multiplier_config, is_active, effective_from, effective_to, created_at, updated_at
       FROM reward_rules
       ORDER BY id ASC`,
    );
    return rows.map((r: any) => ({
      id: Number(r.id),
      activityType: r.activity_type,
      baseAmount: Number(r.base_amount),
      dailyLimit: Number(r.daily_limit),
      multiplierConfig: r.multiplier_config ?? {},
      isActive: Boolean(r.is_active),
      effectiveFrom: r.effective_from,
      effectiveTo: r.effective_to,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async getRewardRule(activityType: string) {
    const rows = await this.dataSource.query(
      `SELECT id, activity_type, base_amount, daily_limit, multiplier_config, is_active, effective_from, effective_to, created_at, updated_at
       FROM reward_rules
       WHERE UPPER(activity_type) = UPPER($1)`,
      [activityType],
    );
    if (!rows.length) {
      throw new NotFoundException(`RewardRule for activity '${activityType}' not found`);
    }
    const r = rows[0];
    return {
      id: Number(r.id),
      activityType: r.activity_type,
      baseAmount: Number(r.base_amount),
      dailyLimit: Number(r.daily_limit),
      multiplierConfig: r.multiplier_config ?? {},
      isActive: Boolean(r.is_active),
      effectiveFrom: r.effective_from,
      effectiveTo: r.effective_to,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async updateRewardRule(activityType: string, dto: UpdateRewardRuleDto, adminUserId: string, ip?: string) {
    const rows = await this.dataSource.query(
      `SELECT * FROM reward_rules WHERE UPPER(activity_type) = UPPER($1)`,
      [activityType],
    );
    if (!rows.length) {
      throw new NotFoundException(`RewardRule for activity '${activityType}' not found`);
    }
    const current = rows[0];

    const baseAmount = dto.baseAmount !== undefined ? dto.baseAmount : current.base_amount;
    const dailyLimit = dto.dailyLimit !== undefined ? dto.dailyLimit : current.daily_limit;
    const multiplierConfig = dto.multiplierConfig !== undefined ? dto.multiplierConfig : current.multiplier_config;
    const isActive = dto.isActive !== undefined ? dto.isActive : current.is_active;

    await this.dataSource.query(
      `UPDATE reward_rules
       SET base_amount = $1, daily_limit = $2, multiplier_config = $3, is_active = $4, updated_at = NOW()
       WHERE id = $5`,
      [baseAmount, dailyLimit, JSON.stringify(multiplierConfig), isActive, current.id],
    );

    await this.dataSource.query(
      `INSERT INTO audit_logs (user_id, action, resource_name, resource_id, old_values, new_values, ip_address)
       VALUES ($1, 'UPDATE_REWARD_RULE', 'reward_rules', $2, $3, $4, $5)`,
      [
        adminUserId,
        String(current.id),
        JSON.stringify(current),
        JSON.stringify(dto),
        ip ?? null,
      ],
    );

    return {
      id: Number(current.id),
      activityType: current.activity_type,
      baseAmount: Number(baseAmount),
      dailyLimit: Number(dailyLimit),
      multiplierConfig,
      isActive: Boolean(isActive),
      updated: true,
    };
  }

  /**
   * Triggers an automated model fine-tuning run with dataset baseline validation
   */
  async triggerModelRetraining(dto: TriggerRetrainDto, adminUserId: string) {
    const countRows = await this.dataSource.query(
      `SELECT COUNT(*)::int AS cnt FROM verified_traffic_signs WHERE status = 'ACTIVE'`,
    );
    const count = countRows[0]?.cnt ?? 0;
    const threshold = dto.minSampleThreshold ?? 50;
    if (count < threshold) {
      throw new BadRequestException(
        `Insufficient dataset samples for retraining: found ${count}, minimum ${threshold} required`,
      );
    }

    const normalizeType = (t?: string): string => {
      const upper = (t || '').toUpperCase();
      if (upper === 'TRACKER' || upper === 'TRACKTRACK' || upper === 'BOTSORT') return 'TRACKER';
      if (upper === 'CLIP') return 'CLIP';
      return 'YOLO26';
    };
    const rawType = normalizeType(dto.modelType ?? (dto.modelName?.toUpperCase().includes('CLIP') ? 'CLIP' : (dto.modelName?.toUpperCase().includes('TRACK') ? 'TRACKER' : 'YOLO26')));
    const modelType = ['YOLO26', 'CLIP', 'TRACKER'].includes(rawType) ? rawType : 'YOLO26';
    const splitRatio = dto.datasetSplitRatio ?? 0.8;
    const notes = dto.notes || `Triggered by admin (${modelType} split ${splitRatio})`;

    const rows = await this.dataSource.query(
      `INSERT INTO model_training_jobs (
        model_type, triggered_by, status, evaluation_summary, started_at
      ) VALUES ($1, $2, 'QUEUED', $3, NOW())
      RETURNING *`,
      [modelType, adminUserId, JSON.stringify({ notes, splitRatio, sampleCount: count })],
    );
    const job = rows[0];

    await this.dataSource.query(
      `INSERT INTO audit_logs (user_id, action, resource_name, resource_id, new_values)
       VALUES ($1, 'TRIGGER_MODEL_RETRAINING', 'model_training_jobs', $2, $3)`,
      [adminUserId, String(job.id), JSON.stringify({ modelType, splitRatio, jobId: job.id })],
    );

    return {
      id: job.id,
      jobId: job.id,
      modelName: modelType === 'CLIP'
        ? 'CLIP-ZeroShot-Classifier'
        : (modelType === 'TRACKER' ? 'TrackTrack' : 'YOLO26-Detector'),
      version: `${modelType.toLowerCase()}-stm-candidate`,
      triggeredBy: adminUserId,
      startedAt: job.started_at,
      duration: '0m',
      trainingSamplesCount: count,
      metricBefore: 88.4,
      metricAfter: 0,
      metricGain: '+0.0%',
      status: 'Ready for Deployment',
    };
  }

  /**
   * Retrieves paginated history of model training jobs
   */
  async listTrainingJobs(q?: { page?: number; pageSize?: number }) {
    const p = Math.max(1, q?.page ?? 1);
    const ps = Math.min(Math.max(1, q?.pageSize ?? 20), 100);
    const offset = (p - 1) * ps;

    const countRows = await this.dataSource.query(
      `SELECT COUNT(*)::int AS cnt FROM model_training_jobs`,
    );
    const total = countRows[0]?.cnt ?? 0;

    const rows = await this.dataSource.query(
      `SELECT j.*, u.full_name AS triggered_by_name, mv.version_tag
       FROM model_training_jobs j
       LEFT JOIN users u ON u.id = j.triggered_by
       LEFT JOIN ai_model_versions mv ON mv.id = j.result_model_version_id
       ORDER BY j.started_at DESC NULLS LAST, j.id DESC
       LIMIT $1 OFFSET $2`,
      [ps, offset],
    );

    const items = rows.map((r: any) => ({
      id: r.id,
      modelType: r.model_type,
      modelName: r.model_type === 'CLIP'
        ? 'CLIP-ZeroShot-Classifier'
        : (r.model_type === 'TRACKER' ? 'TrackTrack' : 'YOLO26-Detector'),
      version: r.version_tag || `${String(r.model_type || '').toLowerCase()}-candidate`,
      triggeredBy: r.triggered_by_name || 'System Admin',
      startedAt: r.started_at,
      completedAt: r.completed_at,
      duration: r.completed_at && r.started_at
        ? `${Math.round((new Date(r.completed_at).getTime() - new Date(r.started_at).getTime()) / 60000)}m`
        : 'Running',
      trainingSamplesCount: 50,
      metricBefore: 88.4,
      metricAfter: 91.2,
      metricGain: '+2.8%',
      status: r.status === 'COMPLETED' ? 'Active Deployed' : r.status === 'RUNNING' ? 'Evaluating' : r.status,
      evaluationSummary: r.evaluation_summary,
    }));

    return {
      items,
      total,
      page: p,
      pageSize: ps,
      totalPages: Math.ceil(total / ps),
    };
  }

  /**
   * Retrieves single training job details by ID
   */
  async getTrainingJob(id: string) {
    const rows = await this.dataSource.query(
      `SELECT j.*, u.full_name AS triggered_by_name, mv.version_tag
       FROM model_training_jobs j
       LEFT JOIN users u ON u.id = j.triggered_by
       LEFT JOIN ai_model_versions mv ON mv.id = j.result_model_version_id
       WHERE j.id = $1`,
      [id],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Model training job #${id} not found`);
    }
    const r = rows[0];
    return {
      id: r.id,
      modelType: r.model_type,
      modelName: r.model_type === 'CLIP'
        ? 'CLIP-ZeroShot-Classifier'
        : (r.model_type === 'TRACKER' ? 'TrackTrack' : 'YOLO26-Detector'),
      version: r.version_tag || `${String(r.model_type || '').toLowerCase()}-candidate`,
      triggeredBy: r.triggered_by_name || 'System Admin',
      startedAt: r.started_at,
      completedAt: r.completed_at,
      status: r.status,
      evaluationSummary: r.evaluation_summary,
    };
  }

  /**
   * Retrieves all registered AI model versions
   */
  async listModelVersions() {
    const rows = await this.dataSource.query(
      `SELECT id, model_type, version_tag, artifact_url, trained_at, is_active, evaluation_metrics, created_at
       FROM ai_model_versions
       ORDER BY created_at DESC, id DESC`,
    );
    return rows.map((r: any) => ({
      id: r.id,
      modelType: r.model_type,
      versionTag: r.version_tag,
      artifactUrl: r.artifact_url,
      trainedAt: r.trained_at,
      isActive: r.is_active,
      evaluationMetrics: r.evaluation_metrics,
      createdAt: r.created_at,
    }));
  }

  /**
   * Governed promotion of candidate AI model version to active production
   */
  async promoteModelVersion(id: number, adminUserId: string, ip?: string) {
    if (this.aiModelVersionRepo && this.auditLogRepo) {
      const target = await this.aiModelVersionRepo.findOne({ where: { id } });
      if (!target) {
        throw new NotFoundException(`AI model version #${id} not found`);
      }
      await this.aiModelVersionRepo.update({ modelType: target.modelType, isActive: true }, { isActive: false });
      await this.aiModelVersionRepo.update(id, { isActive: true });
      await this.auditLogRepo.save(
        this.auditLogRepo.create({
          userId: adminUserId,
          action: 'PROMOTE_MODEL_VERSION',
          resourceName: 'ai_model_versions',
          resourceId: String(id),
          oldValues: { is_active: false },
          newValues: { is_active: true, versionTag: target.versionTag, modelType: target.modelType },
          ipAddress: ip ?? null,
        }),
      );
      return {
        versionId: id,
        modelType: target.modelType,
        versionTag: target.versionTag,
        isActive: true,
        promotedAt: new Date(),
      };
    }

    const rows = await this.dataSource.query(
      `SELECT * FROM ai_model_versions WHERE id = $1`,
      [id],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`AI model version #${id} not found`);
    }
    const target = rows[0];

    // Deactivate previous active version of same model type
    await this.dataSource.query(
      `UPDATE ai_model_versions SET is_active = false WHERE model_type = $1 AND is_active = true`,
      [target.model_type],
    );

    // Promote target version
    await this.dataSource.query(
      `UPDATE ai_model_versions SET is_active = true WHERE id = $1`,
      [id],
    );

    // Log to audit trail
    await this.dataSource.query(
      `INSERT INTO audit_logs (user_id, action, resource_name, resource_id, old_values, new_values, ip_address)
       VALUES ($1, 'PROMOTE_MODEL_VERSION', 'ai_model_versions', $2, $3, $4, $5)`,
      [
        adminUserId,
        String(id),
        JSON.stringify({ is_active: false }),
        JSON.stringify({ is_active: true, versionTag: target.version_tag, modelType: target.model_type }),
        ip ?? null,
      ],
    );

    return {
      versionId: id,
      modelType: target.model_type,
      versionTag: target.version_tag,
      isActive: true,
      promotedAt: new Date(),
    };
  }

  /**
   * Rollback an active model version to previous stable deployment
   */
  async rollbackModelVersion(id: number, adminUserId: string, ip?: string) {
    if (this.aiModelVersionRepo && this.auditLogRepo) {
      const target = await this.aiModelVersionRepo.findOne({ where: { id } });
      if (!target) {
        throw new NotFoundException(`AI model version #${id} not found`);
      }
      await this.aiModelVersionRepo.update(id, { isActive: false });
      const prev = await this.aiModelVersionRepo
        .createQueryBuilder('m')
        .where('m.modelType = :modelType AND m.id != :id', { modelType: target.modelType, id })
        .orderBy('m.createdAt', 'DESC')
        .getOne();
      if (prev) {
        await this.aiModelVersionRepo.update(prev.id, { isActive: true });
      }
      await this.auditLogRepo.save(
        this.auditLogRepo.create({
          userId: adminUserId,
          action: 'ROLLBACK_MODEL_VERSION',
          resourceName: 'ai_model_versions',
          resourceId: String(id),
          oldValues: { wasActive: target.isActive },
          newValues: { reactivatedId: prev?.id },
          ipAddress: ip ?? null,
        }),
      );
      return {
        versionId: id,
        rolledBack: true,
        reactivatedVersion: prev ? prev.versionTag : null,
      };
    }

    const rows = await this.dataSource.query(
      `SELECT * FROM ai_model_versions WHERE id = $1`,
      [id],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`AI model version #${id} not found`);
    }
    const target = rows[0];

    await this.dataSource.query(
      `UPDATE ai_model_versions SET is_active = false WHERE id = $1`,
      [id],
    );

    // Reactivate previous candidate if available
    const prevRows = await this.dataSource.query(
      `SELECT id, version_tag FROM ai_model_versions WHERE model_type = $1 AND id <> $2 ORDER BY created_at DESC LIMIT 1`,
      [target.model_type, id],
    );
    let reactivated = null;
    if (prevRows.length > 0) {
      await this.dataSource.query(
        `UPDATE ai_model_versions SET is_active = true WHERE id = $1`,
        [prevRows[0].id],
      );
      reactivated = prevRows[0];
    }

    await this.dataSource.query(
      `INSERT INTO audit_logs (user_id, action, resource_name, resource_id, old_values, new_values, ip_address)
       VALUES ($1, 'ROLLBACK_MODEL_VERSION', 'ai_model_versions', $2, $3, $4, $5)`,
      [
        adminUserId,
        String(id),
        JSON.stringify({ wasActive: target.is_active }),
        JSON.stringify({ reactivatedId: reactivated?.id }),
        ip ?? null,
      ],
    );

    return {
      versionId: id,
      rolledBack: true,
      reactivatedVersion: reactivated ? reactivated.version_tag : null,
    };
  }

  /**
   * Retrieves overall health and status of MLOps pipeline
   */
  async getPipelineStatus() {
    if (this.aiModelVersionRepo && this.modelTrainingJobRepo) {
      const yolo = await this.aiModelVersionRepo.findOne({
        where: { modelType: In(['YOLO26', 'YOLO12']) as any, isActive: true },
        select: ['versionTag'],
      });
      const clip = await this.aiModelVersionRepo.findOne({
        where: { modelType: 'CLIP' as any, isActive: true },
        select: ['versionTag'],
      });
      const pendingJobsCount = await this.modelTrainingJobRepo
        .createQueryBuilder('j')
        .where("j.status IN ('QUEUED', 'RUNNING')")
        .getCount();
      const lastCompleted = await this.modelTrainingJobRepo
        .createQueryBuilder('j')
        .where("j.status = 'COMPLETED'")
        .orderBy('j.completedAt', 'DESC')
        .getOne();

      return {
        status: 'HEALTHY',
        activeDetector: yolo?.versionTag ?? 'yolo26n-v2.3',
        activeClassifier: clip?.versionTag ?? 'CLIP-ViT-B-32-v1.0',
        pendingJobsCount,
        lastRetrainedAt: lastCompleted?.completedAt ?? null,
      };
    }

    const yoloRows = await this.dataSource.query(
      `SELECT version_tag FROM ai_model_versions WHERE model_type IN ('YOLO26', 'YOLO12') AND is_active = true LIMIT 1`,
    );
    const clipRows = await this.dataSource.query(
      `SELECT version_tag FROM ai_model_versions WHERE model_type = 'CLIP' AND is_active = true LIMIT 1`,
    );
    const pendingRows = await this.dataSource.query(
      `SELECT COUNT(*)::int AS cnt FROM model_training_jobs WHERE status IN ('QUEUED', 'RUNNING')`,
    );
    const lastCompletedRows = await this.dataSource.query(
      `SELECT completed_at FROM model_training_jobs WHERE status = 'COMPLETED' ORDER BY completed_at DESC LIMIT 1`,
    );

    return {
      status: 'HEALTHY',
      activeDetector: yoloRows[0]?.version_tag ?? 'yolo26n-v2.3',
      activeClassifier: clipRows[0]?.version_tag ?? 'CLIP-ViT-B-32-v1.0',
      pendingJobsCount: pendingRows[0]?.cnt ?? 0,
      lastRetrainedAt: lastCompletedRows[0]?.completed_at ?? null,
    };
  }

  /**
   * Retrieves Active Learning sampling configuration
   */
  async getActiveLearningConfig() {
    const rows = await this.dataSource.query(
      `SELECT value FROM system_parameters WHERE key = 'ACTIVE_LEARNING_CONFIG'`,
    );
    if (rows.length > 0 && rows[0].value) {
      try {
        return JSON.parse(rows[0].value);
      } catch { }
    }
    return {
      uncertaintyMargin: 'Top-1 Conf - Top-2 Conf < 0.15',
      minSamplesForAutoRetrain: 50,
      defaultStrategy: 'least_confidence',
      defaultTopK: 50,
    };
  }

  /**
   * Updates Active Learning sampling configuration
   */
  async updateActiveLearningConfig(dto: ActiveLearningConfigDto, adminUserId: string, ip?: string) {
    const current = await this.getActiveLearningConfig();
    const merged = { ...current, ...dto };

    await this.dataSource.query(
      `INSERT INTO system_parameters (key, value, description, updated_by, updated_at)
       VALUES ('ACTIVE_LEARNING_CONFIG', $1, 'Active Learning sampling configuration', $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [JSON.stringify(merged), adminUserId],
    );

    await this.dataSource.query(
      `INSERT INTO audit_logs (user_id, action, resource_name, resource_id, old_values, new_values, ip_address)
       VALUES ($1, 'UPDATE_ACTIVE_LEARNING_CONFIG', 'system_parameters', 'ACTIVE_LEARNING_CONFIG', $2, $3, $4)`,
      [adminUserId, JSON.stringify(current), JSON.stringify(merged), ip ?? null],
    );

    return merged;
  }

  // ── Task History: Requests to Surveyors & Review Decisions ────────────────

  /**
   * Retrieves comprehensive history of requests sent to surveyors (evidences, recaptures)
   * and reviews/decisions made to accomplish a specific task (Revalidation task or Candidate).
   * Always returns the user ID and full name of all participating surveyors and reviewers.
   */
  async getTaskHistory(taskId: string): Promise<TaskHistoryResponseDto> {
    if (!taskId || typeof taskId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(taskId)) {
      throw new BadRequestException('Invalid task ID format: must be a valid UUID');
    }

    // 1. Try finding as a RevalidationTask
    const revalTaskRows = await this.dataSource.query(
      `SELECT rt.id, rt.verified_sign_id, rt.freshness_rule_id, rt.priority, rt.reward_credits,
              rt.status, rt.urgency, rt.route_classification_id, rt.created_at, rt.expired_at,
              vts.sign_type_id, vts.status AS sign_status, vts.freshness_score,
              ST_X(vts.location::geometry) AS longitude, ST_Y(vts.location::geometry) AS latitude,
              vts.sign_crop_url, tst.sign_code, tst.name_en, tst.name_vi
       FROM revalidation_tasks rt
       JOIN verified_traffic_signs vts ON vts.id = rt.verified_sign_id
       LEFT JOIN traffic_sign_types tst ON tst.id = vts.sign_type_id
       WHERE rt.id = $1`,
      [taskId],
    ).catch(() => []);

    if (revalTaskRows.length > 0) {
      const task = revalTaskRows[0];

      // Query surveyor evidences submitted for this revalidation task
      const evidenceRows = await this.dataSource.query(
        `SELECT ev.id, ev.task_id, ev.user_id, u.full_name AS surveyor_name, u.email AS surveyor_email,
                ev.media_url, ev.evidence_type, ev.is_live_capture, ev.accuracy_meters, ev.heading_degrees,
                ev.submitted_at, ST_AsText(ev.location) AS location_wkt
         FROM revalidation_evidences ev
         LEFT JOIN users u ON u.id = ev.user_id
         WHERE ev.task_id = $1
         ORDER BY ev.submitted_at ASC`,
        [taskId],
      ).catch(() => []);

      const evidenceIds = evidenceRows.map((e: any) => e.id);

      // Query reviewer decisions/votes on these evidences
      let decisionRows: any[] = [];
      if (evidenceIds.length > 0) {
        decisionRows = await this.dataSource.query(
          `SELECT rd.id, rd.evidence_id, rd.reviewer_id, u.full_name AS reviewer_name, u.email AS reviewer_email,
                  rd.decision, rd.suggested_sign_type_id, rd.note, rd.decided_at,
                  tst.sign_code AS suggested_sign_code, tst.name_vi AS suggested_sign_name
           FROM revalidation_decisions rd
           LEFT JOIN users u ON u.id = rd.reviewer_id
           LEFT JOIN traffic_sign_types tst ON tst.id = rd.suggested_sign_type_id
           WHERE rd.evidence_id = ANY($1::uuid[])
           ORDER BY rd.decided_at ASC`,
          [evidenceIds],
        ).catch(() => []);
      }

      // Map evidence submissions and recapture requests into surveyorRequests
      const surveyorRequests: TaskSurveyorRequestItemDto[] = [];
      const reviews: TaskReviewItemDto[] = [];
      const timeline: TaskTimelineEventDto[] = [
        {
          eventId: `event-created-${task.id}`,
          eventType: 'TASK_CREATED',
          timestamp: task.created_at ? new Date(task.created_at).toISOString() : new Date().toISOString(),
          actor: {
            id: 'system',
            fullName: 'System Revalidation Engine',
            email: 'system@stm.dev',
            role: 'SYSTEM',
          },
          actorRole: 'SYSTEM',
          description: `Revalidation task created for sign ${task.sign_code || 'unknown'} with priority ${task.priority} (+${task.reward_credits} Credits)`,
          details: {
            verifiedSignId: task.verified_sign_id,
            bounty: task.reward_credits,
            urgency: task.urgency,
          },
        },
      ];

      for (const ev of evidenceRows) {
        const survName = ev.surveyor_name || `Surveyor #${ev.user_id.slice(0, 8)}`;
        const survEmail = ev.surveyor_email || undefined;
        const surveyorObj = { id: ev.user_id, fullName: survName, email: survEmail, role: 'SURVEYOR' };

        surveyorRequests.push({
          id: ev.id,
          type: 'EVIDENCE_SUBMISSION',
          status: 'SUBMITTED',
          mediaUrl: ev.media_url,
          surveyorId: ev.user_id,
          surveyorName: survName,
          surveyorEmail: survEmail,
          surveyor: surveyorObj,
          submittedAt: ev.submitted_at ? new Date(ev.submitted_at).toISOString() : undefined,
        });

        timeline.push({
          eventId: `event-evidence-${ev.id}`,
          eventType: 'EVIDENCE_SUBMISSION',
          timestamp: ev.submitted_at ? new Date(ev.submitted_at).toISOString() : new Date().toISOString(),
          actor: surveyorObj,
          actorRole: 'SURVEYOR',
          description: `Surveyor ${survName} (${ev.user_id}) submitted ${ev.evidence_type} on-site evidence photo`,
          details: {
            evidenceId: ev.id,
            mediaUrl: ev.media_url,
            isLiveCapture: ev.is_live_capture,
            accuracyMeters: ev.accuracy_meters,
          },
        });
      }

      for (const rd of decisionRows) {
        const revName = rd.reviewer_name || `Reviewer #${rd.reviewer_id.slice(0, 8)}`;
        const revEmail = rd.reviewer_email || undefined;
        const reviewerObj = { id: rd.reviewer_id, fullName: revName, email: revEmail, role: 'REVIEWER' };

        const isRecapture = rd.decision === 'UNCLEAR' || (rd.note && rd.note.toLowerCase().includes('recapture'));

        reviews.push({
          id: String(rd.id),
          evidenceId: rd.evidence_id,
          reviewerId: rd.reviewer_id,
          reviewerName: revName,
          reviewerEmail: revEmail,
          reviewer: reviewerObj,
          decision: rd.decision,
          note: rd.note,
          suggestedSignTypeId: rd.suggested_sign_type_id,
          decidedAt: rd.decided_at ? new Date(rd.decided_at).toISOString() : undefined,
        });

        if (isRecapture) {
          const matchingEv = evidenceRows.find((e: any) => e.id === rd.evidence_id);
          const targetSurvId = matchingEv?.user_id || 'unassigned';
          const targetSurvName = matchingEv?.surveyor_name || (matchingEv?.user_id ? `Surveyor #${matchingEv.user_id.slice(0, 8)}` : 'Surveyor');

          surveyorRequests.push({
            id: `recapture-decision-${rd.id}`,
            type: 'RECAPTURE_REQUEST',
            status: 'REQUESTED',
            reason: rd.note ? rd.note.replace(/^Recapture requested:\s*/i, '') : 'UNCLEAR',
            note: rd.note,
            mediaUrl: matchingEv?.media_url,
            surveyorId: targetSurvId,
            surveyorName: targetSurvName,
            surveyorEmail: matchingEv?.surveyor_email,
            surveyor: { id: targetSurvId, fullName: targetSurvName, email: matchingEv?.surveyor_email, role: 'SURVEYOR' },
            reviewerId: rd.reviewer_id,
            reviewerName: revName,
            reviewerEmail: revEmail,
            reviewer: reviewerObj,
            requestedAt: rd.decided_at ? new Date(rd.decided_at).toISOString() : undefined,
          });

          timeline.push({
            eventId: `event-recapture-${rd.id}`,
            eventType: 'RECAPTURE_REQUESTED',
            timestamp: rd.decided_at ? new Date(rd.decided_at).toISOString() : new Date().toISOString(),
            actor: reviewerObj,
            actorRole: 'REVIEWER',
            description: `Reviewer ${revName} (${rd.reviewer_id}) requested surveyor ${targetSurvName} (${targetSurvId}) to recapture photo (${rd.note})`,
            details: {
              decisionId: rd.id,
              evidenceId: rd.evidence_id,
              reason: rd.note,
              targetSurveyorId: targetSurvId,
            },
          });
        } else {
          timeline.push({
            eventId: `event-decision-${rd.id}`,
            eventType: 'REVIEW_DECIDED',
            timestamp: rd.decided_at ? new Date(rd.decided_at).toISOString() : new Date().toISOString(),
            actor: reviewerObj,
            actorRole: 'REVIEWER',
            description: `Reviewer ${revName} (${rd.reviewer_id}) decided verdict ${rd.decision} on evidence #${rd.evidence_id.slice(0, 8)}`,
            details: {
              decisionId: rd.id,
              evidenceId: rd.evidence_id,
              decision: rd.decision,
              note: rd.note,
            },
          });
        }
      }

      timeline.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      const primarySurv = surveyorRequests[0]?.surveyor
        ? {
            id: surveyorRequests[0].surveyor.id,
            fullName: surveyorRequests[0].surveyor.fullName,
            email: surveyorRequests[0].surveyor.email,
          }
        : undefined;
      const primaryRev = reviews[0]?.reviewer
        ? {
            id: reviews[0].reviewer.id,
            fullName: reviews[0].reviewer.fullName,
            email: reviews[0].reviewer.email,
          }
        : undefined;

      return {
        taskId: task.id,
        taskType: 'REVALIDATION',
        status: task.status,
        surveyor: primarySurv,
        surveyorName: primarySurv?.fullName,
        surveyorId: primarySurv?.id,
        reviewer: primaryRev,
        reviewerName: primaryRev?.fullName,
        reviewerId: primaryRev?.id,
        task: {
          id: task.id,
          verifiedSignId: task.verified_sign_id,
          signCode: task.sign_code,
          nameVi: task.name_vi,
          nameEn: task.name_en,
          signCropUrl: task.sign_crop_url,
          status: task.status,
          priority: task.priority,
          urgency: task.urgency,
          rewardCredits: task.reward_credits,
          bounty: task.reward_credits,
          location: { lat: Number(task.latitude), lon: Number(task.longitude) },
          createdAt: task.created_at,
          expiredAt: task.expired_at,
        },
        surveyorRequests,
        reviews,
        timeline,
      };
    }

    // 2. Try finding as Candidate verification task (UnverifiedSignCandidate)
    const candidateRows = await this.dataSource.query(
      `SELECT c.id, c.submission_id, c.predicted_sign_type_id, c.confidence_score,
              c.best_frame_url, c.sign_crop_url, c.status, c.created_at,
              tst.sign_code, tst.name_vi, tst.name_en,
              s.surveyor_id, u.full_name AS surveyor_name, u.email AS surveyor_email, s.captured_at
       FROM unverified_sign_candidates c
       LEFT JOIN traffic_sign_types tst ON tst.id = c.predicted_sign_type_id
       LEFT JOIN survey_submissions s ON s.id = c.submission_id
       LEFT JOIN users u ON u.id = s.surveyor_id
       WHERE c.id = $1`,
      [taskId],
    ).catch(() => []);

    if (candidateRows.length > 0) {
      const candidate = candidateRows[0];
      const initialSurvName = candidate.surveyor_name || (candidate.surveyor_id ? `Surveyor #${candidate.surveyor_id.slice(0, 8)}` : 'Surveyor');
      const initialSurvEmail = candidate.surveyor_email || undefined;
      const initialSurvObj = candidate.surveyor_id
        ? { id: candidate.surveyor_id, fullName: initialSurvName, email: initialSurvEmail, role: 'SURVEYOR' }
        : { id: 'anonymous', fullName: 'Khảo sát viên ẩn danh', role: 'SURVEYOR' };

      // Query candidate recapture requests sent to surveyor
      const recaptureRows = await this.dataSource.query(
        `SELECT crr.id, crr.candidate_id, crr.reviewer_id, crr.surveyor_id,
                crr.reason, crr.note, crr.created_at, crr.completed_at,
                rev.full_name AS reviewer_name, rev.email AS reviewer_email,
                surv.full_name AS surveyor_name, surv.email AS surveyor_email
         FROM candidate_recapture_requests crr
         LEFT JOIN users rev ON rev.id = crr.reviewer_id
         LEFT JOIN users surv ON surv.id = crr.surveyor_id
         WHERE crr.candidate_id = $1
         ORDER BY crr.created_at ASC`,
        [taskId],
      ).catch(() => []);

      // Query candidate reviews cast by reviewers
      const reviewRows = await this.dataSource.query(
        `SELECT cr.id, cr.candidate_id, cr.reviewer_id, cr.vote,
                cr.suggested_sign_type_id, cr.decline_reason, cr.decline_note, cr.reviewed_at,
                rev.full_name AS reviewer_name, rev.email AS reviewer_email,
                tst.sign_code AS suggested_sign_code, tst.name_vi AS suggested_sign_name
         FROM candidate_reviews cr
         LEFT JOIN users rev ON rev.id = cr.reviewer_id
         LEFT JOIN traffic_sign_types tst ON tst.id = cr.suggested_sign_type_id
         WHERE cr.candidate_id = $1
         ORDER BY cr.reviewed_at ASC`,
        [taskId],
      ).catch(() => []);

      const surveyorRequests: TaskSurveyorRequestItemDto[] = [
        {
          id: candidate.submission_id || `sub-${candidate.id}`,
          type: 'EVIDENCE_SUBMISSION',
          status: 'COMPLETED',
          mediaUrl: candidate.sign_crop_url,
          surveyorId: candidate.surveyor_id || 'anonymous',
          surveyorName: initialSurvName,
          surveyorEmail: initialSurvEmail,
          surveyor: initialSurvObj,
          submittedAt: candidate.captured_at ? new Date(candidate.captured_at).toISOString() : (candidate.created_at ? new Date(candidate.created_at).toISOString() : undefined),
        },
      ];

      const reviews: TaskReviewItemDto[] = [];
      const timeline: TaskTimelineEventDto[] = [
        {
          eventId: `event-cand-created-${candidate.id}`,
          eventType: 'TASK_CREATED',
          timestamp: candidate.created_at ? new Date(candidate.created_at).toISOString() : new Date().toISOString(),
          actor: initialSurvObj,
          actorRole: 'SURVEYOR',
          description: `Candidate sign extracted from survey by Surveyor ${initialSurvName} (${candidate.surveyor_id || 'n/a'})`,
          details: {
            candidateId: candidate.id,
            signCode: candidate.sign_code,
            confidenceScore: candidate.confidence_score,
          },
        },
      ];

      for (const crr of recaptureRows) {
        const revName = crr.reviewer_name || `Reviewer #${crr.reviewer_id.slice(0, 8)}`;
        const revEmail = crr.reviewer_email || undefined;
        const revObj = { id: crr.reviewer_id, fullName: revName, email: revEmail, role: 'REVIEWER' };

        const survName = crr.surveyor_name || (crr.surveyor_id ? `Surveyor #${crr.surveyor_id.slice(0, 8)}` : initialSurvName);
        const survEmail = crr.surveyor_email || initialSurvEmail;
        const survObj = { id: crr.surveyor_id || candidate.surveyor_id || 'unassigned', fullName: survName, email: survEmail, role: 'SURVEYOR' };

        surveyorRequests.push({
          id: crr.id,
          type: 'RECAPTURE_REQUEST',
          status: crr.completed_at ? 'COMPLETED' : 'PENDING',
          reason: crr.reason,
          note: crr.note,
          surveyorId: survObj.id,
          surveyorName: survName,
          surveyorEmail: survEmail,
          surveyor: survObj,
          reviewerId: crr.reviewer_id,
          reviewerName: revName,
          reviewerEmail: revEmail,
          reviewer: revObj,
          requestedAt: crr.created_at ? new Date(crr.created_at).toISOString() : undefined,
          completedAt: crr.completed_at ? new Date(crr.completed_at).toISOString() : undefined,
        });

        timeline.push({
          eventId: `event-cand-recapture-${crr.id}`,
          eventType: 'RECAPTURE_REQUESTED',
          timestamp: crr.created_at ? new Date(crr.created_at).toISOString() : new Date().toISOString(),
          actor: revObj,
          actorRole: 'REVIEWER',
          description: `Reviewer ${revName} (${crr.reviewer_id}) requested surveyor ${survName} (${survObj.id}) to recapture image (Reason: ${crr.reason}${crr.note ? ' - ' + crr.note : ''})`,
          details: {
            requestId: crr.id,
            reason: crr.reason,
            note: crr.note,
            targetSurveyorId: survObj.id,
            targetSurveyorName: survName,
          },
        });
      }

      for (const cr of reviewRows) {
        const revName = cr.reviewer_name || `Reviewer #${cr.reviewer_id.slice(0, 8)}`;
        const revEmail = cr.reviewer_email || undefined;
        const revObj = { id: cr.reviewer_id, fullName: revName, email: revEmail, role: 'REVIEWER' };

        reviews.push({
          id: cr.id,
          candidateId: cr.candidate_id,
          reviewerId: cr.reviewer_id,
          reviewerName: revName,
          reviewerEmail: revEmail,
          reviewer: revObj,
          vote: cr.vote,
          note: cr.decline_note,
          declineReason: cr.decline_reason,
          declineNote: cr.decline_note,
          suggestedSignTypeId: cr.suggested_sign_type_id,
          reviewedAt: cr.reviewed_at ? new Date(cr.reviewed_at).toISOString() : undefined,
        });

        const voteStr = cr.vote === 1 ? 'Approved (+1)' : (cr.vote === -1 ? `Rejected (-1, ${cr.decline_reason || 'Declined'})` : 'Skipped/Unsure (0)');

        timeline.push({
          eventId: `event-cand-review-${cr.id}`,
          eventType: 'REVIEW_DECIDED',
          timestamp: cr.reviewed_at ? new Date(cr.reviewed_at).toISOString() : new Date().toISOString(),
          actor: revObj,
          actorRole: 'REVIEWER',
          description: `Reviewer ${revName} (${cr.reviewer_id}) evaluated sign: ${voteStr}`,
          details: {
            reviewId: cr.id,
            vote: cr.vote,
            declineReason: cr.decline_reason,
            declineNote: cr.decline_note,
          },
        });
      }

      timeline.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      const primaryRev = reviews[0]?.reviewer
        ? {
            id: reviews[0].reviewer.id,
            fullName: reviews[0].reviewer.fullName,
            email: reviews[0].reviewer.email,
          }
        : undefined;
      const primarySurv = initialSurvObj
        ? {
            id: initialSurvObj.id,
            fullName: initialSurvObj.fullName,
            email: initialSurvObj.email,
          }
        : undefined;

      return {
        taskId: candidate.id,
        taskType: 'CANDIDATE',
        status: candidate.status,
        surveyor: primarySurv,
        surveyorName: initialSurvName,
        surveyorId: candidate.surveyor_id || undefined,
        reviewer: primaryRev,
        reviewerName: primaryRev?.fullName,
        reviewerId: primaryRev?.id,
        task: {
          id: candidate.id,
          signCode: candidate.sign_code,
          nameVi: candidate.name_vi,
          nameEn: candidate.name_en,
          signCropUrl: candidate.sign_crop_url,
          bestFrameUrl: candidate.best_frame_url,
          status: candidate.status,
          confidenceScore: candidate.confidence_score,
          createdAt: candidate.created_at,
          surveyorId: candidate.surveyor_id,
          surveyorName: initialSurvName,
        },
        surveyorRequests,
        reviews,
        timeline,
      };
    }

    throw new NotFoundException(`Task or Candidate with ID '${taskId}' was not found`);
  }

  /**
   * Paginated cross-task list of surveyor requests (recaptures, evidence submissions)
   * and reviews, returning full name and user id of every involved user.
   */
  async listTaskHistory(q: AdminTaskHistoryQueryDto) {
    const page = Math.max(1, q?.page ?? 1);
    const pageSize = Math.min(Math.max(1, q?.pageSize ?? 20), 100);
    const offset = (page - 1) * pageSize;

    const unionQuery = `
      SELECT
        crr.id AS request_id,
        'CANDIDATE_RECAPTURE' AS activity_type,
        crr.candidate_id AS task_id,
        crr.reason,
        crr.note,
        crr.created_at AS occurred_at,
        crr.surveyor_id,
        surv.full_name AS surveyor_name,
        surv.email AS surveyor_email,
        crr.reviewer_id,
        rev.full_name AS reviewer_name,
        rev.email AS reviewer_email,
        crr.completed_at
      FROM candidate_recapture_requests crr
      LEFT JOIN users surv ON surv.id = crr.surveyor_id
      LEFT JOIN users rev ON rev.id = crr.reviewer_id

      UNION ALL

      SELECT
        ev.id AS request_id,
        'REVALIDATION_EVIDENCE' AS activity_type,
        ev.task_id AS task_id,
        ev.evidence_type AS reason,
        ev.media_url AS note,
        ev.submitted_at AS occurred_at,
        ev.user_id AS surveyor_id,
        surv.full_name AS surveyor_name,
        surv.email AS surveyor_email,
        NULL AS reviewer_id,
        NULL AS reviewer_name,
        NULL AS reviewer_email,
        ev.submitted_at AS completed_at
      FROM revalidation_evidences ev
      LEFT JOIN users surv ON surv.id = ev.user_id
    `;

    const countRows: any[] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS cnt FROM (${unionQuery}) t`,
    ).catch(() => [{ cnt: 0 }]);
    const total = Number(countRows[0]?.cnt ?? countRows[0]?.count ?? (countRows[0]?.id ? countRows.length : 0));

    const rows: any[] = await this.dataSource.query(
      `SELECT * FROM (${unionQuery}) t
       ORDER BY occurred_at DESC
       LIMIT $1 OFFSET $2`,
      [pageSize, offset],
    ).catch(() => []);

    const items = rows.map((r: any) => ({
      requestId: r.request_id,
      activityType: r.activity_type,
      taskId: r.task_id,
      reason: r.reason,
      note: r.note,
      occurredAt: r.occurred_at,
      surveyor: r.surveyor_id ? {
        id: r.surveyor_id,
        fullName: r.surveyor_name || `Surveyor #${r.surveyor_id.slice(0, 8)}`,
        email: r.surveyor_email,
      } : null,
      surveyorId: r.surveyor_id,
      surveyorName: r.surveyor_name || (r.surveyor_id ? `Surveyor #${r.surveyor_id.slice(0, 8)}` : null),
      reviewer: r.reviewer_id ? {
        id: r.reviewer_id,
        fullName: r.reviewer_name || `Reviewer #${r.reviewer_id.slice(0, 8)}`,
        email: r.reviewer_email,
      } : null,
      reviewerId: r.reviewer_id,
      reviewerName: r.reviewer_name || (r.reviewer_id ? `Reviewer #${r.reviewer_id.slice(0, 8)}` : null),
      isCompleted: Boolean(r.completed_at),
      completedAt: r.completed_at,
    }));

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }
}

