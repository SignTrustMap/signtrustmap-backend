import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Optional,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import {
  ReviewerQuestClaim,
  QuestTargetType,
  QuestClaimStatus,
} from '../infrastructure/persistence/reviewer-quest-claim.entity';
import { UnverifiedSignCandidate, CandidateStatus } from '../../survey/infrastructure/persistence/unverified-sign-candidate.entity';
import { CandidateGeoEstimation } from '../../survey/infrastructure/persistence/candidate-geo-estimation.entity';
import { SurveySubmission } from '../../survey/infrastructure/persistence/survey-submission.entity';
import { RevalidationTask, TaskStatus } from '../../revalidation/infrastructure/persistence/revalidation-task.entity';
import { VerifiedSignOrmEntity } from '../../sign-map/infrastructure/persistence/verified-sign.orm-entity';
import { TrafficSignType } from '../../catalog/traffic-sign-type.entity';
import { SignCategory } from '../../catalog/sign-category.entity';
import { ReviewerProfile } from '../infrastructure/persistence/reviewer-profile.entity';
import { SystemParametersService } from '../../system-parameters/system-parameters.service';
import { SpatialAdminService } from '../../spatial-admin/application/spatial-admin.service';
import { ClaimQuestDto, QueryAvailableQuestsDto, QueryMyClaimsDto } from '../presentation/dto/bounty-board.dto';

@Injectable()
export class BountyBoardService {
  private readonly logger = new Logger(BountyBoardService.name);

  constructor(
    @InjectRepository(ReviewerQuestClaim)
    private readonly questRepo: Repository<ReviewerQuestClaim>,
    @InjectRepository(UnverifiedSignCandidate)
    private readonly candidateRepo: Repository<UnverifiedSignCandidate>,
    @InjectRepository(RevalidationTask)
    private readonly taskRepo: Repository<RevalidationTask>,
    @InjectRepository(ReviewerProfile)
    private readonly profileRepo: Repository<ReviewerProfile>,
    private readonly paramService: SystemParametersService,
    private readonly dataSource: DataSource,
    @Optional() private readonly spatialAdminService?: SpatialAdminService,
  ) {}

