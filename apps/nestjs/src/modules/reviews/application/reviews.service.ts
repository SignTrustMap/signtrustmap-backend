import { ConflictException, Injectable, NotFoundException, BadRequestException, ForbiddenException, Optional, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID, createHash } from 'crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CandidateReview } from '../infrastructure/persistence/candidate-review.entity';
import {
  CandidateStatus,
  UnverifiedSignCandidate,
} from '../../survey/infrastructure/persistence/unverified-sign-candidate.entity';
import { TrafficSignType } from '../../catalog/traffic-sign-type.entity';
import { VoteDto, RequestRecaptureDto } from '../presentation/dto/vote.dto';
import { ConsensusService } from '../../consensus/application/consensus.service';
import { SpatialAdminService } from '../../spatial-admin/application/spatial-admin.service';
import { ReviewerSkippedCandidate } from '../infrastructure/persistence/reviewer-skipped-candidate.entity';
import { DailyTasksService } from '../../daily-tasks/daily-tasks.service';
import { CandidateRecaptureRequest } from '../infrastructure/persistence/candidate-recapture-request.entity';
import { NotificationsService } from '../../notifications/notifications.service';
import { MinioStorageService } from '../../../integrations/minio/minio-storage.service';
import { MediaFileType, MEDIA_SIZE_LIMITS } from '../../survey/domain/submission-contract';
import { validateFileSignature, decodeMedia } from '../../survey/domain/media-validator';
import { SIGN_REMEDIES, SignRemedy } from './sign-remedies.constants';

const RECAPTURE_GEOFENCE_METERS = 100;

function getAffectedRowCount(result: any): number {
  if (typeof result?.rowCount === 'number') return result.rowCount;
  if (Array.isArray(result) && typeof result[1] === 'number') return result[1];
  return 0;
}

@Injectable()
export class ReviewsService implements OnModuleInit {
  constructor(
    @InjectRepository(UnverifiedSignCandidate) private readonly candidateRepo: Repository<UnverifiedSignCandidate>,
    @InjectRepository(CandidateReview) private readonly reviewRepo: Repository<CandidateReview>,
    @InjectRepository(TrafficSignType) private readonly signTypeRepo: Repository<TrafficSignType>,
    private readonly consensusService: ConsensusService,
    @Optional() private readonly spatialAdminService?: SpatialAdminService,
    @Optional() @InjectRepository(ReviewerSkippedCandidate) private readonly skippedRepo?: Repository<ReviewerSkippedCandidate>,
    @Optional() private readonly dailyTasksService?: DailyTasksService,
    @Optional() @InjectRepository(CandidateRecaptureRequest) private readonly recaptureRepo?: Repository<CandidateRecaptureRequest>,
    @Optional() private readonly notificationsService?: NotificationsService,
    @Optional() private readonly dataSource?: DataSource,
    @Optional() private readonly storageService?: MinioStorageService,
  ) {}

  getSignRemedies(): readonly SignRemedy[] {
    return SIGN_REMEDIES;
  }

  async onModuleInit() {
    try {
      await (this.candidateRepo.manager as any).query(`
        CREATE TABLE IF NOT EXISTS reviewer_skipped_candidates (
          reviewer_id uuid NOT NULL,
          candidate_id uuid NOT NULL,
          skipped_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (reviewer_id, candidate_id)
        );
      `);
    } catch {}
  }

