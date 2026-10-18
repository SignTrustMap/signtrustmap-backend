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
import { ReviewerProfile } from '../../reviews/infrastructure/persistence/reviewer-profile.entity';
import { DailyTasksService } from '../../daily-tasks/daily-tasks.service';

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
    @Optional() @InjectRepository(ReviewerProfile) private readonly reviewerProfileRepo?: Repository<ReviewerProfile>,
    @Optional() private readonly dailyTasksService?: DailyTasksService,
  ) {}

  async evaluate(candidateId: string): Promise<ConsensusLog | null> {
    const candidate = await this.candidateRepo.findOne({ where: { id: candidateId } });
    if (!candidate) return null;
    if (
      candidate.status === CandidateStatus.VERIFIED ||
      candidate.status === CandidateStatus.REJECTED ||
      candidate.status === CandidateStatus.ESCALATED_MODERATION ||
      candidate.status === CandidateStatus.MISSING_TYPE_HOLD ||
      candidate.status === CandidateStatus.RECAPTURE_REQUESTED
    ) {
      return null;
    }

    let config = await this.configRepo.findOne({ where: { isActive: true }, order: { effectiveFrom: 'DESC' } });
    if (!config) {
      config = {
        id: 0,
        approvalThreshold: 0.5,
        rejectionThreshold: -0.5,
        minVotesRequired: 1,
        alphaSmoothingFactor: 0.1,
        weightCorrect: 1.0,
        penaltyFalse: 2.0,
        minSampleBaseline: 5,
        minReliabilityThreshold: 50.0,
        consecutiveErrorLimit: 3,
        suspensionCooldownDays: 7,
        provisionalVoteWeight: 1.0,
        createdBy: null,
        isActive: true,
        effectiveFrom: new Date(),
      } as unknown as ConsensusConfig;
    }

    const reviews = await this.reviewRepo.find({ where: { candidateId } });
    if (reviews.length < config.minVotesRequired) return null;

    let score = 0;
    const voterDetails: Array<{ reviewerId: string; weight: number; vote: number; suggestedSignTypeId: number | null }> = [];

    for (const r of reviews) {
      const rows: any[] = await this.dataSource.query(
        'SELECT reliability_score, is_provisional, total_correct_votes, total_false_votes FROM reviewer_profiles WHERE user_id=$1',
        [r.reviewerId],
      );

      let w = config.provisionalVoteWeight ?? 0.5;
      if (rows.length > 0) {
        const rawScore = Number(rows[0].reliability_score ?? 100);
        const relPct = rawScore <= 1.0 ? rawScore * 100 : rawScore;
        const totalVotes = Number(rows[0].total_correct_votes ?? 0) + Number(rows[0].total_false_votes ?? 0);
        // Sample baseline gate: provisional if < 5 reviews
        const isProvisional =
          rows[0].is_provisional !== undefined
            ? Boolean(rows[0].is_provisional)
            : rows[0].total_correct_votes !== undefined
              ? totalVotes < (config.minSampleBaseline ?? 5)
              : false;

        w = isProvisional ? (config.provisionalVoteWeight ?? 0.5) : Math.max(0.1, Number((relPct / 100).toFixed(4)));
      }

      score += w * r.vote;
      voterDetails.push({ reviewerId: r.reviewerId, weight: w, vote: r.vote, suggestedSignTypeId: r.suggestedSignTypeId });
    }

    const maxVotes = Math.max(config.minVotesRequired * 2, 9);
    let outcome: ConsensusOutcome | null = null;
    let winningVote: number | null = null;

    if (config.minVotesRequired === 1 && reviews.length >= 1) {
      const lastReview = reviews[reviews.length - 1];
      if (lastReview.vote === 1 || score > 0) {
        outcome = ConsensusOutcome.APPROVED;
        winningVote = 1;
      } else if (lastReview.vote === -1 || score < 0) {
        outcome = ConsensusOutcome.REJECTED;
        winningVote = -1;
      }
    }

    if (!outcome) {
      if (score >= config.approvalThreshold) {
        outcome = ConsensusOutcome.APPROVED;
        winningVote = 1;
      } else if (score <= config.rejectionThreshold) {
        outcome = ConsensusOutcome.REJECTED;
        winningVote = -1;
      } else if (reviews.length >= maxVotes) {
        outcome = ConsensusOutcome.ESCALATED;
        winningVote = score >= 0 ? 1 : -1;
      } else {
        if (candidate.status === CandidateStatus.PENDING_REVIEW) {
          await this.candidateRepo.update(candidateId, { status: CandidateStatus.IN_CONSENSUS });
        }
        return null;
      }
    }

    return this.executeOutcome(candidate, config, score, outcome, winningVote, voterDetails);
  }

  private async executeOutcome(
    candidate: UnverifiedSignCandidate,
    config: ConsensusConfig,
    score: number,
    outcome: ConsensusOutcome,
    winningVote: number | null,
    voterDetails: Array<{ reviewerId: string; weight: number; vote: number; suggestedSignTypeId: number | null }>,
  ): Promise<ConsensusLog> {
    let verifiedSignTypeId: number | null = null;
    if (outcome === ConsensusOutcome.APPROVED) {
      const winners = voterDetails.filter((v) => v.vote === winningVote);
      const counts = new Map<number, number>();
      for (const w of winners) {
        if (w.suggestedSignTypeId != null) {
          counts.set(w.suggestedSignTypeId, (counts.get(w.suggestedSignTypeId) || 0) + 1);
        }
      }
      if (counts.size > 0) {
        let best: number | null = null;
        let bestCount = 0;
        for (const [k, v] of counts.entries()) {
          if (v > bestCount) {
            bestCount = v;
            best = k;
          }
        }
        verifiedSignTypeId = best;
      }
      if (!verifiedSignTypeId) verifiedSignTypeId = candidate.predictedSignTypeId;
    }

    const log = this.logRepo.create({
      candidateId: candidate.id,
      configId: config.id || 1,
      calculatedScore: score,
      finalOutcome: outcome,
      verifiedSignTypeId,
    } as any);
    const savedLog = (await this.logRepo.save(log)) as unknown as ConsensusLog;

    if (outcome === ConsensusOutcome.APPROVED) {
      await this.handleApproved(candidate, verifiedSignTypeId!, savedLog, voterDetails, winningVote!, config);
    } else if (outcome === ConsensusOutcome.REJECTED) {
      await this.handleRejected(candidate, voterDetails, winningVote!, config, savedLog);
    } else {
      await this.handleEscalated(candidate, voterDetails, config, savedLog);
    }
    return savedLog;
  }

  private async handleApproved(
    candidate: UnverifiedSignCandidate,
    signTypeId: number,
    log: ConsensusLog,
    voterDetails: Array<{ reviewerId: string; weight: number; vote: number; suggestedSignTypeId: number | null }>,
    winningVote: number,
    config: ConsensusConfig,
  ) {
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
    let missionEligible = false;
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
      const vRows: any[] = await this.dataSource.query(
        'SELECT id FROM verified_traffic_signs WHERE origin_candidate_id=$1',
        [candidate.id],
      );
      if (vRows.length > 0) {
        missionEligible = true;
        const newSignId = vRows[0].id;
        try {
          await this.dataSource.query(
            "INSERT INTO sign_lifecycle_events (verified_sign_id, event_type, note) VALUES ($1,'PUBLISHED','Consensus APPROVED')",
            [newSignId],
          );
        } catch {}

        // Decommission and supersede any existing older sign in the exact same spot (within 5 meters)
        try {
          const oldSigns: any[] = await this.dataSource.query(
            `SELECT id FROM verified_traffic_signs
             WHERE id != $1
               AND status = 'ACTIVE'
               AND ST_DWithin(
                 location::geography,
                 ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
                 5
               )`,
            [newSignId, lon, lat],
          );
          for (const oldSign of oldSigns) {
            await this.dataSource.query(
              "UPDATE verified_traffic_signs SET status = 'DECOMMISSIONED', updated_at = NOW() WHERE id = $1",
              [oldSign.id],
            );
            await this.dataSource.query(
              "INSERT INTO sign_lifecycle_events (verified_sign_id, event_type, note) VALUES ($1, 'DECOMMISSIONED', $2)",
              [oldSign.id, `Superseded by verified sign #${newSignId}`],
            );
            try {
              await this.dataSource.query(
                "INSERT INTO verified_sign_history (verified_sign_id, change_reason) VALUES ($1, $2)",
                [oldSign.id, `Superseded by verified sign #${newSignId}`],
              );
            } catch {}
            await this.dataSource.query(
              "UPDATE revalidation_tasks SET status = 'COMPLETED' WHERE verified_sign_id = $1 AND status IN ('OPEN', 'EVALUATING')",
              [oldSign.id],
            );
          }
        } catch (e: any) {
          this.logger.warn(`Failed to supersede older signs near (${lat}, ${lon}): ${e?.message}`);
        }
      }
    } catch (e: any) {
      this.logger.warn('verified_sign insert failed ' + candidate.id + ': ' + e?.message);
    }

    if (missionEligible && this.dailyTasksService) {
      for (const reviewer of voterDetails) {
        try {
          await this.dailyTasksService.recordVerifiedSign(reviewer.reviewerId, candidate.id);
        } catch (error: any) {
          this.logger.warn(`Failed recording verified-sign mission for ${reviewer.reviewerId}: ${error?.message}`);
        }
      }
    }

    const baseReward = await this.walletService.resolveRewardAmount(TransactionType.REVIEW_REWARD, 5);
    for (const v of voterDetails) {
      const aligned = v.vote === winningVote ? 1 : 0;
      const profile = await this.updateReviewerProfile(v.reviewerId, aligned, config, log.id);
      if (aligned === 1) {
        try {
          // Reputation-Weighted Review Reward Bonus Multiplier:
          // ReviewReward = BaseReward * (0.5 + 0.5 * (Reliability / 100))
          const relScore = profile ? Number(profile.reliability_score ?? 100) : 100;
          const normalizedPct = relScore <= 1.0 ? relScore * 100 : relScore;
          const multiplier = 0.5 + 0.5 * (normalizedPct / 100);
          const finalReward = Math.max(1, Math.round(baseReward * multiplier));

          await this.walletService.creditUser(
            v.reviewerId,
            finalReward,
            TransactionType.REVIEW_REWARD,
            'consensus_log',
            log.id,
            'Review reward (consensus APPROVED)',
          );
        } catch (e: any) {
          this.logger.warn('credit failed ' + v.reviewerId + ': ' + e?.message);
        }
      }
    }

    await this.notifyVoters(candidate, voterDetails, winningVote, 'APPROVED', log.id);
    try {
      const subRows: any[] = await this.dataSource.query('SELECT surveyor_id FROM survey_submissions WHERE id=$1', [
        candidate.submissionId,
      ]);
      if (subRows.length > 0 && subRows[0].surveyor_id) {
        await this.dataSource.query(
          'INSERT INTO surveyor_profiles (user_id, total_submissions, total_verified_signs, total_credits_earned) VALUES ($1, 0, 1, 0) ON CONFLICT (user_id) DO UPDATE SET total_verified_signs = surveyor_profiles.total_verified_signs + 1',
          [subRows[0].surveyor_id],
        );
      }
    } catch {}
  }

  private async handleRejected(
    candidate: UnverifiedSignCandidate,
    voterDetails: Array<{ reviewerId: string; weight: number; vote: number; suggestedSignTypeId: number | null }>,
    winningVote: number,
    config: ConsensusConfig,
    log: ConsensusLog,
  ) {
    await this.candidateRepo.update(candidate.id, { status: CandidateStatus.REJECTED });
    const baseReward = await this.walletService.resolveRewardAmount(TransactionType.REVIEW_REWARD, 3);
    for (const v of voterDetails) {
      const aligned = v.vote === winningVote ? 1 : 0;
      const profile = await this.updateReviewerProfile(v.reviewerId, aligned, config, log.id);
      if (aligned === 1) {
        try {
          const relScore = profile ? Number(profile.reliability_score ?? 100) : 100;
          const normalizedPct = relScore <= 1.0 ? relScore * 100 : relScore;
          const multiplier = 0.5 + 0.5 * (normalizedPct / 100);
          const finalReward = Math.max(1, Math.round(baseReward * multiplier));

          await this.walletService.creditUser(
            v.reviewerId,
            finalReward,
            TransactionType.REVIEW_REWARD,
            'consensus_log',
            log.id,
            'Review reward (consensus REJECTED)',
          );
        } catch (e: any) {
          this.logger.warn('credit failed ' + v.reviewerId + ': ' + e?.message);
        }
      }
    }
    await this.notifyVoters(candidate, voterDetails, winningVote, 'REJECTED', log.id);
  }

  private async handleEscalated(
    candidate: UnverifiedSignCandidate,
    voterDetails: Array<{ reviewerId: string; weight: number; vote: number; suggestedSignTypeId: number | null }>,
    config: ConsensusConfig,
    log: ConsensusLog,
  ) {
    await this.candidateRepo.update(candidate.id, { status: CandidateStatus.ESCALATED_MODERATION });
    try {
      await this.dataSource.query(
        "INSERT INTO moderation_cases (id, case_type, target_entity_type, target_entity_id, status, created_at) VALUES (gen_random_uuid(), 'REVIEW_CONFLICT', 'unverified_sign_candidate', $1, 'PENDING', now())",
        [candidate.id],
      );
    } catch (e: any) {
      this.logger.warn('moderation case insert failed: ' + e?.message);
    }
    for (const v of voterDetails) {
      await this.updateReviewerProfile(v.reviewerId, 0.5, config, log.id, true);
    }
    await this.notifyVoters(candidate, voterDetails, null, 'ESCALATED', log.id);
  }

  async updateReviewerProfile(
    reviewerId: string,
    aligned: number,
    config: ConsensusConfig,
    consensusLogId: string,
    isEscalated = false,
  ): Promise<any> {
    try {
      const rows: any[] = await this.dataSource.query('SELECT * FROM reviewer_profiles WHERE user_id=$1', [reviewerId]);
      let oldScore = 100.0;
      let totalReviews = 0;
      let correctReviews = 0;
      let currentStreak = 0;
      let totalCorrectVotes = 0;
      let totalFalseVotes = 0;
      let consecutiveErrors = 0;

      if (rows.length > 0) {
        const r = rows[0];
        oldScore = Number(r.reliability_score ?? 100);
        totalReviews = Number(r.total_reviews ?? 0);
        correctReviews = Number(r.correct_reviews ?? 0);
        currentStreak = Number(r.current_streak ?? 0);
        totalCorrectVotes = Number(r.total_correct_votes ?? correctReviews);
        totalFalseVotes = Number(r.total_false_votes ?? Math.max(0, totalReviews - correctReviews));
        consecutiveErrors = Number(r.consecutive_errors ?? 0);
      } else {
        await this.dataSource.query(
          `INSERT INTO reviewer_profiles (
            user_id, reliability_score, total_reviews, correct_reviews, accuracy_rate, current_streak,
            total_correct_votes, total_false_votes, consecutive_errors, is_provisional, is_review_suspended
          ) VALUES ($1, 100.00, 0, 0, 0, 0, 0, 0, 0, true, false)
          ON CONFLICT (user_id) DO NOTHING`,
          [reviewerId],
        );
      }

      if (!isEscalated) {
        if (aligned === 1) {
          totalCorrectVotes += 1;
          correctReviews += 1;
          consecutiveErrors = 0;
          currentStreak += 1;
        } else {
          totalFalseVotes += 1;
          consecutiveErrors += 1;
          currentStreak = 0;
        }
        totalReviews += 1;
      }

      // Mathematical Formulation: Reliability (%) = (x * C) / (x * C + y * F) * 100%
      const x = config.weightCorrect ?? 1.0;
      const y = config.penaltyFalse ?? 2.0;
      const denom = x * totalCorrectVotes + y * totalFalseVotes;
      const newScore = denom > 0
        ? Number(((x * totalCorrectVotes / denom) * 100).toFixed(2))
        : 100.00;

      const totalVotes = totalCorrectVotes + totalFalseVotes;
      const minBaseline = config.minSampleBaseline ?? 5;
      const isProvisional = totalVotes < minBaseline;

      // Governance Safeguards
      let isSuspended = false;
      let suspendedAt: Date | null = null;
      let suspendedUntil: Date | null = null;
      let suspensionReason: string | null = null;

      const errorLimit = config.consecutiveErrorLimit ?? 3;
      const minReliability = config.minReliabilityThreshold ?? 50.0;

      if (consecutiveErrors >= errorLimit) {
        isSuspended = true;
        suspendedAt = new Date();
        const cooldownDays = config.suspensionCooldownDays ?? 7;
        suspendedUntil = new Date(Date.now() + cooldownDays * 24 * 60 * 60 * 1000);
        suspensionReason = 'CONSECUTIVE_ERRORS';
      } else if (!isProvisional && newScore < minReliability) {
        isSuspended = true;
        suspendedAt = new Date();
        suspendedUntil = null;
        suspensionReason = 'BELOW_MIN_RELIABILITY';
      }

      const newAccuracy = totalReviews > 0 ? Number((correctReviews / totalReviews).toFixed(4)) : 0;

      await this.dataSource.query(
        `UPDATE reviewer_profiles SET
          reliability_score = $1,
          total_correct_votes = $2,
          total_false_votes = $3,
          consecutive_errors = $4,
          is_provisional = $5,
          is_review_suspended = $6,
          suspended_at = $7,
          suspended_until = $8,
          suspension_reason = $9,
          total_reviews = $10,
          correct_reviews = $11,
          accuracy_rate = $12,
          current_streak = $13,
          last_reviewed_at = now(),
          updated_at = now()
        WHERE user_id = $14`,
        [
          newScore,
          totalCorrectVotes,
          totalFalseVotes,
          consecutiveErrors,
          isProvisional,
          isSuspended,
          suspendedAt,
          suspendedUntil,
          suspensionReason,
          totalReviews,
          correctReviews,
          newAccuracy,
          currentStreak,
          reviewerId,
        ],
      );

      await this.dataSource.query(
        `INSERT INTO reviewer_reliability_history (reviewer_id, consensus_log_id, old_score, new_score, alignment_value)
         VALUES ($1, $2, $3, $4, $5)`,
        [reviewerId, consensusLogId, oldScore, newScore, aligned === 0.5 ? 0 : aligned === 1 ? 1 : -1],
      );

      return {
        user_id: reviewerId,
        reliability_score: newScore,
        total_correct_votes: totalCorrectVotes,
        total_false_votes: totalFalseVotes,
        consecutive_errors: consecutiveErrors,
        is_provisional: isProvisional,
        is_review_suspended: isSuspended,
        suspension_reason: suspensionReason,
      };
    } catch (e: any) {
      this.logger.warn('updateReviewerProfile ' + reviewerId + ': ' + e?.message);
      return null;
    }
  }

  private async notifyVoters(
    candidate: UnverifiedSignCandidate,
    voterDetails: Array<{ reviewerId: string; weight: number; vote: number }>,
    winningVote: number | null,
    outcomeLabel: string,
    logId: string,
  ) {
    try {
      const notifs = voterDetails.map((v) => ({
        userId: v.reviewerId,
        type: 'CONSENSUS_RESOLVED',
        title: 'Candidate ' + outcomeLabel,
        message:
          'Your vote (' +
          (v.vote === 1 ? 'approve' : 'reject') +
          ') on ' +
          candidate.id.slice(0, 8) +
          '... resolved as ' +
          outcomeLabel +
          '.',
        relatedEntityType: 'consensus_log',
        relatedEntityId: logId,
      }));
      if (notifs.length) await this.notificationsService.createBulk(notifs as any);
    } catch {}
  }
}