  /**
   * List available bounty quests (candidates and revalidation tasks) within proximity
   */
  async getAvailableQuests(userId: string, query: QueryAvailableQuestsDto) {
    const defaultRadiusKm = await this.paramService.getNumber('reviewer.promotion_nearby_radius_km', 10.0);
    const radiusKm = query.radiusKm ?? defaultRadiusKm;
    const radiusMeters = radiusKm * 1000;
    const escalationEnabled = await this.paramService.getBoolean('reviewer.bounty_escalation_enabled', true);
    const escalationMultiplier = await this.paramService.getNumber('reviewer.bounty_escalation_multiplier', 0.5);

    const hasCoords = query.latitude != null && query.longitude != null;

    const quests: any[] = [];

    // 1. Fetch available sign candidates
    if (!query.targetType || query.targetType === QuestTargetType.CANDIDATE_VALIDATION) {
      let candidateSql = `
        SELECT 
          c.id,
          c.submission_id,
          c.sign_crop_url,
          c.best_frame_url,
          c.confidence_score,
          c.spatial_confidence,
          c.bounty_credits,
          c.votes_count,
          c.is_promoted,
          t.id AS sign_type_id,
          t.sign_code AS sign_code,
          t.name_vi AS sign_name,
          COALESCE(ST_Y(cge.sign_location::geometry), ST_Y(cge.vehicle_location::geometry)) AS latitude,
          COALESCE(ST_X(cge.sign_location::geometry), ST_X(cge.vehicle_location::geometry)) AS longitude
          ${hasCoords ? `, ST_DistanceSphere(ST_SetSRID(ST_MakePoint($1, $2), 4326), cge.sign_location) AS distance_meters` : ''}
        FROM unverified_sign_candidates c
        LEFT JOIN traffic_sign_types t ON c.predicted_sign_type_id = t.id
        LEFT JOIN candidate_geo_estimations cge ON c.id = cge.candidate_id
        LEFT JOIN survey_submissions s ON c.submission_id = s.id
        WHERE c.status IN ('PENDING_REVIEW', 'IN_CONSENSUS')
          AND (s.surveyor_id IS NULL OR s.surveyor_id != $${hasCoords ? 3 : 1})
          AND NOT EXISTS (
            SELECT 1 FROM candidate_reviews cr 
            WHERE cr.candidate_id = c.id AND cr.reviewer_id = $${hasCoords ? 3 : 1}
          )
          AND NOT EXISTS (
            SELECT 1 FROM reviewer_quest_claims rqc 
            WHERE rqc.target_id = c.id 
              AND rqc.target_type = 'CANDIDATE_VALIDATION' 
              AND rqc.status = 'CLAIMED' 
              AND rqc.expires_at > NOW()
          )
      `;

      const params: any[] = hasCoords ? [query.longitude, query.latitude, userId] : [userId];

      if (hasCoords) {
        candidateSql += ` AND cge.sign_location IS NOT NULL AND ST_DistanceSphere(ST_SetSRID(ST_MakePoint($1, $2), 4326), cge.sign_location) <= $4 ORDER BY distance_meters ASC LIMIT 50`;
        params.push(radiusMeters);
      } else {
        candidateSql += ` ORDER BY c.is_promoted DESC, c.created_at DESC LIMIT 50`;
      }

      // eslint-disable-next-line no-restricted-syntax -- approved-raw-sql: legacy query pending ORM refactoring
      const candidateRows: any[] = await this.dataSource.query(candidateSql, params);

      for (const row of candidateRows) {
        const baseReward = row.bounty_credits || 10;
        const n = row.votes_count || 0;
        let escalatedBonus = 0;
        if (escalationEnabled && n > 0 && n < 3) {
          escalatedBonus = Math.floor(n * escalationMultiplier * baseReward);
        }

        quests.push({
          targetType: QuestTargetType.CANDIDATE_VALIDATION,
          targetId: row.id,
          title: row.sign_name ? `Verify ${row.sign_name} (${row.sign_code})` : 'Verify Traffic Sign Candidate',
          signCode: row.sign_code,
          signName: row.sign_name,
          signCropUrl: row.sign_crop_url,
          bestFrameUrl: row.best_frame_url,
          roadName: null,
          displayAddress: null,
          latitude: this.toFiniteNumber(row.latitude),
          longitude: this.toFiniteNumber(row.longitude),
          distanceMeters: this.toFiniteNumber(row.distance_meters),
          votesCount: n,
          isPromoted: row.is_promoted,
          baseRewardCredits: baseReward,
          escalatedBonusCredits: escalatedBonus,
          totalRewardCredits: baseReward + escalatedBonus,
        });
      }
    }

    // 2. Fetch available revalidation tasks
    if (!query.targetType || query.targetType === QuestTargetType.REVALIDATION_TASK) {
      const taskUserParamIdx = hasCoords ? 3 : 1;
      let taskSql = `
        SELECT 
          rt.id,
          rt.reward_credits,
          rt.priority,
          rt.votes_count,
          rt.is_promoted,
          v.id AS verified_sign_id,
          v.sign_crop_url,
          v.road_name,
          v.display_address,
          t.sign_code AS sign_code,
          t.name_vi AS sign_name,
          ST_Y(v.location) AS latitude,
          ST_X(v.location) AS longitude
          ${hasCoords ? `, ST_DistanceSphere(ST_SetSRID(ST_MakePoint($1, $2), 4326), v.location) AS distance_meters` : ''}
        FROM revalidation_tasks rt
        JOIN verified_traffic_signs v ON rt.verified_sign_id = v.id
        LEFT JOIN traffic_sign_types t ON v.sign_type_id = t.id
        WHERE rt.status IN ('OPEN', 'EVALUATING')
          AND EXISTS (
            SELECT 1 FROM revalidation_evidences ev
            WHERE ev.task_id = rt.id
              AND (ev.user_id IS NULL OR ev.user_id != $${taskUserParamIdx})
              AND NOT EXISTS (
                SELECT 1 FROM revalidation_decisions rd
                WHERE rd.evidence_id = ev.id AND rd.reviewer_id = $${taskUserParamIdx}
              )
          )
          AND NOT EXISTS (
            SELECT 1 FROM reviewer_quest_claims rqc 
            WHERE rqc.target_id = rt.id 
              AND rqc.target_type = 'REVALIDATION_TASK' 
              AND rqc.status = 'CLAIMED' 
              AND rqc.expires_at > NOW()
          )
      `;

      const taskParams: any[] = hasCoords ? [query.longitude, query.latitude, userId] : [userId];

      if (hasCoords) {
        taskSql += ` AND v.location IS NOT NULL AND ST_DistanceSphere(ST_SetSRID(ST_MakePoint($1, $2), 4326), v.location) <= $4 ORDER BY distance_meters ASC LIMIT 50`;
        taskParams.push(radiusMeters);
      } else {
        taskSql += ` ORDER BY rt.urgency DESC, rt.created_at DESC LIMIT 50`;
      }

      // eslint-disable-next-line no-restricted-syntax -- approved-raw-sql: legacy query pending ORM refactoring
      const taskRows: any[] = await this.dataSource.query(taskSql, taskParams);

      for (const row of taskRows) {
        quests.push({
          targetType: QuestTargetType.REVALIDATION_TASK,
          targetId: row.id,
          title: `Revalidate Sign: ${row.sign_name || row.sign_code || 'Traffic Sign'}`,
          signCode: row.sign_code,
          signName: row.sign_name,
          signCropUrl: row.sign_crop_url,
          roadName: row.road_name ?? null,
          displayAddress: row.display_address ?? null,
          latitude: this.toFiniteNumber(row.latitude),
          longitude: this.toFiniteNumber(row.longitude),
          distanceMeters: this.toFiniteNumber(row.distance_meters),
          votesCount: Number(row.votes_count ?? 0),
          isPromoted: Boolean(row.is_promoted ?? false),
          baseRewardCredits: row.reward_credits || 10,
          escalatedBonusCredits: 0,
          totalRewardCredits: row.reward_credits || 10,
        });
      }
    }

    await this.populateMissingAddresses(quests, false);

    return quests;
  }

