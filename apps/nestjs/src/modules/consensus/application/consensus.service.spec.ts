import { DataSource, Repository } from 'typeorm';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  CandidateStatus,
  UnverifiedSignCandidate,
} from '../../survey/infrastructure/persistence/unverified-sign-candidate.entity';
import { WalletService } from '../../wallet/application/wallet.service';
import { CandidateReview } from '../../reviews/infrastructure/persistence/candidate-review.entity';
import { ConsensusConfig } from '../infrastructure/persistence/consensus-config.entity';
import { ConsensusLog } from '../infrastructure/persistence/consensus-log.entity';
import { ConsensusService } from './consensus.service';

describe('ConsensusService', () => {
  it('binds the verified sign ID when recording a publication event', async () => {
    const configRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 1,
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
        provisionalVoteWeight: 0.5,
      }),
    } as unknown as Repository<ConsensusConfig>;
    const logRepo = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ ...value, id: 'log-id' })),
    } as unknown as Repository<ConsensusLog>;
    const candidateRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'candidate-id',
        status: CandidateStatus.PENDING_REVIEW,
        predictedSignTypeId: 10,
        signCropUrl: 'sign.jpg',
        submissionId: 'submission-id',
      }),
      update: jest.fn().mockResolvedValue(undefined),
    } as unknown as Repository<UnverifiedSignCandidate>;
    const reviewRepo = {
      find: jest.fn().mockResolvedValue([
        {
          reviewerId: 'reviewer-id',
          vote: 1,
          suggestedSignTypeId: null,
        },
        {
          reviewerId: 'reviewer-2',
          vote: -1,
          suggestedSignTypeId: null,
        },
      ]),
    } as unknown as Repository<CandidateReview>;
    const query = jest.fn(async (sql: string, params?: any[]) => {
      if (sql.includes('SELECT reliability_score')) {
        if (params?.[0] === 'reviewer-2') {
          return [{ reliability_score: 10, is_provisional: false, total_correct_votes: 10, total_false_votes: 0 }];
        }
        return [{ reliability_score: 100, is_provisional: false, total_correct_votes: 10, total_false_votes: 0 }];
      }
      if (sql.includes('candidate_geo_estimations')) {
        return [{ sign_wkt: 'POINT(106.80 10.85)', traffic_direction: 90 }];
      }
      if (sql.includes('SELECT id FROM verified_traffic_signs')) {
        return [{ id: 'verified-sign-id' }];
      }
      return [];
    });
    const wallet = {
      resolveRewardAmount: jest.fn().mockResolvedValue(5),
      creditUser: jest.fn().mockResolvedValue({ walletId: 'w-1', newBalance: 105, txId: 'tx-1' }),
    } as unknown as WalletService;
    const notifications = {
      createBulk: jest.fn().mockResolvedValue(undefined),
    } as unknown as NotificationsService;
    const dailyTasks = {
      recordVerifiedSign: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ConsensusService(
      configRepo,
      logRepo,
      candidateRepo,
      reviewRepo,
      { query } as unknown as DataSource,
      wallet,
      notifications,
      undefined,
      undefined,
      dailyTasks as any,
    );

    await service.evaluate('candidate-id');

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("VALUES ($1,'PUBLISHED'"),
      ['verified-sign-id'],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE reviewer_profiles SET'),
      expect.arrayContaining([100, 1, 0, 0, true, false, 'reviewer-id']),
    );
    expect(dailyTasks.recordVerifiedSign).toHaveBeenCalledWith('reviewer-id', 'candidate-id');
    expect(dailyTasks.recordVerifiedSign).toHaveBeenCalledWith('reviewer-2', 'candidate-id');
  });

  it('resolves spatial address fields when spatialAdminService is provided', async () => {
    const configRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 1,
        approvalThreshold: 0.5,
        rejectionThreshold: -0.5,
        minVotesRequired: 1,
        alphaSmoothingFactor: 0.1,
      }),
    } as unknown as Repository<ConsensusConfig>;
    const logRepo = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ ...value, id: 'log-id' })),
    } as unknown as Repository<ConsensusLog>;
    const candidateRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'candidate-id',
        status: CandidateStatus.PENDING_REVIEW,
        predictedSignTypeId: 10,
        signCropUrl: 'sign.jpg',
        submissionId: 'submission-id',
      }),
      update: jest.fn().mockResolvedValue(undefined),
    } as unknown as Repository<UnverifiedSignCandidate>;
    const reviewRepo = {
      find: jest.fn().mockResolvedValue([
        {
          reviewerId: 'reviewer-id',
          vote: 1,
          suggestedSignTypeId: null,
        },
      ]),
    } as unknown as Repository<CandidateReview>;
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('SELECT reliability_score')) {
        return [{ reliability_score: 1 }];
      }
      if (sql.includes('candidate_geo_estimations')) {
        return [{ sign_wkt: 'POINT(106.80 10.85)', traffic_direction: 90 }];
      }
      if (sql.includes('SELECT id FROM verified_traffic_signs')) {
        return [{ id: 'verified-sign-id' }];
      }
      return [];
    });
    const wallet = {
      resolveRewardAmount: jest.fn().mockResolvedValue(5),
      creditUser: jest.fn().mockResolvedValue(undefined),
    } as unknown as WalletService;
    const notifications = {
      createBulk: jest.fn().mockResolvedValue(undefined),
    } as unknown as NotificationsService;
    const spatialAdmin = {
      resolveLocation: jest.fn().mockResolvedValue({
        latitude: 10.85,
        longitude: 106.80,
        communeCode: '26804',
        roadName: 'Xa lộ Hà Nội',
        displayAddress: 'Xa lộ Hà Nội, Phường Long Thạnh Mỹ, Thành phố Hồ Chí Minh',
      }),
    };

    const service = new ConsensusService(
      configRepo,
      logRepo,
      candidateRepo,
      reviewRepo,
      { query } as unknown as DataSource,
      wallet,
      notifications,
      spatialAdmin as any,
    );

    await service.evaluate('candidate-id');

    expect(spatialAdmin.resolveLocation).toHaveBeenCalledWith(10.85, 106.80);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('commune_code, road_name, display_address'),
      expect.arrayContaining(['26804', 'Xa lộ Hà Nội', 'Xa lộ Hà Nội, Phường Long Thạnh Mỹ, Thành phố Hồ Chí Minh']),
    );
  });

  it('supersedes older active signs within 5 meters and completes their revalidation tasks when a new sign is approved', async () => {
    const configRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 1,
        approvalThreshold: 0.5,
        rejectionThreshold: -0.5,
        minVotesRequired: 1,
        alphaSmoothingFactor: 0.1,
      }),
    } as unknown as Repository<ConsensusConfig>;
    const logRepo = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ ...value, id: 'log-id' })),
    } as unknown as Repository<ConsensusLog>;
    const candidateRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'candidate-id',
        status: CandidateStatus.PENDING_REVIEW,
        predictedSignTypeId: 10,
        signCropUrl: 'sign.jpg',
        submissionId: 'submission-id',
      }),
      update: jest.fn().mockResolvedValue(undefined),
    } as unknown as Repository<UnverifiedSignCandidate>;
    const reviewRepo = {
      find: jest.fn().mockResolvedValue([
        { reviewerId: 'reviewer-id', vote: 1, suggestedSignTypeId: null },
      ]),
    } as unknown as Repository<CandidateReview>;
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('SELECT reliability_score')) {
        return [{ reliability_score: 100, is_provisional: false, total_correct_votes: 10, total_false_votes: 0 }];
      }
      if (sql.includes('candidate_geo_estimations')) {
        return [{ sign_wkt: 'POINT(106.80 10.85)', traffic_direction: 90 }];
      }
      if (sql.includes('SELECT id FROM verified_traffic_signs') && !sql.includes('ST_DWithin')) {
        return [{ id: 'new-sign-id' }];
      }
      if (sql.includes('ST_DWithin')) {
        return [{ id: 'old-sign-1' }];
      }
      return [];
    });
    const wallet = {
      resolveRewardAmount: jest.fn().mockResolvedValue(5),
      creditUser: jest.fn().mockResolvedValue(undefined),
    } as unknown as WalletService;
    const notifications = {
      createBulk: jest.fn().mockResolvedValue(undefined),
    } as unknown as NotificationsService;

    const service = new ConsensusService(
      configRepo,
      logRepo,
      candidateRepo,
      reviewRepo,
      { query } as unknown as DataSource,
      wallet,
      notifications,
    );

    await service.evaluate('candidate-id');

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE verified_traffic_signs SET status = 'DECOMMISSIONED'"),
      ['old-sign-1'],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO verified_sign_history'),
      ['old-sign-1', 'Superseded by verified sign #new-sign-id'],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE revalidation_tasks SET status = 'COMPLETED' WHERE verified_sign_id = $1"),
      ['old-sign-1'],
    );
  });

  describe('Phase 4: Reviewer Reliability Formula & Governance Tests', () => {
    let service: ConsensusService;
    let query: jest.Mock;

    beforeEach(() => {
      query = jest.fn().mockResolvedValue([]);
      service = new ConsensusService(
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        { query } as unknown as DataSource,
        {} as any,
        {} as any,
      );
    });

    it('calculates reliability formula (x*C)/(x*C + y*F) * 100 with x=1.0, y=2.0', async () => {
      // User with 4 correct votes and 2 false votes:
      // (1*4) / (1*4 + 2*2) * 100 = 4 / 8 * 100 = 50.00%
      query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT * FROM reviewer_profiles')) {
          return [
            {
              reliability_score: 66.67,
              total_correct_votes: 3,
              total_false_votes: 2,
              consecutive_errors: 0,
              total_reviews: 5,
              correct_reviews: 3,
            },
          ];
        }
        return [];
      });

      const config: any = {
        weightCorrect: 1.0,
        penaltyFalse: 2.0,
        minSampleBaseline: 5,
        minReliabilityThreshold: 50.0,
        consecutiveErrorLimit: 3,
        suspensionCooldownDays: 7,
      };

      const result = await service.updateReviewerProfile('u-1', 1, config, 'log-1');

      expect(result.reliability_score).toBe(50.0);
      expect(result.total_correct_votes).toBe(4);
      expect(result.total_false_votes).toBe(2);
      expect(result.is_provisional).toBe(false);
      expect(result.is_review_suspended).toBe(false);
    });

    it('sets is_provisional = true when total votes < 5', async () => {
      query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT * FROM reviewer_profiles')) {
          return [
            {
              reliability_score: 100.0,
              total_correct_votes: 2,
              total_false_votes: 0,
              consecutive_errors: 0,
              total_reviews: 2,
              correct_reviews: 2,
            },
          ];
        }
        return [];
      });

      const config: any = {
        weightCorrect: 1.0,
        penaltyFalse: 2.0,
        minSampleBaseline: 5,
        minReliabilityThreshold: 50.0,
      };

      const result = await service.updateReviewerProfile('u-1', 1, config, 'log-1');

      expect(result.total_correct_votes).toBe(3);
      expect(result.is_provisional).toBe(true);
      expect(result.is_review_suspended).toBe(false);
    });

    it('triggers automated suspension when N >= 5 and reliability < 50%', async () => {
      // Current: 3 correct, 2 false (total 5).
      // Misaligned review (aligned = 0):
      // total_false becomes 3. Total votes = 6.
      // (1*3) / (1*3 + 2*3) * 100 = 3 / 9 * 100 = 33.33% < 50%
      query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT * FROM reviewer_profiles')) {
          return [
            {
              reliability_score: 50.0,
              total_correct_votes: 3,
              total_false_votes: 2,
              consecutive_errors: 1,
              total_reviews: 5,
              correct_reviews: 3,
            },
          ];
        }
        return [];
      });

      const config: any = {
        weightCorrect: 1.0,
        penaltyFalse: 2.0,
        minSampleBaseline: 5,
        minReliabilityThreshold: 50.0,
        consecutiveErrorLimit: 5,
      };

      const result = await service.updateReviewerProfile('u-1', 0, config, 'log-1');

      expect(result.reliability_score).toBe(33.33);
      expect(result.is_provisional).toBe(false);
      expect(result.is_review_suspended).toBe(true);
      expect(result.suspension_reason).toBe('BELOW_MIN_RELIABILITY');
    });

    it('triggers consecutive error cooldown suspension on >= 3 consecutive errors', async () => {
      // Current: 2 consecutive errors. Misaligned review -> 3 consecutive errors.
      query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT * FROM reviewer_profiles')) {
          return [
            {
              reliability_score: 80.0,
              total_correct_votes: 8,
              total_false_votes: 1,
              consecutive_errors: 2,
              total_reviews: 9,
              correct_reviews: 8,
            },
          ];
        }
        return [];
      });

      const config: any = {
        weightCorrect: 1.0,
        penaltyFalse: 2.0,
        minSampleBaseline: 5,
        minReliabilityThreshold: 50.0,
        consecutiveErrorLimit: 3,
        suspensionCooldownDays: 7,
      };

      const result = await service.updateReviewerProfile('u-1', 0, config, 'log-1');

      expect(result.consecutive_errors).toBe(3);
      expect(result.is_review_suspended).toBe(true);
      expect(result.suspension_reason).toBe('CONSECUTIVE_ERRORS');
    });

    it('resets consecutive errors on aligned vote', async () => {
      query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT * FROM reviewer_profiles')) {
          return [
            {
              reliability_score: 80.0,
              total_correct_votes: 8,
              total_false_votes: 1,
              consecutive_errors: 2,
              total_reviews: 9,
              correct_reviews: 8,
            },
          ];
        }
        return [];
      });

      const config: any = {
        weightCorrect: 1.0,
        penaltyFalse: 2.0,
        minSampleBaseline: 5,
        minReliabilityThreshold: 50.0,
        consecutiveErrorLimit: 3,
      };

      const result = await service.updateReviewerProfile('u-1', 1, config, 'log-1');

      expect(result.consecutive_errors).toBe(0);
      expect(result.is_review_suspended).toBe(false);
    });
  });
});
