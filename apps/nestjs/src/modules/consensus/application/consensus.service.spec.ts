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
      expect.stringContaining("VALUES ($1,'PUBLISHED'"),
      ['verified-sign-id'],
    );
  });
});