  /**
   * List active and historical quest claims for the current user,
   * enriched with target sign, location, image, and reward details.
   */
  async getMyClaims(userId: string, query?: QueryMyClaimsDto) {
    const where: Record<string, any> = { reviewerId: userId };
    if (query?.status) {
      where.status = query.status;
    }
    if (query?.targetType) {
      where.targetType = query.targetType;
    }

    const claims = await this.questRepo.find({
      where,
      order: { claimedAt: 'DESC' },
    });

    if (claims.length === 0) {
      return [];
    }

    const candidateIds = Array.from(
      new Set(
        claims
          .filter((c) => c.targetType === QuestTargetType.CANDIDATE_VALIDATION)
          .map((c) => c.targetId),
      ),
    );
    const taskIds = Array.from(
      new Set(
        claims
          .filter((c) => c.targetType === QuestTargetType.REVALIDATION_TASK)
          .map((c) => c.targetId),
      ),
    );

    const [candidateMap, taskMap] = await Promise.all([
      this.fetchCandidateClaimMetadata(candidateIds),
      this.fetchRevalidationClaimMetadata(taskIds),
    ]);

    const nowMs = Date.now();
    const userLat = query?.latitude;
    const userLon = query?.longitude;
    const hasUserCoords = userLat != null && userLon != null;

    const enriched = claims.map((claim) => {
      const targetMeta =
        claim.targetType === QuestTargetType.CANDIDATE_VALIDATION
          ? candidateMap.get(claim.targetId) ?? null
          : taskMap.get(claim.targetId) ?? null;

      return this.buildEnrichedClaim(claim, targetMeta, nowMs, hasUserCoords ? { lat: userLat, lon: userLon } : null);
    });

    await this.populateMissingAddresses(enriched);
    return enriched;
  }

