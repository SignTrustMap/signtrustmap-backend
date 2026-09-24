import { ForbiddenException } from '@nestjs/common';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { TrafficSignType } from '../../catalog/traffic-sign-type.entity';
import { ConsensusService } from '../../consensus/application/consensus.service';
import {
  CandidateStatus,
  UnverifiedSignCandidate,
} from '../../survey/infrastructure/persistence/unverified-sign-candidate.entity';
import { CandidateReview } from '../infrastructure/persistence/candidate-review.entity';
import { ReviewsService } from './reviews.service';

describe('ReviewsService queue', () => {
  it('excludes candidates already reviewed by the current reviewer and candidates uploaded by reviewer', async () => {
    const query = {
      addOrderBy: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[{ id: 'candidate-1' }], 1]),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    } as unknown as SelectQueryBuilder<UnverifiedSignCandidate>;
    const candidates = {
      createQueryBuilder: jest.fn().mockReturnValue(query),
    } as unknown as Repository<UnverifiedSignCandidate>;
    const service = new ReviewsService(
      candidates,
      {} as Repository<CandidateReview>,
      {} as Repository<TrafficSignType>,
      {} as ConsensusService,
    );

    await expect(service.queue('reviewer-1', 1, 20)).resolves.toMatchObject({
      items: [{ id: 'candidate-1' }],
      total: 1,
    });
    expect(query.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('submission.surveyor_id'),
      { reviewerId: 'reviewer-1' },
    );
    expect(query.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('review.reviewer_id = :reviewerId'),
      { reviewerId: 'reviewer-1' },
    );
    expect(query.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('moderation_action.performed_by = :reviewerId'),
      { reviewerId: 'reviewer-1' },
    );
    expect(query.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('reviewer_skipped_candidates'),
      { reviewerId: 'reviewer-1' },
    );
  });

  it('skipCandidate records the skip in database', async () => {
    const rawQuery = jest.fn().mockResolvedValue([]);
    const candidates = {
      findOne: jest.fn().mockResolvedValue({ id: 'candidate-99' }),
      manager: { query: rawQuery },
    } as unknown as Repository<UnverifiedSignCandidate>;
    const service = new ReviewsService(
      candidates,
      {} as Repository<CandidateReview>,
      {} as Repository<TrafficSignType>,
      {} as ConsensusService,
    );

    const result = await service.skipCandidate('reviewer-1', 'candidate-99');
    expect(result).toEqual({ skipped: true, candidateId: 'candidate-99', reviewerId: 'reviewer-1' });
    expect(rawQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO reviewer_skipped_candidates'),
      ['reviewer-1', 'candidate-99'],
    );
  });
});

describe('ReviewsService vote', () => {
  it('throws ForbiddenException when reviewer is the surveyor who uploaded the submission', async () => {
    const candidates = {
      findOne: jest.fn().mockResolvedValue({
        id: 'cand-1',
        status: CandidateStatus.PENDING_REVIEW,
        submission: { surveyorId: 'reviewer-1' },
      }),
    } as unknown as Repository<UnverifiedSignCandidate>;
    const reviews = {
      findOne: jest.fn().mockResolvedValue(null),
    } as unknown as Repository<CandidateReview>;
    const service = new ReviewsService(
      candidates,
      reviews,
      {} as Repository<TrafficSignType>,
      {} as ConsensusService,
    );

    await expect(
      service.vote('reviewer-1', 'cand-1', { vote: 1 }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows voting when reviewer is not the surveyor who uploaded the submission', async () => {
    const candidate = {
      id: 'cand-1',
      status: CandidateStatus.PENDING_REVIEW,
      submission: { surveyorId: 'other-surveyor' },
    };
    const candidates = {
      findOne: jest.fn().mockResolvedValue(candidate),
    } as unknown as Repository<UnverifiedSignCandidate>;
    const createdReview = { id: 'rev-1', vote: 1 };
    const reviews = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockReturnValue(createdReview),
      save: jest.fn().mockResolvedValue(createdReview),
    } as unknown as Repository<CandidateReview>;
    const consensus = {
      evaluate: jest.fn().mockResolvedValue({ id: 'log-1' }),
    } as unknown as ConsensusService;
    const service = new ReviewsService(
      candidates,
      reviews,
      {} as Repository<TrafficSignType>,
      consensus,
    );

    const result = await service.vote('reviewer-1', 'cand-1', { vote: 1 });
    expect(result).toEqual({
      review: createdReview,
      consensusLog: { id: 'log-1' },
    });
    expect(reviews.create).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateId: 'cand-1',
        reviewerId: 'reviewer-1',
        vote: 1,
      }),
    );
  });
});
