import { ConflictException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CandidateStatus, UnverifiedSignCandidate } from '../../entities/unverified-sign-candidate.entity';
import { CandidateReview } from '../../entities/candidate-review.entity';
import { TrafficSignType } from '../../entities/traffic-sign-type.entity';
import { VoteDto } from './dto/vote.dto';
import { ConsensusService } from '../consensus/consensus.service';
@Injectable()
export class ReviewsService {
  constructor(
    @InjectRepository(UnverifiedSignCandidate) private readonly candidateRepo: Repository<UnverifiedSignCandidate>,
    @InjectRepository(CandidateReview) private readonly reviewRepo: Repository<CandidateReview>,
    @InjectRepository(TrafficSignType) private readonly signTypeRepo: Repository<TrafficSignType>,
    private readonly consensusService: ConsensusService,
  ) {}
  async queue(page = 1, pageSize = 20) {
    const safePage = Math.max(1, page); const safeSize = Math.min(Math.max(1, pageSize), 100);
    const [items, total] = await this.candidateRepo.findAndCount({ where: { status: CandidateStatus.PENDING_REVIEW }, relations: ['predictedSignType'], order: { activeLearningPriority: 'DESC', createdAt: 'ASC' }, skip: (safePage - 1) * safeSize, take: safeSize });
    return { items, total, page: safePage, pageSize: safeSize, totalPages: Math.ceil(total / safeSize) };
  }
  async vote(reviewerId: string, candidateId: string, dto: VoteDto) {
    const candidate = await this.candidateRepo.findOne({ where: { id: candidateId } });
    if (!candidate) throw new NotFoundException('Candidate ' + candidateId + ' not found');
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
    return { review: saved, consensusLog };
  }

  async getCandidateDetail(candidateId: string) {
    const candidate = await this.candidateRepo.findOne({ where: { id: candidateId }, relations: ['predictedSignType', 'submission'] });
    if (!candidate) throw new NotFoundException('Candidate ' + candidateId + ' not found');
    // enrich with survey submission location if available via raw query
    let submissionExtra: any = null;
    try {
      const rows: any[] = await (this.candidateRepo.manager as any).query(
        `SELECT s.surveyor_id, s.created_at AS captured_at, s.submission_type, s.status AS submission_status
         FROM survey_submissions s WHERE s.id = $1`, [candidate.submissionId]);
      if (rows.length) submissionExtra = rows[0];
    } catch {}
    // Try to get verified sign location if already exists (from verified_traffic_signs via candidate id link)
    let voteCount = 0;
    try { voteCount = await this.reviewRepo.count({ where: { candidateId } }); } catch {}
    return { candidate, submission: submissionExtra, voteCount };
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
        'SELECT * FROM reviewer_profiles WHERE user_id = $1', [reviewerId]);
      if (rows.length) profile = rows[0];
    } catch {}
    const totalReviews = await this.reviewRepo.count({ where: { reviewerId } as any }).catch(() => 0);
    const approved = await this.reviewRepo.count({ where: { reviewerId, vote: 1 } as any }).catch(() => 0);
    const rejected = await this.reviewRepo.count({ where: { reviewerId, vote: -1 } as any }).catch(() => 0);
    let recentActivity: any = [];
    try {
      recentActivity = await this.reviewRepo.find({ where: { reviewerId } as any, order: { reviewedAt: 'DESC' as any }, take: 5 });
    } catch {}
    return {
      reviewerId,
      reliabilityScore: profile ? Number(profile.reliability_score ?? 0.5) : 0.5,
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
        `INSERT INTO review_flags (review_id, reason, note) SELECT id, 'FRAUD', $2 FROM candidate_reviews WHERE candidate_id=$1 AND reviewer_id=$2`,
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
}