  private async fetchCandidateClaimMetadata(candidateIds: string[]): Promise<Map<string, any>> {
    const map = new Map<string, any>();
    if (candidateIds.length === 0 || typeof this.candidateRepo.createQueryBuilder !== 'function') {
      return map;
    }

    try {
      const rows = await this.candidateRepo
        .createQueryBuilder('c')
        .leftJoin(TrafficSignType, 't', 't.id = COALESCE(c.selected_sign_type_id, c.predicted_sign_type_id)')
        .leftJoin(SignCategory, 'sc', 'sc.id = t.categoryId')
        .leftJoin(CandidateGeoEstimation, 'cge', 'cge.candidateId = c.id')
        .leftJoin(SurveySubmission, 's', 's.id = c.submissionId')
        .select([
          'c.id AS id',
          'c.submissionId AS submission_id',
          'c.signCropUrl AS sign_crop_url',
          'c.bestFrameUrl AS best_frame_url',
          'c.confidenceScore AS confidence_score',
          'c.spatialConfidence AS spatial_confidence',
          'c.status AS target_status',
          'c.votesCount AS votes_count',
          'c.isPromoted AS is_promoted',
          'COALESCE(c.selected_sign_type_id, c.predicted_sign_type_id) AS sign_type_id',
          't.signCode AS sign_code',
          't.nameVi AS sign_name',
          't.nameEn AS sign_name_en',
          'sc.code AS category_code',
          'sc.nameVi AS category_name',
          'sc.nameEn AS category_name_en',
          'COALESCE(ST_Y(cge.sign_location::geometry), ST_Y(cge.vehicle_location::geometry)) AS latitude',
          'COALESCE(ST_X(cge.sign_location::geometry), ST_X(cge.vehicle_location::geometry)) AS longitude',
          'cge.estimatedDistance AS estimated_distance_meters',
          'cge.bearingAngle AS bearing_angle',
          'cge.trafficDirection AS traffic_direction',
          's.note AS submission_note',
        ])
        .where('c.id IN (:...candidateIds)', { candidateIds })
        .getRawMany();

      for (const row of rows) {
        let lat = this.toFiniteNumber(row.latitude);
        let lon = this.toFiniteNumber(row.longitude);
        if ((lat == null || lon == null) && row.submission_note) {
          const parsed = this.parseNoteGps(row.submission_note);
          if (parsed) {
            lat = parsed.lat;
            lon = parsed.lon;
          }
        }
        map.set(row.id, {
          ...row,
          latitude: lat,
          longitude: lon,
        });
      }
    } catch (err: any) {
      this.logger.warn(`Failed to enrich candidate claims: ${err?.message}`);
    }

    return map;
  }

