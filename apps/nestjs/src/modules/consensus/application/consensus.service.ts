import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ConsensusConfig } from '../infrastructure/persistence/consensus-config.entity';
import { ConsensusLog, ConsensusOutcome } from '../infrastructure/persistence/consensus-log.entity';
import {
  CandidateStatus,
  UnverifiedSignCandidate,
} from '../../survey/infrastructure/persistence/unverified-sign-candidate.entity';
import { CandidateReview } from '../../reviews/infrastructure/persistence/candidate-review.entity';
import { TransactionType } from '../../wallet/infrastructure/persistence/credit-transaction.entity';
import { WalletService } from '../../wallet/application/wallet.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { SpatialAdminService } from '../../spatial-admin/application/spatial-admin.service';

@Injectable()
export class ConsensusService {
  private readonly logger = new Logger(ConsensusService.name);
  constructor(
    @InjectRepository(ConsensusConfig) private readonly configRepo: Repository<ConsensusConfig>,
    @InjectRepository(ConsensusLog) private readonly logRepo: Repository<ConsensusLog>,
    @InjectRepository(UnverifiedSignCandidate) private readonly candidateRepo: Repository<UnverifiedSignCandidate>,
    @InjectRepository(CandidateReview) private readonly reviewRepo: Repository<CandidateReview>,
    private readonly dataSource: DataSource,
    private readonly walletService: WalletService,
    private readonly notificationsService: NotificationsService,
    @Optional() private readonly spatialAdminService?: SpatialAdminService,
  ) {}
  async evaluate(candidateId: string): Promise<ConsensusLog | null> {
    const candidate = await this.candidateRepo.findOne({ where: { id: candidateId } });
    if (!candidate) return null;
    if (candidate.status === CandidateStatus.VERIFIED || candidate.status === CandidateStatus.REJECTED || candidate.status === CandidateStatus.ESCALATED_MODERATION || candidate.status === CandidateStatus.MISSING_TYPE_HOLD) return null;
    let config = await this.configRepo.findOne({ where: { isActive: true }, order: { effectiveFrom: 'DESC' } });
    if (!config) config = { id: 0, approvalThreshold: 1.0, rejectionThreshold: -1.0, minVotesRequired: 3, alphaSmoothingFactor: 0.1, createdBy: null, isActive: true, effectiveFrom: new Date() } as unknown as ConsensusConfig;
    const reviews = await this.reviewRepo.find({ where: { candidateId } });
    if (reviews.length < config.minVotesRequired) return null;
    let score = 0;
    const voterDetails: Array<{ reviewerId: string; weight: number; vote: number; suggestedSignTypeId: number | null }> = [];
    for (const r of reviews) {
      const rows: any[] = await this.dataSource.query('SELECT reliability_score FROM reviewer_profiles WHERE user_id=$1', [r.reviewerId]);
      const w = rows.length > 0 && Number.isFinite(Number(rows[0].reliability_score)) ? Number(rows[0].reliability_score) : 0.5;
      score += w * r.vote;
      voterDetails.push({ reviewerId: r.reviewerId, weight: w, vote: r.vote, suggestedSignTypeId: r.suggestedSignTypeId });
    }
    const maxVotes = Math.max(config.minVotesRequired * 2, 9);
    let outcome: ConsensusOutcome | null = null; let winningVote: number | null = null;
    if (score >= config.approvalThreshold) { outcome = ConsensusOutcome.APPROVED; winningVote = 1; }
    else if (score <= config.rejectionThreshold) { outcome = ConsensusOutcome.REJECTED; winningVote = -1; }
    else if (reviews.length >= maxVotes) { outcome = ConsensusOutcome.ESCALATED; winningVote = score >= 0 ? 1 : -1; }
    else { if (candidate.status === CandidateStatus.PENDING_REVIEW) await this.candidateRepo.update(candidateId, { status: CandidateStatus.IN_CONSENSUS }); return null; }
    return this.executeOutcome(candidate, config, score, outcome!, winningVote, voterDetails);
  }
  private async executeOutcome(candidate: UnverifiedSignCandidate, config: ConsensusConfig, score: number, outcome: ConsensusOutcome, winningVote: number | null, voterDetails: Array<{ reviewerId: string; weight: number; vote: number; suggestedSignTypeId: number | null }>): Promise<ConsensusLog> {
    let verifiedSignTypeId: number | null = null;
    if (outcome === ConsensusOutcome.APPROVED) {
      const winners = voterDetails.filter(v => v.vote === winningVote);
      const counts = new Map<number, number>();
      for (const w of winners) if (w.suggestedSignTypeId != null) counts.set(w.suggestedSignTypeId, (counts.get(w.suggestedSignTypeId) || 0) + 1);
      if (counts.size > 0) { let best: number | null = null; let bestCount = 0; for (const [k,v] of counts.entries()) if (v > bestCount) { bestCount = v; best = k; } verifiedSignTypeId = best; }
      if (!verifiedSignTypeId) verifiedSignTypeId = candidate.predictedSignTypeId;
    }
    const log = this.logRepo.create({ candidateId: candidate.id, configId: config.id || 1, calculatedScore: score, finalOutcome: outcome, verifiedSignTypeId } as any);
    const savedLog = await this.logRepo.save(log) as unknown as ConsensusLog;
    if (outcome === ConsensusOutcome.APPROVED) await this.handleApproved(candidate, verifiedSignTypeId!, savedLog, voterDetails, winningVote!, config);
    else if (outcome === ConsensusOutcome.REJECTED) await this.handleRejected(candidate, voterDetails, winningVote!, config, savedLog);
    else await this.handleEscalated(candidate, voterDetails, config, savedLog);
    return savedLog;
  }
  private async handleApproved(candidate: UnverifiedSignCandidate, signTypeId: number, log: ConsensusLog, voterDetails: Array<{ reviewerId: string; weight: number; vote: number; suggestedSignTypeId: number | null }>, winningVote: number, config: ConsensusConfig) {
    let lon: number | null = null;
    let lat: number | null = null;
    let bearing: number | null = null;
    try {
      const rows: any[] = await this.dataSource.query(
        'SELECT ST_AsText(sign_location) AS sign_wkt, ST_AsText(vehicle_location) AS vehicle_wkt, traffic_direction FROM candidate_geo_estimations WHERE candidate_id=$1',
        [candidate.id],
      );
      if (rows.length > 0) {
        const wkt = rows[0].sign_wkt || rows[0].vehicle_wkt;
        if (wkt) {
          const m = String(wkt).match(/POINT\s*\(\s*([^\s]+)\s+([^\s]+)\s*\)/);
          if (m) {
            lon = parseFloat(m[1]);
            lat = parseFloat(m[2]);
          }
        }
        if (rows[0].traffic_direction != null) bearing = Number(rows[0].traffic_direction);
      }
    } catch {}

    if (lon == null || lat == null) {
      this.logger.warn(`Candidate ${candidate.id} approved without GPS geo estimation. Skipping map creation.`);
      await this.candidateRepo.update(candidate.id, { status: CandidateStatus.VERIFIED });
      return;
    }

    let communeCode: string | null = null;
    let roadName: string | null = null;
    let displayAddress: string | null = null;
    if (this.spatialAdminService) {
      try {
        const resolved = await this.spatialAdminService.resolveLocation(lat, lon);
        communeCode = resolved.communeCode;
        roadName = resolved.roadName;
        displayAddress = resolved.displayAddress;
      } catch (err: any) {
        this.logger.warn(`Failed to resolve spatial address for consensus sign ${candidate.id}: ${err?.message}`);
      }
    }

    await this.candidateRepo.update(candidate.id, { status: CandidateStatus.VERIFIED });
    try {
      await this.dataSource.query(
        `INSERT INTO verified_traffic_signs (
           id, sign_type_id, origin_candidate_id, location, traffic_direction,
           sign_crop_url, status, freshness_score, last_verified_at,
           commune_code, road_name, display_address
         ) VALUES (
           gen_random_uuid(), $1, $2, ST_SetSRID(ST_MakePoint($3,$4),4326), $5,
           $6, 'ACTIVE', 1, now(),
           $7, $8, $9
         ) ON CONFLICT (origin_candidate_id) DO NOTHING`,
        [signTypeId, candidate.id, lon, lat, bearing, candidate.signCropUrl, communeCode, roadName, displayAddress],
      );
      const vRows: any[] = await this.dataSource.query('SELECT id FROM verified_traffic_signs WHERE origin_candidate_id=$1', [candidate.id]);
      if (vRows.length > 0) { try { await this.dataSource.query('INSERT INTO sign_lifecycle_events (verified_sign_id, event_type, note) VALUES ($1,\'PUBLISHED\',\'Consensus APPROVED\')', [vRows[0].id]); } catch {} }
    } catch (e: any) { this.logger.warn('verified_sign insert failed ' + candidate.id + ': ' + e?.message); }
    const rewardAmount = await this.walletService.resolveRewardAmount(TransactionType.REVIEW_REWARD, 5);
    for (const v of voterDetails) { const aligned = v.vote === winningVote ? 1 : 0; await this.updateReviewerProfile(v.reviewerId, aligned, config, log.id); if (aligned === 1) { try { await this.walletService.creditUser(v.reviewerId, rewardAmount, TransactionType.REVIEW_REWARD, 'consensus_log', log.id, 'Review reward (consensus APPROVED)'); } catch (e: any) { this.logger.warn('credit failed ' + v.reviewerId + ': ' + e?.message); } } }
    await this.notifyVoters(candidate, voterDetails, winningVote, 'APPROVED', log.id);
    try { const subRows: any[] = await this.dataSource.query('SELECT surveyor_id FROM survey_submissions WHERE id=$1', [candidate.submissionId]); if (subRows.length > 0 && subRows[0].surveyor_id) await this.dataSource.query('INSERT INTO surveyor_profiles (user_id, total_submissions, total_verified_signs, total_credits_earned) VALUES ($1, 0, 1, 0) ON CONFLICT (user_id) DO UPDATE SET total_verified_signs = surveyor_profiles.total_verified_signs + 1', [subRows[0].surveyor_id]); } catch {}
  }
  private async handleRejected(candidate: UnverifiedSignCandidate, voterDetails: Array<{ reviewerId: string; weight: number; vote: number; suggestedSignTypeId: number | null }>, winningVote: number, config: ConsensusConfig, log: ConsensusLog) {
    await this.candidateRepo.update(candidate.id, { status: CandidateStatus.REJECTED });
    const rewardAmount = await this.walletService.resolveRewardAmount(TransactionType.REVIEW_REWARD, 3);
    for (const v of voterDetails) { const aligned = v.vote === winningVote ? 1 : 0; await this.updateReviewerProfile(v.reviewerId, aligned, config, log.id); if (aligned === 1) { try { await this.walletService.creditUser(v.reviewerId, rewardAmount, TransactionType.REVIEW_REWARD, 'consensus_log', log.id, 'Review reward (consensus REJECTED)'); } catch (e: any) { this.logger.warn('credit failed ' + v.reviewerId + ': ' + e?.message); } } }
    await this.notifyVoters(candidate, voterDetails, winningVote, 'REJECTED', log.id);
  }
  private async handleEscalated(candidate: UnverifiedSignCandidate, voterDetails: Array<{ reviewerId: string; weight: number; vote: number; suggestedSignTypeId: number | null }>, config: ConsensusConfig, log: ConsensusLog) {
    await this.candidateRepo.update(candidate.id, { status: CandidateStatus.ESCALATED_MODERATION });
    try { await this.dataSource.query("INSERT INTO moderation_cases (id, case_type, target_entity_type, target_entity_id, status, created_at) VALUES (gen_random_uuid(), 'REVIEW_CONFLICT', 'unverified_sign_candidate', $1, 'PENDING', now())", [candidate.id]); } catch (e: any) { this.logger.warn('moderation case insert failed: ' + e?.message); }
    for (const v of voterDetails) await this.updateReviewerProfile(v.reviewerId, 0.5, config, log.id, true);
    await this.notifyVoters(candidate, voterDetails, null, 'ESCALATED', log.id);
  }
  private async updateReviewerProfile(reviewerId: string, aligned: number, config: ConsensusConfig, consensusLogId: string, isEscalated = false) {
    try {
      const rows: any[] = await this.dataSource.query('SELECT * FROM reviewer_profiles WHERE user_id=$1', [reviewerId]);
      let oldScore = 0.5, totalReviews = 0, correctReviews = 0, currentStreak = 0;
      if (rows.length > 0) { oldScore = Number(rows[0].reliability_score ?? 0.5); totalReviews = Number(rows[0].total_reviews ?? 0); correctReviews = Number(rows[0].correct_reviews ?? 0); currentStreak = Number(rows[0].current_streak ?? 0); }
      else await this.dataSource.query('INSERT INTO reviewer_profiles (user_id, reliability_score, total_reviews, correct_reviews, accuracy_rate, current_streak) VALUES ($1, 0.5, 0, 0, 0, 0) ON CONFLICT (user_id) DO NOTHING', [reviewerId]);
      const newTotal = totalReviews + 1; const newCorrect = correctReviews + (aligned === 1 ? 1 : 0); const newAccuracy = newTotal > 0 ? newCorrect / newTotal : 0;
      // Real observation convergence: if newTotal is 0, default to 0.5; once real observations exist, converge directly to true accuracy.
      const newScore = newTotal === 0 ? 0.5 : Math.max(0, Math.min(1, Number(newAccuracy.toFixed(4))));
      const newStreak = isEscalated ? 0 : (aligned === 1 ? currentStreak + 1 : 0);
      await this.dataSource.query('UPDATE reviewer_profiles SET reliability_score=$1, total_reviews=$2, correct_reviews=$3, accuracy_rate=$4, current_streak=$5, last_reviewed_at=now(), updated_at=now() WHERE user_id=$6', [newScore, newTotal, newCorrect, newAccuracy, newStreak, reviewerId]);
      await this.dataSource.query('INSERT INTO reviewer_reliability_history (reviewer_id, consensus_log_id, old_score, new_score, alignment_value) VALUES ($1,$2,$3,$4,$5)', [reviewerId, consensusLogId, oldScore, newScore, aligned === 0.5 ? 0 : (aligned === 1 ? 1 : -1)]);
    } catch (e: any) { this.logger.warn('updateReviewerProfile ' + reviewerId + ': ' + e?.message); }
  }
  private async notifyVoters(candidate: UnverifiedSignCandidate, voterDetails: Array<{ reviewerId: string; weight: number; vote: number }>, winningVote: number | null, outcomeLabel: string, logId: string) {
    try { const notifs = voterDetails.map(v => ({ userId: v.reviewerId, type: 'CONSENSUS_RESOLVED', title: 'Candidate ' + outcomeLabel, message: 'Your vote (' + (v.vote === 1 ? 'approve' : 'reject') + ') on ' + candidate.id.slice(0,8) + '... resolved as ' + outcomeLabel + '.', relatedEntityType: 'consensus_log', relatedEntityId: logId })); if (notifs.length) await this.notificationsService.createBulk(notifs as any); } catch {}
  }
}
