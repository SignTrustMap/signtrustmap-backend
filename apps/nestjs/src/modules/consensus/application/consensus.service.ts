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
import { ReviewerReliabilityHistory } from '../../reviews/infrastructure/persistence/reviewer-reliability-history.entity';
import { DailyTasksService } from '../../daily-tasks/daily-tasks.service';
import { VerifiedSignOrmEntity } from '../../sign-map/infrastructure/persistence/verified-sign.orm-entity';
import { SignLifecycleEvent } from '../../sign-map/infrastructure/persistence/sign-lifecycle-event.entity';
import { VerifiedSignHistory } from '../../sign-map/infrastructure/persistence/verified-sign-history.entity';
import { CandidateGeoEstimation } from '../../survey/infrastructure/persistence/candidate-geo-estimation.entity';
import { SurveySubmission } from '../../survey/infrastructure/persistence/survey-submission.entity';
import { SurveyorProfile } from '../../survey/infrastructure/persistence/surveyor-profile.entity';
import { ModerationCase } from '../../moderation/infrastructure/persistence/moderation-case.entity';
import { RevalidationTask, TaskStatus } from '../../revalidation/infrastructure/persistence/revalidation-task.entity';
import { SystemSwitchService } from '../../admin/system-switch.service';
import { SystemParametersService } from '../../system-parameters/system-parameters.service';

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
    @Optional() @InjectRepository(VerifiedSignOrmEntity) private readonly verifiedSignRepo?: Repository<VerifiedSignOrmEntity>,
    @Optional() @InjectRepository(SignLifecycleEvent) private readonly lifecycleRepo?: Repository<SignLifecycleEvent>,
    @Optional() @InjectRepository(VerifiedSignHistory) private readonly signHistoryRepo?: Repository<VerifiedSignHistory>,
    @Optional() @InjectRepository(RevalidationTask) private readonly revalidationTaskRepo?: Repository<RevalidationTask>,
    @Optional() @InjectRepository(CandidateGeoEstimation) private readonly geoEstimationRepo?: Repository<CandidateGeoEstimation>,
    @Optional() @InjectRepository(SurveySubmission) private readonly submissionRepo?: Repository<SurveySubmission>,
    @Optional() @InjectRepository(SurveyorProfile) private readonly surveyorProfileRepo?: Repository<SurveyorProfile>,
    @Optional() @InjectRepository(ModerationCase) private readonly moderationCaseRepo?: Repository<ModerationCase>,
    @Optional() @InjectRepository(ReviewerReliabilityHistory) private readonly reviewerHistoryRepo?: Repository<ReviewerReliabilityHistory>,
    @Optional() private readonly systemSwitchService?: SystemSwitchService,
    @Optional() private readonly paramService?: SystemParametersService,
  ) {}

  async evaluate(candidateId: string): Promise<ConsensusLog | null> {
    const candidate = await this.candidateRepo.findOne({ where: { id: candidateId } });
    if (!candidate) return null;
    if (
      candidate.status === CandidateStatus.VERIFIED ||
      candidate.status === CandidateStatus.REJECTED ||
      candidate.status === CandidateStatus.ESCALATED_MODERATION ||
      candidate.status === CandidateStatus.NEW_TYPE_HOLD ||
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
        minVotesRequired: 3,
        alphaSmoothingFactor: 0.1,
        weightCorrect: 1.0,
        penaltyFalse: 2.0,
        minSampleBaseline: 5,
        minReliabilityThreshold: 50.0,
        consecutiveErrorLimit: 3,
        suspensionCooldownDays: 7,
        provisionalVoteWeight: 1.0,
        provisionalMinReliabilityThreshold: 40.0,
        provisionalConsecutiveErrorLimit: 2,
        provisionalAutoBanEnabled: true,
        createdBy: null,
        isActive: true,
        effectiveFrom: new Date(),
      } as unknown as ConsensusConfig;
    }

    // Dynamic parameter resolution from SystemParametersService
    if (this.paramService) {
      config = {
        ...config,
        approvalThreshold: await this.paramService.getNumber('consensus.approval_threshold', config.approvalThreshold),
        rejectionThreshold: await this.paramService.getNumber('consensus.rejection_threshold', config.rejectionThreshold),
        minVotesRequired: await this.paramService.getNumber('consensus.min_votes_required', config.minVotesRequired),
        maxVotesLimit: await this.paramService.getNumber('consensus.max_votes_limit', config.maxVotesLimit ?? 9),
        alphaSmoothingFactor: await this.paramService.getNumber('consensus.alpha_smoothing_factor', config.alphaSmoothingFactor),
        weightCorrect: await this.paramService.getNumber('consensus.weight_correct', config.weightCorrect),
        penaltyFalse: await this.paramService.getNumber('consensus.penalty_false', config.penaltyFalse),
        minSampleBaseline: await this.paramService.getNumber('consensus.min_sample_baseline', config.minSampleBaseline),
        minReliabilityThreshold: await this.paramService.getNumber('consensus.min_reliability_threshold', config.minReliabilityThreshold),
        consecutiveErrorLimit: await this.paramService.getNumber('consensus.consecutive_error_limit', config.consecutiveErrorLimit),
        suspensionCooldownDays: await this.paramService.getNumber('consensus.suspension_cooldown_days', config.suspensionCooldownDays),
        provisionalVoteWeight: await this.paramService.getNumber('consensus.provisional_vote_weight', config.provisionalVoteWeight),
      } as ConsensusConfig;
    }

    const reviews = await this.reviewRepo.find({ where: { candidateId } });
    if (reviews.length < config.minVotesRequired) return null;

    let score = 0;
    const voterDetails: Array<{ reviewerId: string; weight: number; vote: number; suggestedSignTypeId: number | null }> = [];

    for (const r of reviews) {
      let profile: any = null;
      if (this.reviewerProfileRepo && typeof this.reviewerProfileRepo.findOne === 'function') {
        profile = await this.reviewerProfileRepo.findOne({
          where: { userId: r.reviewerId },
        });
      }
      if (!profile && typeof this.dataSource?.query === 'function') {
        const rows: any[] = await this.dataSource.query(
          'SELECT reliability_score, is_provisional, total_correct_votes, total_false_votes FROM reviewer_profiles WHERE user_id=$1',
          [r.reviewerId],
        );
        if (rows.length > 0) profile = rows[0];
      }

      let w = config.provisionalVoteWeight ?? 0.5;
      if (profile) {
        const rawScore = Number(profile.reliabilityScore ?? profile.reliability_score ?? 100);
        const relPct = rawScore <= 1.0 ? rawScore * 100 : rawScore;
        const correctVotes = Number(profile.totalCorrectVotes ?? profile.total_correct_votes ?? 0);
        const falseVotes = Number(profile.totalFalseVotes ?? profile.total_false_votes ?? 0);
        const totalVotes = correctVotes + falseVotes;
        // Sample baseline gate: provisional if < 5 reviews
        const isProvisional =
          profile.isProvisional !== undefined
            ? Boolean(profile.isProvisional)
            : profile.is_provisional !== undefined
              ? Boolean(profile.is_provisional)
              : (profile.totalCorrectVotes !== undefined || profile.total_correct_votes !== undefined)
                ? totalVotes < (config.minSampleBaseline ?? 5)
                : false;

        w = isProvisional ? (config.provisionalVoteWeight ?? 0.5) : Math.max(0.1, Number((relPct / 100).toFixed(4)));
      }

      score += w * r.vote;
      voterDetails.push({ reviewerId: r.reviewerId, weight: w, vote: r.vote, suggestedSignTypeId: r.suggestedSignTypeId });
    }

    const maxVotes = config.maxVotesLimit ?? Math.max(config.minVotesRequired * 2, 9);
    let outcome: ConsensusOutcome | null = null;
    let winningVote: number | null = null;

    const isSingleVoteConsensus =
      config.minVotesRequired === 1 ||
      (this.systemSwitchService
        ? await this.systemSwitchService.isEnabled('SINGLE_VOTE_CONSENSUS')
        : process.env.DEMO_MODE === 'true');

    if (isSingleVoteConsensus && reviews.length >= 1) {
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
      let geoRow: any = null;
      if (this.geoEstimationRepo && typeof this.geoEstimationRepo.createQueryBuilder === 'function') {
        geoRow = await this.geoEstimationRepo
          .createQueryBuilder('g')
          .select('ST_AsText(g.sign_location)', 'sign_wkt')
          .addSelect('ST_AsText(g.vehicle_location)', 'vehicle_wkt')
          .addSelect('g.trafficDirection', 'traffic_direction')
          .where('g.candidateId = :cid', { cid: candidate.id })
          .getRawOne();
      }
      if (!geoRow && typeof this.dataSource?.query === 'function') {
        const rows: any[] = await this.dataSource.query(
          'SELECT ST_AsText(sign_location) AS sign_wkt, ST_AsText(vehicle_location) AS vehicle_wkt, traffic_direction FROM candidate_geo_estimations WHERE candidate_id=$1',
          [candidate.id],
        );
        if (rows.length > 0) geoRow = rows[0];
      }
      if (geoRow) {
        const wkt = geoRow.sign_wkt || geoRow.vehicle_wkt;
        if (wkt) {
          const m = String(wkt).match(/POINT\s*\(\s*([^\s]+)\s+([^\s]+)\s*\)/);
          if (m) {
            lon = parseFloat(m[1]);
            lat = parseFloat(m[2]);
          }
        }
        if (geoRow.traffic_direction != null) bearing = Number(geoRow.traffic_direction);
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
      let newSignId: string | null = null;
      if (this.verifiedSignRepo && typeof this.verifiedSignRepo.createQueryBuilder === 'function') {
        await this.verifiedSignRepo
          .createQueryBuilder()
          .insert()
          .into(VerifiedSignOrmEntity)
          .values({
            signTypeId,
            originCandidateId: candidate.id,
            location: () => `ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)`,
            trafficDirection: bearing,
            signCropUrl: candidate.signCropUrl,
            status: 'ACTIVE',
            freshnessScore: 1,
            lastVerifiedAt: new Date(),
            communeCode,
            roadName,
            displayAddress,
          } as any)
          .orIgnore()
          .execute();
        const vSign = await this.verifiedSignRepo.findOne({
          where: { originCandidateId: candidate.id },
          select: ['id'],
        });
        if (vSign) newSignId = vSign.id;
      } else if (typeof this.dataSource?.query === 'function') {
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
        if (vRows.length > 0) newSignId = vRows[0].id;
      }

      if (newSignId) {
        missionEligible = true;
        try {
          if (this.lifecycleRepo && typeof this.lifecycleRepo.save === 'function') {
            await this.lifecycleRepo.save(
              this.lifecycleRepo.create({
                verifiedSignId: newSignId,
                eventType: 'PUBLISHED',
                note: 'Consensus APPROVED',
              }),
            );
          } else if (typeof this.dataSource?.query === 'function') {
            await this.dataSource.query(
              "INSERT INTO sign_lifecycle_events (verified_sign_id, event_type, note) VALUES ($1,'PUBLISHED','Consensus APPROVED')",
              [newSignId],
            );
          }
        } catch {}

        // Decommission and supersede any existing older sign in the exact same spot (within 5 meters)
        try {
          let oldSigns: any[] = [];
          if (this.verifiedSignRepo && typeof this.verifiedSignRepo.createQueryBuilder === 'function') {
            oldSigns = await this.verifiedSignRepo
              .createQueryBuilder('s')
              .select('s.id', 'id')
              .where('s.id != :newSignId', { newSignId })
              .andWhere("s.status = 'ACTIVE'")
              .andWhere(
                'ST_DWithin(s.location::geography, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography, 5)',
                { lon, lat },
              )
              .getRawMany();
          } else if (typeof this.dataSource?.query === 'function') {
            oldSigns = await this.dataSource.query(
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
          }

          for (const oldSign of oldSigns) {
            if (this.verifiedSignRepo && typeof this.verifiedSignRepo.update === 'function') {
              await this.verifiedSignRepo.update(oldSign.id, {
                status: 'DECOMMISSIONED',
                updatedAt: new Date(),
              });
            } else if (typeof this.dataSource?.query === 'function') {
              await this.dataSource.query(
                "UPDATE verified_traffic_signs SET status = 'DECOMMISSIONED', updated_at = NOW() WHERE id = $1",
                [oldSign.id],
              );
            }

            if (this.lifecycleRepo && typeof this.lifecycleRepo.save === 'function') {
              await this.lifecycleRepo.save(
                this.lifecycleRepo.create({
                  verifiedSignId: oldSign.id,
                  eventType: 'DECOMMISSIONED',
                  note: `Superseded by verified sign #${newSignId}`,
                }),
              );
            } else if (typeof this.dataSource?.query === 'function') {
              await this.dataSource.query(
                "INSERT INTO sign_lifecycle_events (verified_sign_id, event_type, note) VALUES ($1, 'DECOMMISSIONED', $2)",
                [oldSign.id, `Superseded by verified sign #${newSignId}`],
              );
            }

            try {
              if (this.signHistoryRepo && typeof this.signHistoryRepo.save === 'function') {
                await this.signHistoryRepo.save(
                  this.signHistoryRepo.create({
                    verifiedSignId: oldSign.id,
                    changeReason: `Superseded by verified sign #${newSignId}`,
                  }),
                );
              } else if (typeof this.dataSource?.query === 'function') {
                await this.dataSource.query(
                  "INSERT INTO verified_sign_history (verified_sign_id, change_reason) VALUES ($1, $2)",
                  [oldSign.id, `Superseded by verified sign #${newSignId}`],
                );
              }
            } catch {}

            if (this.revalidationTaskRepo && typeof this.revalidationTaskRepo.createQueryBuilder === 'function') {
              await this.revalidationTaskRepo
                .createQueryBuilder()
                .update(RevalidationTask)
                .set({ status: TaskStatus.COMPLETED })
                .where('verifiedSignId = :oldSignId', { oldSignId: oldSign.id })
                .andWhere("status IN ('OPEN', 'EVALUATING')")
                .execute();
            } else if (typeof this.dataSource?.query === 'function') {
              await this.dataSource.query(
                "UPDATE revalidation_tasks SET status = 'COMPLETED' WHERE verified_sign_id = $1 AND status IN ('OPEN', 'EVALUATING')",
                [oldSign.id],
              );
            }
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
          // Reputation-Weighted Review Reward Bonus Multiplier
          const relScore = profile ? Number(profile.reliabilityScore ?? profile.reliability_score ?? 100) : 100;
          const normalizedPct = relScore <= 1.0 ? relScore * 100 : relScore;
          const isScalingEnabled = this.paramService
            ? await this.paramService.getBoolean('reviewer.reward_scaling_enabled', true)
            : true;
          const floorPct = this.paramService
            ? await this.paramService.getNumber('reviewer.reward_scaling_floor_pct', 10.0)
            : 10.0;
          const effPct = isScalingEnabled ? Math.max(floorPct, normalizedPct) : 100;
          const multiplier = 0.5 + 0.5 * (effPct / 100);
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
      let surveyorId: string | null = null;
      if (this.submissionRepo && typeof this.submissionRepo.findOne === 'function') {
        const sub = await this.submissionRepo.findOne({
          where: { id: candidate.submissionId },
          select: ['surveyorId'],
        });
        if (sub) surveyorId = sub.surveyorId;
      }
      if (!surveyorId && typeof this.dataSource?.query === 'function') {
        const subRows: any[] = await this.dataSource.query('SELECT surveyor_id FROM survey_submissions WHERE id=$1', [
          candidate.submissionId,
        ]);
        if (subRows.length > 0 && subRows[0].surveyor_id) surveyorId = subRows[0].surveyor_id;
      }

      if (surveyorId) {
        if (this.surveyorProfileRepo && typeof this.surveyorProfileRepo.createQueryBuilder === 'function') {
          await this.surveyorProfileRepo
            .createQueryBuilder()
            .insert()
            .into(SurveyorProfile)
            .values({
              userId: surveyorId,
              totalSubmissions: 0,
              totalVerifiedSigns: 1,
              totalCreditsEarned: 0,
            })
            .onConflict('(user_id) DO UPDATE SET total_verified_signs = surveyor_profiles.total_verified_signs + 1')
            .execute();
        } else if (typeof this.dataSource?.query === 'function') {
          await this.dataSource.query(
            'INSERT INTO surveyor_profiles (user_id, total_submissions, total_verified_signs, total_credits_earned) VALUES ($1, 0, 1, 0) ON CONFLICT (user_id) DO UPDATE SET total_verified_signs = surveyor_profiles.total_verified_signs + 1',
            [surveyorId],
          );
        }
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
          const relScore = profile ? Number(profile.reliabilityScore ?? profile.reliability_score ?? 100) : 100;
          const normalizedPct = relScore <= 1.0 ? relScore * 100 : relScore;
          const isScalingEnabled = this.paramService
            ? await this.paramService.getBoolean('reviewer.reward_scaling_enabled', true)
            : true;
          const floorPct = this.paramService
            ? await this.paramService.getNumber('reviewer.reward_scaling_floor_pct', 10.0)
            : 10.0;
          const effPct = isScalingEnabled ? Math.max(floorPct, normalizedPct) : 100;
          const multiplier = 0.5 + 0.5 * (effPct / 100);
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
      if (this.moderationCaseRepo && typeof this.moderationCaseRepo.save === 'function') {
        await this.moderationCaseRepo.save(
          this.moderationCaseRepo.create({
            caseType: 'REVIEW_CONFLICT' as any,
            targetEntityType: 'unverified_sign_candidate',
            targetEntityId: candidate.id,
            status: 'PENDING' as any,
          }),
        );
      } else if (typeof this.dataSource?.query === 'function') {
        await this.dataSource.query(
          "INSERT INTO moderation_cases (id, case_type, target_entity_type, target_entity_id, status, created_at) VALUES (gen_random_uuid(), 'REVIEW_CONFLICT', 'unverified_sign_candidate', $1, 'PENDING', now())",
          [candidate.id],
        );
      }
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
      let r: any = null;
      if (this.reviewerProfileRepo && typeof this.reviewerProfileRepo.findOne === 'function') {
        r = await this.reviewerProfileRepo.findOne({ where: { userId: reviewerId } });
      }
      if (!r && typeof this.dataSource?.query === 'function') {
        const rows: any[] = await this.dataSource.query('SELECT * FROM reviewer_profiles WHERE user_id=$1', [reviewerId]);
        if (rows.length > 0) r = rows[0];
      }

      let oldScore = 100.0;
      let totalReviews = 0;
      let correctReviews = 0;
      let currentStreak = 0;
      let totalCorrectVotes = 0;
      let totalFalseVotes = 0;
      let consecutiveErrors = 0;

      if (r) {
        oldScore = Number(r.reliabilityScore ?? r.reliability_score ?? 100);
        totalReviews = Number(r.totalReviews ?? r.total_reviews ?? 0);
        correctReviews = Number(r.correctReviews ?? r.correct_reviews ?? 0);
        currentStreak = Number(r.currentStreak ?? r.current_streak ?? 0);
        totalCorrectVotes = Number(r.totalCorrectVotes ?? r.total_correct_votes ?? correctReviews);
        totalFalseVotes = Number(r.totalFalseVotes ?? r.total_false_votes ?? Math.max(0, totalReviews - correctReviews));
        consecutiveErrors = Number(r.consecutiveErrors ?? r.consecutive_errors ?? 0);
      } else {
        if (this.reviewerProfileRepo && typeof this.reviewerProfileRepo.createQueryBuilder === 'function') {
          await this.reviewerProfileRepo
            .createQueryBuilder()
            .insert()
            .into(ReviewerProfile)
            .values({
              userId: reviewerId,
              reliabilityScore: 100.0,
              totalReviews: 0,
              correctReviews: 0,
              accuracyRate: 0,
              currentStreak: 0,
              totalCorrectVotes: 0,
              totalFalseVotes: 0,
              consecutiveErrors: 0,
              isProvisional: true,
              isReviewSuspended: false,
            })
            .orIgnore()
            .execute();
        } else if (typeof this.dataSource?.query === 'function') {
          await this.dataSource.query(
            `INSERT INTO reviewer_profiles (
              user_id, reliability_score, total_reviews, correct_reviews, accuracy_rate, current_streak,
              total_correct_votes, total_false_votes, consecutive_errors, is_provisional, is_review_suspended
            ) VALUES ($1, 100.00, 0, 0, 0, 0, 0, 0, 0, true, false)
            ON CONFLICT (user_id) DO NOTHING`,
            [reviewerId],
          );
        }
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
      const provisionalErrorLimit = config.provisionalConsecutiveErrorLimit ?? 2;
      const provisionalMinReliability = config.provisionalMinReliabilityThreshold ?? 40.0;
      const provisionalAutoBanEnabled = config.provisionalAutoBanEnabled ?? true;

      let shouldAutoBan = false;
      let autoBanReason: string | null = null;

      if (isProvisional) {
        if (consecutiveErrors >= provisionalErrorLimit) {
          isSuspended = true;
          suspendedAt = new Date();
          const cooldownDays = config.suspensionCooldownDays ?? 7;
          suspendedUntil = provisionalAutoBanEnabled
            ? null
            : new Date(Date.now() + cooldownDays * 24 * 60 * 60 * 1000);
          suspensionReason = provisionalAutoBanEnabled
            ? 'PROVISIONAL_AUTOBAN_CONSECUTIVE_ERRORS'
            : 'CONSECUTIVE_ERRORS';
          if (provisionalAutoBanEnabled) {
            shouldAutoBan = true;
            autoBanReason = `Tự động khóa tài khoản mới (provisional): sai liên tiếp ${consecutiveErrors}/${provisionalErrorLimit} lần`;
          }
        } else if (totalVotes >= 2 && newScore < provisionalMinReliability) {
          isSuspended = true;
          suspendedAt = new Date();
          suspendedUntil = null;
          suspensionReason = provisionalAutoBanEnabled
            ? 'PROVISIONAL_AUTOBAN_LOW_RELIABILITY'
            : 'BELOW_MIN_RELIABILITY';
          if (provisionalAutoBanEnabled) {
            shouldAutoBan = true;
            autoBanReason = `Tự động khóa tài khoản mới (provisional): điểm uy tín ${newScore}% dưới ngưỡng ${provisionalMinReliability}%`;
          }
        }
      } else if (consecutiveErrors >= errorLimit) {
        isSuspended = true;
        suspendedAt = new Date();
        const cooldownDays = config.suspensionCooldownDays ?? 7;
        suspendedUntil = new Date(Date.now() + cooldownDays * 24 * 60 * 60 * 1000);
        suspensionReason = 'CONSECUTIVE_ERRORS';
      } else if (newScore < minReliability) {
        isSuspended = true;
        suspendedAt = new Date();
        suspendedUntil = null;
        suspensionReason = 'BELOW_MIN_RELIABILITY';
      }

      const newAccuracy = totalReviews > 0 ? Number((correctReviews / totalReviews).toFixed(4)) : 0;

      if (this.reviewerProfileRepo && typeof this.reviewerProfileRepo.update === 'function') {
        await this.reviewerProfileRepo.update(reviewerId, {
          reliabilityScore: newScore,
          totalCorrectVotes,
          totalFalseVotes,
          consecutiveErrors,
          isProvisional,
          isReviewSuspended: isSuspended,
          suspendedAt,
          suspendedUntil,
          suspensionReason,
          totalReviews,
          correctReviews,
          accuracyRate: newAccuracy,
          currentStreak,
          lastReviewedAt: new Date(),
          updatedAt: new Date(),
        });
      } else if (typeof this.dataSource?.query === 'function') {
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
      }

      if (this.reviewerHistoryRepo && typeof this.reviewerHistoryRepo.save === 'function') {
        await this.reviewerHistoryRepo.save(
          this.reviewerHistoryRepo.create({
            reviewerId,
            consensusLogId,
            oldScore,
            newScore,
            alignmentValue: aligned === 0.5 ? 0 : aligned === 1 ? 1 : -1,
          }),
        );
      } else if (typeof this.dataSource?.query === 'function') {
        await this.dataSource.query(
          `INSERT INTO reviewer_reliability_history (reviewer_id, consensus_log_id, old_score, new_score, alignment_value)
           VALUES ($1, $2, $3, $4, $5)`,
          [reviewerId, consensusLogId, oldScore, newScore, aligned === 0.5 ? 0 : aligned === 1 ? 1 : -1],
        );
      }

      let autoBanned = false;
      if (shouldAutoBan && typeof this.dataSource?.query === 'function') {
        try {
          const eligibleRows: Array<{ id: string; status: string }> = await this.dataSource.query(
            `SELECT u.id, u.status
             FROM users u
             WHERE u.id = $1
               AND u.status <> 'BANNED'
               AND NOT EXISTS (
                 SELECT 1 FROM user_roles ur
                 JOIN roles r ON r.id = ur.role_id
                 WHERE ur.user_id = u.id AND ur.is_active = true AND r.code IN ('ADMIN', 'STAFF')
               )
             LIMIT 1`,
            [reviewerId],
          );
          if (eligibleRows && eligibleRows.length > 0) {
            const oldStatus = eligibleRows[0].status;
            await this.dataSource.query(
              `UPDATE users SET status = 'BANNED', updated_at = now() WHERE id = $1`,
              [reviewerId],
            );
            await this.dataSource.query(
              `INSERT INTO user_status_history (user_id, old_status, new_status, reason, changed_by)
               VALUES ($1, $2, 'BANNED', $3, NULL)`,
              [reviewerId, oldStatus, autoBanReason],
            );
            await this.dataSource.query(
              `INSERT INTO audit_logs (user_id, action, resource_name, resource_id, old_values, new_values)
               VALUES (NULL, 'AUTO_BAN_PROVISIONAL_REVIEWER', 'users', $1, $2, $3)`,
              [
                reviewerId,
                JSON.stringify({ status: oldStatus }),
                JSON.stringify({
                  status: 'BANNED',
                  reason: autoBanReason,
                  reliabilityScore: newScore,
                  consecutiveErrors,
                  totalVotes,
                }),
              ],
            );
            autoBanned = true;
            if (this.notificationsService && typeof this.notificationsService.create === 'function') {
              await this.notificationsService
                .create(
                  reviewerId,
                  'ACCOUNT_AUTOBANNED',
                  'Tài khoản đã bị khóa tự động',
                  autoBanReason || 'Tài khoản mới vi phạm ngưỡng uy tín / chuỗi đánh giá sai.',
                  'user',
                  reviewerId,
                )
                .catch(() => {});
            }
          }
        } catch (banErr: any) {
          this.logger.warn('Auto-ban provisional reviewer ' + reviewerId + ' failed: ' + banErr?.message);
        }
      }

      return {
        user_id: reviewerId,
        reliability_score: newScore,
        total_correct_votes: totalCorrectVotes,
        total_false_votes: totalFalseVotes,
        consecutive_errors: consecutiveErrors,
        is_provisional: isProvisional,
        is_review_suspended: isSuspended,
        suspension_reason: suspensionReason,
        auto_banned: autoBanned,
        auto_ban_reason: autoBanned ? autoBanReason : null,
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
      const outcomeText: Record<string, string> = {
        APPROVED: 'đã được chấp thuận',
        REJECTED: 'đã bị từ chối',
        ESCALATED: 'đã được chuyển đến bộ phận kiểm duyệt',
      };
      const voteText = (vote: number) => (vote === 1 ? 'chấp thuận' : 'từ chối');
      const notifs = voterDetails.map((v) => ({
        userId: v.reviewerId,
        type: 'CONSENSUS_RESOLVED',
        title: 'Ứng viên ' + (outcomeText[outcomeLabel] ?? outcomeLabel),
        message:
          'Phiếu đánh giá (' +
          voteText(v.vote) +
          ') của bạn cho ứng viên ' +
          candidate.id.slice(0, 8) +
          '... có kết quả: ' +
          (outcomeText[outcomeLabel] ?? outcomeLabel) +
          '.',
        relatedEntityType: 'consensus_log',
        relatedEntityId: logId,
      }));
      if (notifs.length) await this.notificationsService.createBulk(notifs as any);
    } catch {}
  }

  /**
   * Degraded Consensus Calculation Worker
   * Evaluates stale unfinalized candidates exceeding degraded timeout with minimum votes.
   */
  async checkDegradedConsensus(): Promise<{ processedCount: number; approvedCount: number }> {
    const isDegradedEnabled = this.paramService
      ? await this.paramService.getBoolean('consensus.degraded_consensus_enabled', true)
      : true;
    if (!isDegradedEnabled) return { processedCount: 0, approvedCount: 0 };

    const timeoutHours = this.paramService
      ? await this.paramService.getNumber('consensus.degraded_timeout_hours', 48)
      : 48;
    const minVotes = this.paramService
      ? await this.paramService.getNumber('consensus.degraded_min_votes', 1)
      : 1;
    const threshold = this.paramService
      ? await this.paramService.getNumber('consensus.min_votes_required', 3)
      : 3;

    const staleCandidates = await this.candidateRepo
      .createQueryBuilder('c')
      .where("c.status IN ('PENDING_REVIEW', 'IN_CONSENSUS')")
      .andWhere("c.first_voted_at < NOW() - INTERVAL '1 hour' * :timeoutHours", { timeoutHours })
      .andWhere('c.votes_count >= :minVotes', { minVotes })
      .getMany();

    let approvedCount = 0;
    for (const candidate of staleCandidates) {
      const reviews = await this.reviewRepo.find({ where: { candidateId: candidate.id } });
      if (reviews.length === 0) continue;

      const n = reviews.length;
      const ratio = Math.min(1.0, n / threshold);

      let sumScore = 0;
      for (const r of reviews) sumScore += r.vote;
      const isApproved = sumScore > 0;

      if (isApproved) {
        const defaultLifetime = 30; // standard freshness days
        const effectiveLifetime = Math.max(3, Math.round(defaultLifetime * ratio));

        await this.candidateRepo.update(candidate.id, { status: CandidateStatus.VERIFIED });

        if (this.dataSource && typeof this.dataSource.query === 'function') {
          await this.dataSource.query(
            `INSERT INTO verified_traffic_signs (
               id, sign_type_id, origin_candidate_id, location,
               sign_crop_url, status, freshness_score, last_verified_at,
               lifetime_multiplier, effective_lifetime_days, degraded_consensus_ratio
             ) SELECT
               gen_random_uuid(), c.predicted_sign_type_id, c.id,
               COALESCE(cge.sign_location, ST_SetSRID(ST_MakePoint(105.85, 21.02), 4326)),
               c.sign_crop_url, 'ACTIVE', 1, now(),
               $1, $2, $3
             FROM unverified_sign_candidates c
             LEFT JOIN candidate_geo_estimations cge ON c.id = cge.candidate_id
             WHERE c.id = $4
             ON CONFLICT (origin_candidate_id) DO NOTHING`,
            [ratio, effectiveLifetime, ratio, candidate.id],
          );
        }
        approvedCount++;
      } else {
        await this.candidateRepo.update(candidate.id, { status: CandidateStatus.REJECTED });
      }
    }

    if (staleCandidates.length > 0) {
      this.logger.log(`Degraded consensus processed ${staleCandidates.length} candidates (${approvedCount} approved).`);
    }

    return { processedCount: staleCandidates.length, approvedCount };
  }
}