  private async fetchRevalidationClaimMetadata(taskIds: string[]): Promise<Map<string, any>> {
    const map = new Map<string, any>();
    if (taskIds.length === 0 || typeof this.taskRepo.createQueryBuilder !== 'function') {
      return map;
    }

    try {
      const rows = await this.taskRepo
        .createQueryBuilder('rt')
        .leftJoin(VerifiedSignOrmEntity, 'v', 'v.id = rt.verifiedSignId')
        .leftJoin(TrafficSignType, 't', 't.id = v.signTypeId')
        .leftJoin(SignCategory, 'sc', 'sc.id = t.categoryId')
        .select([
          'rt.id AS id',
          'rt.verifiedSignId AS verified_sign_id',
          'rt.priority AS priority',
          'rt.status AS target_status',
          'rt.urgency AS urgency',
          'rt.votesCount AS votes_count',
          'rt.isPromoted AS is_promoted',
          'rt.expiredAt AS task_expired_at',
          'v.signTypeId AS sign_type_id',
          'v.signCropUrl AS sign_crop_url',
          'v.roadName AS road_name',
          'v.displayAddress AS display_address',
          'v.freshnessScore AS freshness_score',
          'v.status AS sign_status',
          'v.lastVerifiedAt AS last_verified_at',
          'v.trafficDirection AS traffic_direction',
          't.signCode AS sign_code',
          't.nameVi AS sign_name',
          't.nameEn AS sign_name_en',
          'sc.code AS category_code',
          'sc.nameVi AS category_name',
          'sc.nameEn AS category_name_en',
          'ST_Y(v.location::geometry) AS latitude',
          'ST_X(v.location::geometry) AS longitude',
        ])
        .where('rt.id IN (:...taskIds)', { taskIds })
        .getRawMany();

      for (const row of rows) {
        map.set(row.id, {
          ...row,
          latitude: this.toFiniteNumber(row.latitude),
          longitude: this.toFiniteNumber(row.longitude),
        });
      }
    } catch (err: any) {
      this.logger.warn(`Failed to enrich revalidation claims: ${err?.message}`);
    }

    return map;
  }

  private buildEnrichedClaim(
    claim: ReviewerQuestClaim,
    meta: any | null,
    nowMs: number,
    userCoords: { lat: number; lon: number } | null,
  ) {
    const expiresAtMs = claim.expiresAt ? new Date(claim.expiresAt).getTime() : 0;
    const isExpired =
      claim.status === QuestClaimStatus.EXPIRED ||
      (claim.status === QuestClaimStatus.CLAIMED && expiresAtMs > 0 && expiresAtMs <= nowMs);
    const remainingSeconds =
      claim.status === QuestClaimStatus.CLAIMED && expiresAtMs > nowMs
        ? Math.floor((expiresAtMs - nowMs) / 1000)
        : 0;

    const baseRewardCredits = claim.baseRewardCredits ?? 0;
    const escalatedBonusCredits = claim.escalatedBonusCredits ?? 0;
    const totalRewardCredits = baseRewardCredits + escalatedBonusCredits;

    const signCode = meta?.sign_code ?? null;
    const signName = meta?.sign_name ?? null;
    const isCandidate = claim.targetType === QuestTargetType.CANDIDATE_VALIDATION;
    const title = isCandidate
      ? signName
        ? `Verify ${signName}${signCode ? ` (${signCode})` : ''}`
        : 'Verify Traffic Sign Candidate'
      : `Revalidate Sign: ${signName || signCode || 'Traffic Sign'}`;

    const latitude = meta?.latitude ?? null;
    const longitude = meta?.longitude ?? null;
    const distanceMeters =
      userCoords && latitude != null && longitude != null
        ? this.computeHaversineMeters(userCoords.lat, userCoords.lon, latitude, longitude)
        : null;

    return {
      ...claim,
      title,
      totalRewardCredits,
      remainingSeconds,
      isExpired,
      signTypeId: this.toFiniteNumber(meta?.sign_type_id),
      signCode,
      signName,
      signNameEn: meta?.sign_name_en ?? null,
      categoryCode: meta?.category_code ?? null,
      categoryName: meta?.category_name ?? null,
      categoryNameEn: meta?.category_name_en ?? null,
      signCropUrl: meta?.sign_crop_url ?? null,
      bestFrameUrl: meta?.best_frame_url ?? null,
      latitude,
      longitude,
      distanceMeters,
      roadName: meta?.road_name ?? null,
      displayAddress: meta?.display_address ?? null,
      targetStatus: meta?.target_status ?? null,
      votesCount: Number(meta?.votes_count ?? 0),
      isPromoted: Boolean(meta?.is_promoted ?? false),
      submissionId: meta?.submission_id ?? null,
      confidenceScore: this.toFiniteNumber(meta?.confidence_score),
      spatialConfidence: meta?.spatial_confidence ?? null,
      estimatedDistanceMeters: this.toFiniteNumber(meta?.estimated_distance_meters),
      bearingAngle: this.toFiniteNumber(meta?.bearing_angle),
      trafficDirection: this.toFiniteNumber(meta?.traffic_direction),
      verifiedSignId: meta?.verified_sign_id ?? null,
      priority: meta?.priority ?? null,
      urgency: this.toFiniteNumber(meta?.urgency),
      freshnessScore: this.toFiniteNumber(meta?.freshness_score),
      signStatus: meta?.sign_status ?? null,
      lastVerifiedAt: meta?.last_verified_at ?? null,
      taskExpiredAt: meta?.task_expired_at ?? null,
    };
  }