  async queue(reviewerId: string, page = 1, pageSize = 20, includeOwnSubmissions = false) {
    const safePage = Math.max(1, page); const safeSize = Math.min(Math.max(1, pageSize), 100);
    const allowSelfReview = includeOwnSubmissions || process.env.ALLOW_SELF_REVIEW === 'true';
    const query = this.candidateRepo.createQueryBuilder('candidate')
      .leftJoinAndSelect('candidate.predictedSignType', 'predictedSignType')
      .leftJoinAndSelect('candidate.submission', 'submission')
      .where('candidate.status IN (:...statuses)', {
        statuses: [CandidateStatus.PENDING_REVIEW, CandidateStatus.IN_CONSENSUS],
      });

    if (!allowSelfReview) {
      query.andWhere(
        '(submission.surveyor_id IS NULL OR submission.surveyor_id != :reviewerId)',
        { reviewerId },
      );
    }

    query.andWhere(
        `NOT EXISTS (
          SELECT 1 FROM candidate_reviews review
          WHERE review.candidate_id = candidate.id AND review.reviewer_id = :reviewerId
        )`,
        { reviewerId },
      )
      .andWhere(
        `NOT EXISTS (
          SELECT 1
          FROM moderation_cases moderation_case
          JOIN moderation_actions moderation_action
            ON moderation_action.case_id = moderation_case.id
          WHERE moderation_case.target_entity_type = 'candidate'
            AND moderation_case.target_entity_id = candidate.id
            AND moderation_action.action_type = 'REPORT_FROM_REVIEW'
            AND moderation_action.performed_by = :reviewerId
        )`,
        { reviewerId },
      )
      .andWhere(
        `NOT EXISTS (
          SELECT 1 FROM reviewer_skipped_candidates rsc
          WHERE rsc.candidate_id = candidate.id AND rsc.reviewer_id = :reviewerId
        )`,
        { reviewerId },
      )
      .orderBy('candidate.activeLearningPriority', 'DESC')
      .addOrderBy('candidate.createdAt', 'ASC')
      .skip((safePage - 1) * safeSize)
      .take(safeSize);
    const [items, total] = await query.getManyAndCount();
    return { items, total, page: safePage, pageSize: safeSize, totalPages: Math.ceil(total / safeSize) };
  }
  async vote(reviewerId: string, candidateId: string, dto: VoteDto, allowSelfReview = false) {
    const candidate = await this.candidateRepo.findOne({
      where: { id: candidateId },
      relations: ['submission'],
    });
    if (!candidate) throw new NotFoundException('Candidate ' + candidateId + ' not found');
    const canSelfReview = allowSelfReview || process.env.ALLOW_SELF_REVIEW === 'true';
    if (!canSelfReview && candidate.submission && candidate.submission.surveyorId === reviewerId) {
      throw new ForbiddenException('You cannot review sign candidates from your own survey submission');
    }

    // Phase 4 Governance Safeguard: check reviewer suspension status
    try {
      const rRows: any[] = await (this.candidateRepo.manager as any).query(
        'SELECT * FROM reviewer_profiles WHERE user_id = $1',
        [reviewerId],
      );
      if (rRows.length > 0) {
        const profile = rRows[0];
        if (profile.is_review_suspended) {
          if (profile.suspended_until && new Date() > new Date(profile.suspended_until)) {
            // 7-day cooldown expired: automatically lift suspension
            await (this.candidateRepo.manager as any).query(
              `UPDATE reviewer_profiles 
               SET is_review_suspended = FALSE, consecutive_errors = 0, suspended_until = NULL, suspension_reason = NULL, updated_at = NOW() 
               WHERE user_id = $1`,
              [reviewerId],
            );
          } else {
            const reason = profile.suspension_reason || 'REVIEW_PRIVILEGES_SUSPENDED';
            throw new ForbiddenException(`REVIEW_PRIVILEGES_SUSPENDED: ${reason}`);
          }
        }
      }
    } catch (e: any) {
      if (e instanceof ForbiddenException) throw e;
    }

    if (candidate.status !== CandidateStatus.PENDING_REVIEW && candidate.status !== CandidateStatus.IN_CONSENSUS) throw new BadRequestException('Candidate ' + candidateId + ' is not pending review (status=' + candidate.status + ')');
    const existing = await this.reviewRepo.findOne({ where: { candidateId, reviewerId } });
    if (existing) throw new ConflictException('You have already voted on this candidate');
    if (dto.suggestedSignTypeId != null) {
      const typeExists = await this.signTypeRepo.findOne({ where: { id: dto.suggestedSignTypeId } });
      if (!typeExists) throw new BadRequestException('suggestedSignTypeId ' + dto.suggestedSignTypeId + ' does not exist');
    }
    if (dto.vote === -1 && dto.declineReason && !['Poor Image Quality','Incorrect Location','Sign Not Found','Duplicate Submission','Other'].includes(dto.declineReason)) {
      // allow any string but warn -- not strict
    }
    const review: any = this.reviewRepo.create({
      candidateId, reviewerId, vote: dto.vote,
      suggestedSignTypeId: dto.suggestedSignTypeId ?? null,
      declineReason: (dto as any).declineReason ?? null,
      declineNote: (dto as any).declineNote ?? null,
    } as any);
    let saved: any;
    try { saved = await this.reviewRepo.save(review); } catch (err: any) {
      if (err?.code === '23505' || String(err?.message).includes('duplicate')) throw new ConflictException('You have already voted on this candidate');
      throw err;
    }
    // trigger consensus evaluation (fire-and-forget style but await to surface log if needed)
    let consensusLog = null;
    try { consensusLog = await this.consensusService.evaluate(candidateId); } catch (e) { /* consensus failure must not rollback the vote */ }

    // Advance daily task progress for review contribution
    if (this.dailyTasksService) {
      this.dailyTasksService.recordProgress(reviewerId, 'REVIEW', 1).catch(() => {});
    }

    return { review: saved, consensusLog };
  }

  async skipCandidate(reviewerId: string, candidateId: string) {
    const candidate = await this.candidateRepo.findOne({ where: { id: candidateId } });
    if (!candidate) throw new NotFoundException('Candidate ' + candidateId + ' not found');
    await (this.candidateRepo.manager as any).query(`
      CREATE TABLE IF NOT EXISTS reviewer_skipped_candidates (
        reviewer_id uuid NOT NULL,
        candidate_id uuid NOT NULL,
        skipped_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (reviewer_id, candidate_id)
      );
    `);
    await (this.candidateRepo.manager as any).query(
      `INSERT INTO reviewer_skipped_candidates (reviewer_id, candidate_id, skipped_at)
       VALUES ($1, $2, now())
       ON CONFLICT (reviewer_id, candidate_id) DO UPDATE SET skipped_at = now()`,
      [reviewerId, candidateId],
    );
    return { skipped: true, candidateId, reviewerId };
  }

