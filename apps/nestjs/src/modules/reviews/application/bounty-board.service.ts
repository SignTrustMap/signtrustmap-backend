import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import {
  ReviewerQuestClaim,
  QuestTargetType,
  QuestClaimStatus,
} from '../infrastructure/persistence/reviewer-quest-claim.entity';
import { UnverifiedSignCandidate, CandidateStatus } from '../../survey/infrastructure/persistence/unverified-sign-candidate.entity';
import { RevalidationTask, TaskStatus } from '../../revalidation/infrastructure/persistence/revalidation-task.entity';
import { ReviewerProfile } from '../infrastructure/persistence/reviewer-profile.entity';
import { SystemParametersService } from '../../system-parameters/system-parameters.service';
import { ClaimQuestDto, QueryAvailableQuestsDto } from '../presentation/dto/bounty-board.dto';

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
          ST_Y(cge.sign_location) AS latitude,
          ST_X(cge.sign_location) AS longitude
          ${hasCoords ? `, ST_DistanceSphere(ST_SetSRID(ST_MakePoint($1, $2), 4326), cge.sign_location) AS distance_meters` : ''}
        FROM unverified_sign_candidates c
        LEFT JOIN traffic_sign_types t ON c.predicted_sign_type_id = t.id
        LEFT JOIN candidate_geo_estimations cge ON c.id = cge.candidate_id
        LEFT JOIN survey_submissions s ON c.submission_id = s.id
        WHERE c.status IN ('PENDING_REVIEW', 'IN_CONSENSUS')
          AND s.surveyor_id != $${hasCoords ? 3 : 1}
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
          latitude: row.latitude ? parseFloat(row.latitude) : null,
          longitude: row.longitude ? parseFloat(row.longitude) : null,
          distanceMeters: row.distance_meters ? parseFloat(row.distance_meters) : null,
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
      let taskSql = `
        SELECT 
          rt.id,
          rt.reward_credits,
          rt.priority,
          v.id AS verified_sign_id,
          v.sign_crop_url,
          v.display_address,
          t.sign_code AS sign_code,
          t.name_vi AS sign_name,
          ST_Y(v.location) AS latitude,
          ST_X(v.location) AS longitude
          ${hasCoords ? `, ST_DistanceSphere(ST_SetSRID(ST_MakePoint($1, $2), 4326), v.location) AS distance_meters` : ''}
        FROM revalidation_tasks rt
        JOIN verified_traffic_signs v ON rt.verified_sign_id = v.id
        LEFT JOIN traffic_sign_types t ON v.sign_type_id = t.id
        WHERE rt.status = 'OPEN'
          AND NOT EXISTS (
            SELECT 1 FROM reviewer_quest_claims rqc 
            WHERE rqc.target_id = rt.id 
              AND rqc.target_type = 'REVALIDATION_TASK' 
              AND rqc.status = 'CLAIMED' 
              AND rqc.expires_at > NOW()
          )
      `;

      const taskParams: any[] = hasCoords ? [query.longitude, query.latitude] : [];

      if (hasCoords) {
        taskSql += ` AND v.location IS NOT NULL AND ST_DistanceSphere(ST_SetSRID(ST_MakePoint($1, $2), 4326), v.location) <= $3 ORDER BY distance_meters ASC LIMIT 50`;
        taskParams.push(radiusMeters);
      } else {
        taskSql += ` ORDER BY rt.urgency DESC, rt.created_at DESC LIMIT 50`;
      }

      const taskRows: any[] = await this.dataSource.query(taskSql, taskParams);

      for (const row of taskRows) {
        quests.push({
          targetType: QuestTargetType.REVALIDATION_TASK,
          targetId: row.id,
          title: `Revalidate Sign: ${row.sign_name || row.sign_code || 'Traffic Sign'}`,
          signCode: row.sign_code,
          signName: row.sign_name,
          signCropUrl: row.sign_crop_url,
          displayAddress: row.display_address,
          latitude: row.latitude ? parseFloat(row.latitude) : null,
          longitude: row.longitude ? parseFloat(row.longitude) : null,
          distanceMeters: row.distance_meters ? parseFloat(row.distance_meters) : null,
          votesCount: 0,
          isPromoted: false,
          baseRewardCredits: row.reward_credits || 10,
          escalatedBonusCredits: 0,
          totalRewardCredits: row.reward_credits || 10,
        });
      }
    }

    return quests;
  }

  /**
   * List active and historical quest claims for the current user
   */
  async getMyClaims(userId: string) {
    return this.questRepo.find({
      where: { reviewerId: userId },
      order: { claimedAt: 'DESC' },
    });
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
      if (task.status !== TaskStatus.OPEN) {
        throw new BadRequestException(`Revalidation task is not open (status: ${task.status}).`);
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