  private async populateMissingAddresses(items: any[], onlyClaimed = true): Promise<void> {
    if (!this.spatialAdminService) {
      return;
    }

    const maxTargets = onlyClaimed ? 20 : 50;
    const targets = items
      .filter(
        (item) =>
          (!onlyClaimed || item.status === QuestClaimStatus.CLAIMED) &&
          !item.displayAddress &&
          item.latitude != null &&
          item.longitude != null,
      )
      .slice(0, maxTargets);

    if (targets.length === 0) {
      return;
    }

    await Promise.allSettled(
      targets.map(async (item) => {
        try {
          const resolved = await this.spatialAdminService!.resolveLocation(item.latitude, item.longitude);
          if (resolved?.displayAddress) {
            item.displayAddress = resolved.displayAddress;
          }
          if (!item.roadName && resolved?.roadName) {
            item.roadName = resolved.roadName;
          }
        } catch (err: any) {
          this.logger.warn(`Failed to resolve address for claim ${item.id}: ${err?.message}`);
        }
      }),
    );
  }

  private parseNoteGps(note: string): { lat: number; lon: number } | null {
    const match = String(note).match(/GPS:\s*([-\d.]+),\s*([-\d.]+)/);
    if (!match) {
      return null;
    }
    const lat = parseFloat(match[1]);
    const lon = parseFloat(match[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return null;
    }
    return { lat, lon };
  }

  private toFiniteNumber(value: unknown): number | null {
    if (value == null || value === '') {
      return null;
    }
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  private computeHaversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const R = 6371000;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c * 10) / 10;
  }