  async getCandidateDetail(candidateId: string) {
    const candidate = await this.candidateRepo.findOne({ where: { id: candidateId }, relations: ['predictedSignType', 'submission'] });
    if (!candidate) throw new NotFoundException('Candidate ' + candidateId + ' not found');
    let submissionExtra: any = null;
    try {
      const rows: any[] = await (this.candidateRepo.manager as any).query(
        `SELECT s.surveyor_id, s.captured_at, s.submission_type, s.status AS submission_status, s.note
         FROM survey_submissions s WHERE s.id = $1`, [candidate.submissionId]);
      if (rows.length) submissionExtra = rows[0];
    } catch {}

    let voteCount = 0;
    try { voteCount = await this.reviewRepo.count({ where: { candidateId } }); } catch {}

    let locationContext: {
      coordinates: { latitude: number; longitude: number } | null;
      displayLocation: string;
      nearbyRoad: string | null;
      direction: number | null;
    } | null = null;

    try {
      let lat: number | null = null;
      let lon: number | null = null;
      let direction: number | null = null;

      const geoRows: any[] = await (this.candidateRepo.manager as any).query(
        `SELECT ST_X(sign_location::geometry) AS lon, ST_Y(sign_location::geometry) AS lat, traffic_direction
         FROM candidate_geo_estimations WHERE candidate_id = $1`,
        [candidateId],
      );
      if (geoRows.length > 0 && geoRows[0].lat != null && geoRows[0].lon != null) {
        lat = parseFloat(geoRows[0].lat);
        lon = parseFloat(geoRows[0].lon);
        direction = geoRows[0].traffic_direction != null ? Number(geoRows[0].traffic_direction) : null;
      } else if (submissionExtra?.note) {
        const m = String(submissionExtra.note).match(/GPS:\s*([-\d.]+),\s*([-\d.]+)/);
        if (m) {
          lat = parseFloat(m[1]);
          lon = parseFloat(m[2]);
        }
      }

      if (lat != null && lon != null) {
        let displayLocation = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
        let nearbyRoad: string | null = null;
        if (this.spatialAdminService) {
          try {
            const loc = await this.spatialAdminService.resolveLocation(lat, lon);
            if (loc?.displayAddress) displayLocation = loc.displayAddress;
            if (loc?.roadName) nearbyRoad = loc.roadName;
          } catch {}
        }
        locationContext = {
          coordinates: { latitude: lat, longitude: lon },
          displayLocation,
          nearbyRoad,
          direction,
        };
      }
    } catch {}

    return { candidate, submission: submissionExtra, voteCount, locationContext };
  }

  async getMyHistory(reviewerId: string, page = 1, pageSize = 20, status?: string, search?: string, surveyorId?: string) {
    const p = Math.max(1, page), ps = Math.min(Math.max(1, pageSize), 100);
    const qb = this.reviewRepo.createQueryBuilder('r')
      .leftJoinAndSelect('r.candidate', 'c')
      .leftJoinAndSelect('c.predictedSignType', 'pst')
      .leftJoinAndSelect('c.submission', 'sub')
      .where('r.reviewerId = :reviewerId', { reviewerId })
      .orderBy('r.reviewedAt', 'DESC')
      .skip((p - 1) * ps).take(ps);
    if (status === 'approved') qb.andWhere('r.vote = 1');
    else if (status === 'rejected') qb.andWhere('r.vote = -1');
    else if (status === 'unsure') qb.andWhere('r.vote = 0');
    if (surveyorId) qb.andWhere('sub.surveyorId = :surveyorId', { surveyorId });
    if (search) {
      qb.andWhere('(pst.nameEn ILIKE :s OR pst.nameVi ILIKE :s OR pst.signCode ILIKE :s)', { s: `%${search}%` });
    }
    const [items, total] = await qb.getManyAndCount();
    return { items, total, page: p, pageSize: ps, totalPages: Math.ceil(total / ps) };
  }

  async getMyStats(reviewerId: string) {
    let profile: any = null;
    try {
      const rows: any[] = await (this.candidateRepo.manager as any).query(
        'SELECT * FROM reviewer_profiles WHERE user_id = $1',
        [reviewerId],
      );
      if (rows.length) profile = rows[0];
    } catch {}

    const totalCorrect = profile ? Number(profile.total_correct_votes ?? profile.correct_reviews ?? 0) : 0;
    const totalFalse = profile ? Number(profile.total_false_votes ?? 0) : 0;
    const totalVotes = totalCorrect + totalFalse;
    const isProvisional = profile ? Boolean(profile.is_provisional ?? (totalVotes < 5)) : true;
    const isSuspended = profile ? Boolean(profile.is_review_suspended) : false;
    const consecutiveErrors = profile ? Number(profile.consecutive_errors ?? 0) : 0;

    let reliabilityScore = 100.0;
    if (profile && profile.reliability_score != null) {
      const raw = Number(profile.reliability_score);
      reliabilityScore = raw <= 1.0 && totalVotes > 0 ? Number((raw * 100).toFixed(2)) : Number(raw.toFixed(2));
    }

    const totalReviews = await this.reviewRepo.count({ where: { reviewerId } as any }).catch(() => 0);
    const approved = await this.reviewRepo.count({ where: { reviewerId, vote: 1 } as any }).catch(() => 0);
    const rejected = await this.reviewRepo.count({ where: { reviewerId, vote: -1 } as any }).catch(() => 0);
    let recentActivity: any = [];
    try {
      recentActivity = await this.reviewRepo.find({
        where: { reviewerId } as any,
        order: { reviewedAt: 'DESC' as any },
        take: 5,
      });
    } catch {}

    return {
      reviewerId,
      reliabilityScore,
      totalCorrect,
      totalFalse,
      isProvisional,
      isSuspended,
      consecutiveErrors,
      suspendedUntil: profile?.suspended_until ?? null,
      suspensionReason: profile?.suspension_reason ?? null,
      totalReviews,
      approved,
      rejected,
      accuracyRate: profile ? Number(profile.accuracy_rate ?? 0) : 0,
      currentStreak: profile ? Number(profile.current_streak ?? 0) : 0,
      profile,
      recentActivity,
    };
  }