  /**
   * Claim an on-site verification quest
   */
  async claimQuest(userId: string, dto: ClaimQuestDto): Promise<ReviewerQuestClaim> {
    // Check reviewer suspension status
    const profile = await this.profileRepo.findOne({ where: { userId } });
    if (profile?.isReviewSuspended) {
      if (profile.suspendedUntil && new Date() > new Date(profile.suspendedUntil)) {
        await this.profileRepo.update(
          { userId },
          { isReviewSuspended: false, consecutiveErrors: 0, suspendedUntil: null },
        );
      } else {
        throw new ForbiddenException('Review privileges are currently suspended due to accuracy policy.');
      }
    }

    // Check concurrent claim limit
    const maxActiveClaims = await this.paramService.getNumber('reviewer.max_active_claims_per_user', 3);
    const activeCount = await this.questRepo.count({
      where: {
        reviewerId: userId,
        status: QuestClaimStatus.CLAIMED,
      },
    });

    if (activeCount >= maxActiveClaims) {
      throw new BadRequestException(
        `Active quest claim limit reached. You can have at most ${maxActiveClaims} concurrent active claims.`,
      );
    }

    // Check if target is already claimed by anyone and still active
    const existingActiveClaim = await this.questRepo.findOne({
      where: {
        targetId: dto.targetId,
        targetType: dto.targetType,
        status: QuestClaimStatus.CLAIMED,
      },
    });

    if (existingActiveClaim && new Date(existingActiveClaim.expiresAt) > new Date()) {
      if (existingActiveClaim.reviewerId === userId) {
        throw new ConflictException('You have already claimed this verification quest.');
      }
      throw new ConflictException('This quest is currently claimed by another reviewer.');
    }

    let baseReward = 10;
    let escalatedBonus = 0;

    if (dto.targetType === QuestTargetType.CANDIDATE_VALIDATION) {
      const candidate = await this.candidateRepo.findOne({
        where: { id: dto.targetId },
        relations: ['submission'],
      });

      if (!candidate) {
        throw new NotFoundException(`Sign candidate '${dto.targetId}' not found.`);
      }

      if (
        candidate.status !== CandidateStatus.PENDING_REVIEW &&
        candidate.status !== CandidateStatus.IN_CONSENSUS
      ) {
        throw new BadRequestException(`Candidate is not eligible for review (status: ${candidate.status}).`);
      }

      if (candidate.submission?.surveyorId === userId) {
        throw new ForbiddenException('You cannot claim verification quests from your own survey submissions.');
      }

      baseReward = candidate.bountyCredits || 10;
      const n = candidate.votesCount || 0;
      const escalationEnabled = await this.paramService.getBoolean('reviewer.bounty_escalation_enabled', true);
      const escalationMultiplier = await this.paramService.getNumber('reviewer.bounty_escalation_multiplier', 0.5);

      if (escalationEnabled && n > 0 && n < 3) {
        escalatedBonus = Math.floor(n * escalationMultiplier * baseReward);
      }
    } else {
      const task = await this.taskRepo.findOne({ where: { id: dto.targetId } });
      if (!task) {
        throw new NotFoundException(`Revalidation task '${dto.targetId}' not found.`);
      }
      if (task.status !== TaskStatus.OPEN && task.status !== TaskStatus.EVALUATING) {
        throw new BadRequestException(`Revalidation task is not eligible for review (status: ${task.status}).`);
      }
      // eslint-disable-next-line no-restricted-syntax -- approved-raw-sql: legacy query pending ORM refactoring
      const eligibleEvidences: any[] = await this.dataSource.query(
        `SELECT ev.id
         FROM revalidation_evidences ev
         WHERE ev.task_id = $1
           AND (ev.user_id IS NULL OR ev.user_id != $2)
           AND NOT EXISTS (
             SELECT 1 FROM revalidation_decisions rd
             WHERE rd.evidence_id = ev.id AND rd.reviewer_id = $2
           )
         LIMIT 1`,
        [dto.targetId, userId],
      );
      if (!Array.isArray(eligibleEvidences) || eligibleEvidences.length === 0) {
        throw new BadRequestException(
          'Revalidation task has no eligible evidence available for you to review.',
        );
      }
      baseReward = task.rewardCredits || 10;
    }

    const timeLimitMinutes = await this.paramService.getNumber('reviewer.quest_time_limit_minutes', 120);
    const expiresAt = new Date(Date.now() + timeLimitMinutes * 60 * 1000);

    const claim = this.questRepo.create({
      reviewerId: userId,
      targetType: dto.targetType,
      targetId: dto.targetId,
      status: QuestClaimStatus.CLAIMED,
      timeLimitMinutes,
      claimedAt: new Date(),
      expiresAt,
      baseRewardCredits: baseReward,
      escalatedBonusCredits: escalatedBonus,
      penaltyApplied: false,
    });

    const saved = await this.questRepo.save(claim);
    this.logger.log(`User ${userId} claimed quest ${saved.id} for target ${dto.targetId} (expires in ${timeLimitMinutes}m).`);
    return saved;
  }

  /**
   * Voluntarily abandon an active quest claim
   */
  async abandonQuest(userId: string, claimId: string, reason?: string): Promise<ReviewerQuestClaim> {
    const claim = await this.questRepo.findOne({ where: { id: claimId, reviewerId: userId } });
    if (!claim) {
      throw new NotFoundException(`Quest claim '${claimId}' not found for user.`);
    }

    if (claim.status !== QuestClaimStatus.CLAIMED) {
      throw new BadRequestException(`Cannot abandon claim in status '${claim.status}'.`);
    }

    claim.status = QuestClaimStatus.ABANDONED;
    claim.penaltyNotes = reason || 'Abandoned voluntarily by reviewer.';
    return this.questRepo.save(claim);
  }

  /**
   * Expire a single quest claim immediately with timeout reputation deduction
   */
  async expireSingleClaim(claim: ReviewerQuestClaim): Promise<ReviewerQuestClaim> {
    const penaltyScore = await this.paramService.getNumber('reviewer.quest_timeout_penalty_score', 5.0);
    claim.status = QuestClaimStatus.EXPIRED;
    claim.penaltyApplied = true;
    claim.penaltyNotes = `Quest expired uncompleted after ${claim.timeLimitMinutes} minutes. Penalty: -${penaltyScore} score.`;
    const saved = await this.questRepo.save(claim);

    try {
      // eslint-disable-next-line no-restricted-syntax -- approved-raw-sql: legacy query pending ORM refactoring
      await this.dataSource.query(
        `UPDATE reviewer_profiles 
         SET reliability_score = GREATEST(0, reliability_score - $1),
             updated_at = NOW()
         WHERE user_id = $2`,
        [penaltyScore, claim.reviewerId],
      );
    } catch (err: any) {
      this.logger.warn(`Failed to penalize reviewer ${claim.reviewerId}: ${err?.message}`);
    }

    return saved;
  }

  /**
   * Automatic recurring background cron task to scan and expire stale quest claims every 5 minutes
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleCronExpireStaleClaims(): Promise<void> {
    try {
      const result = await this.expireStaleClaims();
      if (result.expiredCount > 0) {
        this.logger.log(`[Cron] Automatically expired ${result.expiredCount} stale quest claims.`);
      }
    } catch (err: any) {
      this.logger.error(`[Cron] Failed to process scheduled stale claim expiration: ${err?.message}`);
    }
  }

  /**
   * Expire stale unclaimed quests and penalize reliability score
   */
  async expireStaleClaims(): Promise<{ expiredCount: number }> {
    const penaltyScore = await this.paramService.getNumber('reviewer.quest_timeout_penalty_score', 5.0);

    const staleClaims = await this.questRepo
      .createQueryBuilder('c')
      .where('c.status = :status', { status: QuestClaimStatus.CLAIMED })
      .andWhere('c.expires_at < NOW()')
      .getMany();

    for (const claim of staleClaims) {
      claim.status = QuestClaimStatus.EXPIRED;
      claim.penaltyApplied = true;
      claim.penaltyNotes = `Quest expired uncompleted after ${claim.timeLimitMinutes} minutes. Penalty: -${penaltyScore} score.`;
      await this.questRepo.save(claim);

      // Deduct reputation penalty
      try {
        // eslint-disable-next-line no-restricted-syntax -- approved-raw-sql: legacy query pending ORM refactoring
        await this.dataSource.query(
          `UPDATE reviewer_profiles 
           SET reliability_score = GREATEST(0, reliability_score - $1),
               updated_at = NOW()
           WHERE user_id = $2`,
          [penaltyScore, claim.reviewerId],
        );
      } catch (err: any) {
        this.logger.warn(`Failed to penalize reviewer ${claim.reviewerId}: ${err?.message}`);
      }
    }

    if (staleClaims.length > 0) {
      this.logger.log(`Expired ${staleClaims.length} stale quest claims.`);
    }

    return { expiredCount: staleClaims.length };
  }
}