  async undoVote(reviewerId: string, candidateId: string) {
    const existing = await this.reviewRepo.findOne({ where: { candidateId, reviewerId } });
    if (!existing) throw new NotFoundException('No vote found for candidate ' + candidateId);
    // Only allow undo while candidate still in review
    const candidate = await this.candidateRepo.findOne({ where: { id: candidateId } });
    if (candidate && candidate.status !== CandidateStatus.PENDING_REVIEW && candidate.status !== CandidateStatus.IN_CONSENSUS) {
      throw new BadRequestException('Cannot undo vote: candidate status is ' + candidate.status);
    }
    await this.reviewRepo.delete({ candidateId, reviewerId } as any);
    return { undone: true, candidateId, reviewerId };
  }

  async reportCandidate(reviewerId: string, candidateId: string, dto: { reason: string }) {
    if (!dto.reason?.trim()) throw new BadRequestException('Report reason is required');
    const candidate = await this.candidateRepo.findOne({ where: { id: candidateId } });
    if (!candidate) throw new NotFoundException('Candidate ' + candidateId + ' not found');
    const already = await (this.candidateRepo.manager as any).query(
      `SELECT id FROM moderation_cases WHERE target_entity_id=$1 AND target_entity_type='candidate' AND status IN ('PENDING','IN_REVIEW')`,
      [candidateId],
    );
    if (already.length) return { alreadyReported: true, caseId: already[0].id };
    const mc: any = await (this.candidateRepo.manager as any).query(
      `INSERT INTO moderation_cases (case_type, target_entity_type, target_entity_id, status) VALUES ('REVIEW_CONFLICT','candidate',$1,'PENDING') RETURNING *`,
      [candidateId],
    );
    const note = dto.reason.trim().slice(0, 500);
    try {
      await (this.candidateRepo.manager as any).query(
        `INSERT INTO moderation_actions (case_id, action_type, performed_by, note) VALUES ($1,'REPORT_FROM_REVIEW',$2,$3)`,
        [mc[0].id, reviewerId, note],
      );
      await (this.candidateRepo.manager as any).query(
        `INSERT INTO review_flags (review_id, reason, note) SELECT id, 'FRAUD', $2 FROM candidate_reviews WHERE candidate_id=$1 AND reviewer_id=$3`,
        [candidateId, note, reviewerId],
      );
    } catch {}
    return { reported: true, caseId: mc[0].id };
  }

  async canNotIdentify(reviewerId: string, candidateId: string, note?: string) {
    const candidate = await this.candidateRepo.findOne({ where: { id: candidateId } });
    if (!candidate) throw new NotFoundException('Candidate ' + candidateId + ' not found');
    if (candidate.status !== CandidateStatus.PENDING_REVIEW && candidate.status !== CandidateStatus.IN_CONSENSUS) {
      throw new BadRequestException('Candidate ' + candidateId + ' is not pending review (status=' + candidate.status + ')');
    }
    const existing = await this.reviewRepo.findOne({ where: { candidateId, reviewerId } });
    if (existing) throw new ConflictException('You have already voted on this candidate');
    // UNSURE = vote 0
    const review: any = this.reviewRepo.create({
      candidateId, reviewerId, vote: 0, suggestedSignTypeId: null,
      declineReason: 'Other', declineNote: note?.trim().slice(0, 500) ?? 'Cannot identify',
    } as any);
    let saved: any;
    try { saved = await this.reviewRepo.save(review); } catch (err: any) {
      if (err?.code === '23505' || String(err?.message).includes('duplicate')) throw new ConflictException('You have already voted on this candidate');
      throw err;
    }
    // Consensus may still evaluate (but vote=0 usually does not tip the outcome)
    let consensusLog: any = null;
    try { consensusLog = await this.consensusService.evaluate(candidateId); } catch {}
    return { review: saved, consensusLog };
  }
  // -- Flow 14: Active Learning orchestration stubs --
  // Backend dev provides the shell; AI teammate calls these with CLIP/YOLO scores.
  // priority: float 0..1 (higher = more uncertain / more valuable for human review)
  async setActiveLearningPriority(candidateId: string, priority: number) {
    if (!Number.isFinite(priority) || priority < 0 || priority > 1) throw new BadRequestException('priority must be a number in [0, 1]');
    const candidate = await this.candidateRepo.findOne({ where: { id: candidateId } });
    if (!candidate) throw new NotFoundException('Candidate ' + candidateId + ' not found');
    await this.candidateRepo.update(candidateId, { activeLearningPriority: priority } as any);
    return { candidateId, activeLearningPriority: priority };
  }
  async setBulkActiveLearningPriorities(items: Array<{ candidateId: string; priority: number }>) {
    if (!Array.isArray(items) || items.length === 0) throw new BadRequestException('items must be a non-empty array');
    if (items.length > 200) throw new BadRequestException('items length must be <= 200');
    const results: Array<{ candidateId: string; updated: boolean; priority?: number; error?: string }> = [];
    for (const it of items) {
      if (!it.candidateId || !Number.isFinite(it.priority) || it.priority < 0 || it.priority > 1) { results.push({ candidateId: String(it.candidateId ?? ''), updated: false, error: 'invalid candidateId or priority' }); continue; }
      const c = await this.candidateRepo.findOne({ where: { id: it.candidateId } });
      if (!c) { results.push({ candidateId: it.candidateId, updated: false, error: 'not found' }); continue; }
      await this.candidateRepo.update(it.candidateId, { activeLearningPriority: it.priority } as any);
      results.push({ candidateId: it.candidateId, updated: true, priority: it.priority });
    }
    return { updated: results.filter(r => r.updated).length, total: results.length, results };
  }
  async getUnscoredCandidates(limit = 50) {
    const n = Math.min(Math.max(1, limit), 200);
    const [items, total] = await this.candidateRepo.findAndCount({ where: { status: CandidateStatus.PENDING_REVIEW } as any, relations: ['predictedSignType'], order: { createdAt: 'ASC' }, take: n });
    // Filter to those with default priority (0) — candidates the AL engine has not yet scored
    const unscored = items.filter(c => !c.activeLearningPriority || c.activeLearningPriority === 0);
    return { items: unscored, totalUnscored: unscored.length, totalPending: total, limit: n };
  }

  /**
   * Special testing function: submit a review for 1 specific reviewer
   * and immediately evaluate consensus with single-reviewer rule.
   * Bypasses surveyor restrictions and prepares reviewer profile automatically.
   */
  async testReviewCandidate(
    candidateId: string,
    reviewerId: string,
    dto: { vote: number; suggestedSignTypeId?: number; declineReason?: string; declineNote?: string },
  ) {
    const candidate = await this.candidateRepo.findOne({
      where: { id: candidateId },
      relations: ['submission'],
    });
    if (!candidate) throw new NotFoundException('Candidate ' + candidateId + ' not found');

    // Ensure reviewer profile exists
    try {
      await (this.candidateRepo.manager as any).query(
        `INSERT INTO reviewer_profiles (
          user_id, reliability_score, total_reviews, correct_reviews, accuracy_rate, current_streak,
          total_correct_votes, total_false_votes, consecutive_errors, is_provisional, is_review_suspended
        ) VALUES ($1, 100.00, 0, 0, 0, 0, 0, 0, 0, false, false)
        ON CONFLICT (user_id) DO UPDATE SET is_review_suspended = false`,
        [reviewerId],
      );
    } catch {}

    // Reset status to PENDING_REVIEW if candidate was already processed or stuck
    if (candidate.status !== CandidateStatus.PENDING_REVIEW && candidate.status !== CandidateStatus.IN_CONSENSUS) {
      await this.candidateRepo.update(candidateId, { status: CandidateStatus.PENDING_REVIEW });
    }

    // Delete any prior review from this reviewer to allow re-testing
    await this.reviewRepo.delete({ candidateId, reviewerId } as any);

    // Save vote
    const review: any = this.reviewRepo.create({
      candidateId,
      reviewerId,
      vote: dto.vote,
      suggestedSignTypeId: dto.suggestedSignTypeId ?? null,
      declineReason: dto.declineReason ?? null,
      declineNote: dto.declineNote ?? null,
    } as any);
    const saved = await this.reviewRepo.save(review);

    // Evaluate consensus
    let consensusLog = null;
    try {
      consensusLog = await this.consensusService.evaluate(candidateId);
    } catch (e: any) {
      // ignore
    }

    if (this.dailyTasksService) {
      this.dailyTasksService.recordProgress(reviewerId, 'REVIEW', 1).catch(() => {});
    }

    return {
      success: true,
      message: 'Test review cast and evaluated for single reviewer',
      candidateId,
      reviewerId,
      review: saved,
      consensusLog,
    };
  }

  /**
   * Special testing function: assigns / directs candidate(s) to a specific reviewer
   * by resetting their status to PENDING_REVIEW and clearing any previous skips/reviews
   * for that reviewer.
   */
  async directCandidatesToReviewer(reviewerId: string, candidateIds?: string[]) {
    let targetIds = candidateIds;
    if (!targetIds || targetIds.length === 0) {
      const candidates = await this.candidateRepo.find({
        where: [
          { status: CandidateStatus.PENDING_REVIEW },
          { status: CandidateStatus.IN_CONSENSUS },
        ],
        take: 10,
        order: { createdAt: 'DESC' },
      });
      targetIds = candidates.map((c) => c.id);
    }

    if (targetIds.length === 0) {
      return { success: true, count: 0, message: 'No candidates available to assign', reviewerId };
    }

    // Remove any skipped records for this reviewer
    try {
      await (this.candidateRepo.manager as any).query(
        'DELETE FROM reviewer_skipped_candidates WHERE reviewer_id = $1 AND candidate_id = ANY($2)',
        [reviewerId, targetIds],
      );
    } catch {}

    // Remove any existing reviews from this reviewer so they can review them again
    try {
      await (this.candidateRepo.manager as any).query(
        'DELETE FROM candidate_reviews WHERE reviewer_id = $1 AND candidate_id = ANY($2)',
        [reviewerId, targetIds],
      );
    } catch {}

    // Ensure candidate status is PENDING_REVIEW
    await (this.candidateRepo.manager as any).query(
      "UPDATE unverified_sign_candidates SET status = 'PENDING_REVIEW' WHERE id = ANY($1) AND status != 'VERIFIED'",
      [targetIds],
    );

    return {
      success: true,
      reviewerId,
      assignedCount: targetIds.length,
      candidateIds: targetIds,
      message: `Assigned ${targetIds.length} candidate(s) to reviewer ${reviewerId} for testing`,
    };
  }

  async requestRecapture(reviewerId: string, candidateId: string, dto: RequestRecaptureDto, allowSelfReview = false) {
    if (!dto.reason?.trim()) {
      throw new BadRequestException('Recapture reason is required');
    }
    const candidate = await this.candidateRepo.findOne({
      where: { id: candidateId },
      relations: ['predictedSignType', 'submission'],
    });
    if (!candidate) {
      throw new NotFoundException('Candidate ' + candidateId + ' not found');
    }
    if (
      candidate.status === CandidateStatus.VERIFIED ||
      candidate.status === CandidateStatus.REJECTED ||
      candidate.status === CandidateStatus.RECAPTURE_REQUESTED
    ) {
      throw new BadRequestException(
        `Cannot request recapture for candidate ${candidateId} with status ${candidate.status}`,
      );
    }

    const canSelfReview = allowSelfReview || process.env.ALLOW_SELF_REVIEW === 'true';
    if (!canSelfReview && candidate.submission && candidate.submission.surveyorId === reviewerId) {
      throw new ForbiddenException('You cannot request recapture on sign candidates from your own survey submission');
    }

    let surveyorId: string | null = candidate.submission?.surveyorId ?? null;
    if (!surveyorId && candidate.submissionId) {
      try {
        const rows = await (this.candidateRepo.manager as any).query(
          'SELECT surveyor_id FROM survey_submissions WHERE id = $1',
          [candidate.submissionId],
        );
        if (rows.length && rows[0].surveyor_id) surveyorId = rows[0].surveyor_id;
      } catch {}
    }

    const reason = dto.reason.trim();
    const note = dto.note?.trim() || null;
    const persistRequest = async (manager: any) => {
      const candidateRows = await manager.query(
        `SELECT status FROM unverified_sign_candidates WHERE id = $1 FOR UPDATE`,
        [candidateId],
      );
      if (candidateRows.length !== 1) throw new NotFoundException('Candidate ' + candidateId + ' not found');
      if ([CandidateStatus.VERIFIED, CandidateStatus.REJECTED, CandidateStatus.RECAPTURE_REQUESTED].includes(candidateRows[0].status)) {
        throw new BadRequestException(
          `Cannot request recapture for candidate ${candidateId} with status ${candidateRows[0].status}`,
        );
      }
      const activeRows = await manager.query(
        `SELECT id FROM candidate_recapture_requests
         WHERE candidate_id = $1 AND completed_at IS NULL
         FOR UPDATE`,
        [candidateId],
      );
      if (activeRows.length > 0) {
        throw new ConflictException(`An active recapture request already exists for candidate ${candidateId}`);
      }
      const reportRows = await manager.query(
        `SELECT id, status FROM missing_sign_type_reports
         WHERE candidate_id = $1 AND status = 'INCOMPLETE'
         FOR UPDATE`,
        [candidateId],
      );
      if (reportRows.length !== 1) {
        throw new BadRequestException(
          `Cannot request recapture for candidate ${candidateId}: expected exactly one INCOMPLETE Missing Type Report, found ${reportRows.length}`,
        );
      }
      const reportId = reportRows[0].id;
      const candidateUpdate = await manager.query(
        `UPDATE unverified_sign_candidates
         SET status = 'RECAPTURE_REQUESTED'
         WHERE id = $1 AND status NOT IN ('VERIFIED', 'REJECTED', 'RECAPTURE_REQUESTED')`,
        [candidateId],
      );
      if (getAffectedRowCount(candidateUpdate) !== 1) {
        throw new BadRequestException(`Candidate ${candidateId} changed state before recapture request creation`);
      }
      const rows = await manager.query(
        `INSERT INTO candidate_recapture_requests
           (candidate_id, reviewer_id, surveyor_id, missing_type_report_id, reason, note)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [candidateId, reviewerId, surveyorId, reportId, reason, note],
      );
      return rows[0];
    };
    let savedRequest: any;
    try {
      savedRequest = this.dataSource
        ? await this.dataSource.transaction((manager) => persistRequest(manager))
        : await persistRequest(this.candidateRepo.manager);
    } catch (error: any) {
      if (error?.code === '23505' || String(error?.detail ?? '').includes('uq_candidate_recapture_requests_one_active')) {
        throw new ConflictException(`An active recapture request already exists for candidate ${candidateId}`);
      }
      throw error;
    }

    // Audit log in moderation case
    try {
      await (this.candidateRepo.manager as any).query(
        `INSERT INTO moderation_cases (case_type, target_entity_type, target_entity_id, status, resolution_note)
         VALUES ('RECAPTURE_REQUEST', 'candidate', $1, 'RESOLVED', $2)`,
        [candidateId, `Recapture requested by reviewer ${reviewerId}: ${reason}`],
      );
    } catch {}

    // Dispatch notification to surveyor
    let notificationSent = false;
    if (surveyorId && this.notificationsService) {
      try {
        const signName =
          candidate.predictedSignType?.nameVi || candidate.predictedSignType?.nameEn || 'biển báo';
        const msg = `Ảnh chụp cho ${signName} quá mờ hoặc khó xác định (${reason}${note ? ': ' + note : ''}). Vui lòng chụp lại ảnh rõ nét hơn tại vị trí này.`;
        await this.notificationsService.create(
          surveyorId,
          'IMAGE_RECAPTURE_REQUESTED',
          'Yêu cầu chụp lại ảnh biển báo',
          msg,
          'candidate',
          candidateId,
        );
        notificationSent = true;
      } catch (err: any) {
        // Notification failure should not fail request
      }
    }

    if (this.dailyTasksService) {
      this.dailyTasksService.recordProgress(reviewerId, 'REVIEW', 1).catch(() => {});
    }

    return {
      success: true,
      candidateId,
      status: CandidateStatus.RECAPTURE_REQUESTED,
      surveyorId,
      missingTypeReportId: savedRequest.missing_type_report_id ?? savedRequest.missingTypeReportId,
      recaptureRequest: savedRequest,
      notificationSent,
    };
  }

  async submitRecapture(
    surveyorId: string,
    candidateId: string,
    dto: { latitude: number; longitude: number },
    files: { signCrop?: Express.Multer.File[]; bestFrame?: Express.Multer.File[] },
  ) {
    if (!this.storageService) throw new BadRequestException('Recapture storage is not configured');
    const signCrop = files.signCrop?.[0];
    const bestFrame = files.bestFrame?.[0];
    if (!signCrop || !bestFrame) throw new BadRequestException('Both signCrop and bestFrame image evidence are required');

    for (const [field, file] of [['signCrop', signCrop], ['bestFrame', bestFrame]] as const) {
      const limits = MEDIA_SIZE_LIMITS[MediaFileType.IMAGE];
      if (!file.buffer || file.size < limits.minBytes || file.size > limits.maxBytes) {
        throw new BadRequestException(`${field} evidence file size is invalid`);
      }
      const signature = validateFileSignature(MediaFileType.IMAGE, file.buffer);
      if (!signature.valid) throw new BadRequestException(`${field}: ${signature.error ?? 'invalid image signature'}`);
      const decoded = decodeMedia(MediaFileType.IMAGE, file.buffer);
      if (!decoded.valid) throw new BadRequestException(`${field}: ${decoded.error ?? 'invalid image'}`);
    }

    const candidate = await this.candidateRepo.findOne({
      where: { id: candidateId },
      relations: ['submission'],
    });
    if (!candidate) throw new NotFoundException('Candidate ' + candidateId + ' not found');
    if (candidate.submission?.surveyorId !== surveyorId) throw new ForbiddenException('Candidate does not belong to the authenticated surveyor');
    if (candidate.status !== CandidateStatus.RECAPTURE_REQUESTED) {
      throw new BadRequestException(`Candidate ${candidateId} is not awaiting recapture (status=${candidate.status})`);
    }

    const requestRows: any[] = await (this.candidateRepo.manager as any).query(
      `SELECT id, missing_type_report_id, completed_at
       FROM candidate_recapture_requests
       WHERE candidate_id = $1 AND surveyor_id = $2 AND completed_at IS NULL`,
      [candidateId, surveyorId],
    );
    if (requestRows.length !== 1) {
      throw new BadRequestException(`Candidate ${candidateId} does not have exactly one active recapture request assigned to this surveyor`);
    }
    const request = requestRows[0];
    if (!request.missing_type_report_id) {
      throw new BadRequestException('This recapture request has no unambiguous Missing Type Report association and cannot be submitted');
    }

    const latitude = dto?.latitude;
    const longitude = dto?.longitude;
    if (typeof latitude !== 'number' || typeof longitude !== 'number'
      || !Number.isFinite(latitude) || !Number.isFinite(longitude)
      || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      throw new BadRequestException('Invalid latitude/longitude');
    }

    const locationRows: any[] = await (this.candidateRepo.manager as any).query(
      `SELECT ST_DistanceSphere(
         cge.sign_location,
         ST_SetSRID(ST_MakePoint($1, $2), 4326)
       ) AS distance_meters
       FROM candidate_geo_estimations cge
       WHERE cge.candidate_id = $3 AND cge.sign_location IS NOT NULL`,
      [longitude, latitude, candidateId],
    );
    const distanceMeters = locationRows.length > 0 ? Number(locationRows[0].distance_meters) : null;
    if (distanceMeters == null || !Number.isFinite(distanceMeters)) {
      throw new BadRequestException('Cannot verify distance: candidate has no valid original sign location');
    }
    if (distanceMeters > RECAPTURE_GEOFENCE_METERS) {
      throw new BadRequestException('Vị trí chụp lại không trùng khớp với vị trí biển báo gốc');
    }

    const requestId = request.id;
    const digest = (file: Express.Multer.File) => createHash('sha256').update(file.buffer).digest('hex').slice(0, 16);
    const objects = [
      { file: signCrop, field: 'sign-crop', bucket: this.storageService.bucketForMediaType('IMAGE') },
      { file: bestFrame, field: 'best-frame', bucket: this.storageService.bucketForMediaType('IMAGE') },
    ].map(({ file, field, bucket }) => ({
      bucket,
      objectName: `recaptures/${candidateId}/${requestId}/${field}-${digest(file)}-${randomUUID()}.${(file.originalname || 'image').split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '') || 'bin'}`,
      file,
    }));
    const uploaded = objects.map(({ bucket, objectName }) => ({ bucket, objectName }));
    try {
      for (const object of objects) await this.storageService.putObject(object.bucket, object.objectName, object.file.buffer, object.file.mimetype);
      const manager: any = this.candidateRepo.manager;
      const persist = async (tx: any) => {
        const locked = await tx.query(
          `SELECT c.status, crr.id AS request_id, crr.missing_type_report_id, r.status AS report_status
           FROM unverified_sign_candidates c
           JOIN candidate_recapture_requests crr ON crr.candidate_id = c.id
           JOIN missing_sign_type_reports r ON r.id = crr.missing_type_report_id
           WHERE c.id = $1 AND crr.id = $2 AND crr.surveyor_id = $3 AND crr.completed_at IS NULL
           FOR UPDATE OF c, crr, r`,
          [candidateId, requestId, surveyorId],
        );
        if (locked.length !== 1 || locked[0].status !== CandidateStatus.RECAPTURE_REQUESTED) throw new BadRequestException('Recapture request is no longer active');
        if (locked[0].report_status !== 'INCOMPLETE') throw new BadRequestException('Associated Missing Type Report is not incomplete');
        const updated = await tx.query(
          `UPDATE unverified_sign_candidates
           SET sign_crop_url = $1, best_frame_url = $2, status = 'MISSING_TYPE_HOLD'
           WHERE id = $3 AND status = 'RECAPTURE_REQUESTED'`,
          [`${uploaded[0].bucket}/${uploaded[0].objectName}`, `${uploaded[1].bucket}/${uploaded[1].objectName}`, candidateId],
        );
        if (getAffectedRowCount(updated) !== 1) throw new BadRequestException('Candidate recapture state changed before persistence');
        const report = await tx.query(
          `UPDATE missing_sign_type_reports SET status = 'PENDING'
           WHERE id = $1 AND candidate_id = $2 AND status = 'INCOMPLETE'`,
          [request.missing_type_report_id, candidateId],
        );
        if (getAffectedRowCount(report) !== 1) throw new BadRequestException('Associated Missing Type Report is no longer incomplete');
        const consumed = await tx.query(
          `UPDATE candidate_recapture_requests SET completed_at = NOW()
           WHERE id = $1 AND completed_at IS NULL`,
          [requestId],
        );
        if (getAffectedRowCount(consumed) !== 1) throw new BadRequestException('Recapture request was already consumed');
      };
      if (this.dataSource) await this.dataSource.transaction((tx) => persist(tx));
      else await persist(manager);
    } catch (error) {
      await this.storageService.removeObjects(uploaded).catch(() => undefined);
      throw error;
    }
    return {
      success: true,
      candidateId,
      requestId,
      missingTypeReportId: request.missing_type_report_id,
      status: CandidateStatus.MISSING_TYPE_HOLD,
      evidence: {
        signCropUrl: `${uploaded[0].bucket}/${uploaded[0].objectName}`,
        bestFrameUrl: `${uploaded[1].bucket}/${uploaded[1].objectName}`,
      },
    };
  }

  async getRecapturesForCandidate(candidateId: string) {
    if (this.recaptureRepo) {
      return this.recaptureRepo.find({
        where: { candidateId },
        order: { createdAt: 'DESC' },
      });
    }
    return (this.candidateRepo.manager as any).query(
      `SELECT * FROM candidate_recapture_requests WHERE candidate_id = $1 ORDER BY created_at DESC`,
      [candidateId],
    );
  }

  async getMyRecaptures(surveyorId: string, page = 1, pageSize = 20) {
    const p = Math.max(1, page);
    const ps = Math.min(Math.max(1, pageSize), 100);

    const countRows = await (this.candidateRepo.manager as any).query(
      `SELECT COUNT(*)::int AS cnt
       FROM candidate_recapture_requests crr
       WHERE crr.surveyor_id = $1 AND crr.completed_at IS NULL`,
      [surveyorId],
    );
    const total = countRows[0]?.cnt ?? 0;

    const items = await (this.candidateRepo.manager as any).query(
      `SELECT
         crr.id AS request_id,
         crr.candidate_id,
         crr.reason,
         crr.note,
         crr.missing_type_report_id,
         crr.completed_at,
         crr.created_at AS requested_at,
         c.sign_crop_url,
         c.best_frame_url,
         c.confidence_score,
         tst.sign_code,
         tst.name_vi,
         tst.name_en,
         ST_X(cge.sign_location::geometry) AS longitude,
         ST_Y(cge.sign_location::geometry) AS latitude
       FROM candidate_recapture_requests crr
       JOIN unverified_sign_candidates c ON c.id = crr.candidate_id
       LEFT JOIN traffic_sign_types tst ON tst.id = c.predicted_sign_type_id
       LEFT JOIN candidate_geo_estimations cge ON cge.candidate_id = c.id
       WHERE crr.surveyor_id = $1 AND crr.completed_at IS NULL
       ORDER BY crr.created_at DESC
       LIMIT $2 OFFSET $3`,
      [surveyorId, ps, (p - 1) * ps],
    );

    return {
      items,
      total,
      page: p,
      pageSize: ps,
      totalPages: Math.ceil(total / ps),
    };
  }
}
