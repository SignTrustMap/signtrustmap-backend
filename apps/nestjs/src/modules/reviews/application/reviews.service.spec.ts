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

  it('throws ForbiddenException when reviewer is suspended', async () => {
    const rawQuery = jest.fn().mockResolvedValue([
      {
        user_id: 'suspended-user',
        is_review_suspended: true,
        suspended_until: new Date(Date.now() + 86400000), // tomorrow
        suspension_reason: 'BELOW_MIN_RELIABILITY',
      },
    ]);
    const candidate = {
      id: 'cand-1',
      status: CandidateStatus.PENDING_REVIEW,
      submission: { surveyorId: 'other-surveyor' },
    };
    const candidates = {
      findOne: jest.fn().mockResolvedValue(candidate),
      manager: { query: rawQuery },
    } as unknown as Repository<UnverifiedSignCandidate>;

    const service = new ReviewsService(
      candidates,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      service.vote('suspended-user', 'cand-1', { vote: 1 }),
    ).rejects.toThrow('REVIEW_PRIVILEGES_SUSPENDED: BELOW_MIN_RELIABILITY');
  });

  it('automatically lifts suspension when cooldown period has expired', async () => {
    const rawQuery = jest.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT * FROM reviewer_profiles')) {
        return [
          {
            user_id: 'cooldown-user',
            is_review_suspended: true,
            suspended_until: new Date(Date.now() - 86400000), // yesterday
            suspension_reason: 'CONSECUTIVE_ERRORS',
          },
        ];
      }
      return [];
    });
    const candidate = {
      id: 'cand-1',
      status: CandidateStatus.PENDING_REVIEW,
      submission: { surveyorId: 'other-surveyor' },
    };
    const candidates = {
      findOne: jest.fn().mockResolvedValue(candidate),
      manager: { query: rawQuery },
    } as unknown as Repository<UnverifiedSignCandidate>;
    const createdReview = { id: 'rev-1', vote: 1 };
    const reviews = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockReturnValue(createdReview),
      save: jest.fn().mockResolvedValue(createdReview),
    } as unknown as Repository<CandidateReview>;
    const consensus = {
      evaluate: jest.fn().mockResolvedValue(null),
    } as unknown as ConsensusService;

    const service = new ReviewsService(
      candidates,
      reviews,
      {} as any,
      consensus,
    );

    const result = await service.vote('cooldown-user', 'cand-1', { vote: 1 });
    expect(result.review).toEqual(createdReview);
    expect(rawQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE reviewer_profiles'),
      ['cooldown-user'],
    );
  });
});

describe('ReviewsService getMyStats (Phase 4 Governance)', () => {
  it('returns Phase 4 reliability governance statistics', async () => {
    const rawQuery = jest.fn().mockResolvedValue([
      {
        user_id: 'rev-1',
        reliability_score: 92.5,
        total_correct_votes: 37,
        total_false_votes: 3,
        consecutive_errors: 0,
        is_provisional: false,
        is_review_suspended: false,
      },
    ]);
    const candidates = {
      manager: { query: rawQuery },
    } as unknown as Repository<UnverifiedSignCandidate>;
    const reviews = {
      count: jest.fn().mockResolvedValue(40),
      find: jest.fn().mockResolvedValue([]),
    } as unknown as Repository<CandidateReview>;

    const service = new ReviewsService(
      candidates,
      reviews,
      {} as any,
      {} as any,
    );

    const stats = await service.getMyStats('rev-1');
    expect(stats.reliabilityScore).toBe(92.5);
    expect(stats.totalCorrect).toBe(37);
    expect(stats.totalFalse).toBe(3);
    expect(stats.isProvisional).toBe(false);
    expect(stats.isSuspended).toBe(false);
    expect(stats.consecutiveErrors).toBe(0);
  });
});

describe('ReviewsService undoVote', () => {
  it('throws NotFoundException if no vote exists', async () => {
    const reviews = {
      findOne: jest.fn().mockResolvedValue(null),
    } as unknown as Repository<CandidateReview>;
    const service = new ReviewsService({} as any, reviews, {} as any, {} as any);
    await expect(service.undoVote('rev-1', 'c-1')).rejects.toThrow();
  });

  it('throws BadRequestException if candidate already finalized', async () => {
    const reviews = {
      findOne: jest.fn().mockResolvedValue({ id: 'r-1' }),
    } as unknown as Repository<CandidateReview>;
    const candidates = {
      findOne: jest.fn().mockResolvedValue({ id: 'c-1', status: CandidateStatus.VERIFIED }),
    } as unknown as Repository<UnverifiedSignCandidate>;
    const service = new ReviewsService(candidates, reviews, {} as any, {} as any);
    await expect(service.undoVote('rev-1', 'c-1')).rejects.toThrow();
  });

  it('deletes review when candidate is still in review', async () => {
    const reviews = {
      findOne: jest.fn().mockResolvedValue({ id: 'r-1' }),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    } as unknown as Repository<CandidateReview>;
    const candidates = {
      findOne: jest.fn().mockResolvedValue({ id: 'c-1', status: CandidateStatus.PENDING_REVIEW }),
    } as unknown as Repository<UnverifiedSignCandidate>;
    const service = new ReviewsService(candidates, reviews, {} as any, {} as any);
    const res = await service.undoVote('rev-1', 'c-1');
    expect(res).toEqual({ undone: true, candidateId: 'c-1', reviewerId: 'rev-1' });
    expect(reviews.delete).toHaveBeenCalledWith({ candidateId: 'c-1', reviewerId: 'rev-1' });
  });
});

describe('ReviewsService reportCandidate', () => {
  it('rejects empty reason or missing candidate', async () => {
    const service = new ReviewsService({ findOne: jest.fn().mockResolvedValue(null) } as any, {} as any, {} as any, {} as any);
    await expect(service.reportCandidate('rev-1', 'c-1', { reason: '' })).rejects.toThrow();
    await expect(service.reportCandidate('rev-1', 'c-1', { reason: 'suspicious' })).rejects.toThrow();
  });

  it('creates moderation case if not already reported', async () => {
    const rawQuery = jest.fn()
      .mockResolvedValueOnce([]) // not already reported
      .mockResolvedValueOnce([{ id: 'case-1' }]) // insert moderation case
      .mockResolvedValueOnce([]) // insert action
      .mockResolvedValueOnce([]); // insert flag
    const candidates = {
      findOne: jest.fn().mockResolvedValue({ id: 'c-1' }),
      manager: { query: rawQuery },
    } as unknown as Repository<UnverifiedSignCandidate>;
    const service = new ReviewsService(candidates, {} as any, {} as any, {} as any);
    const res = await service.reportCandidate('rev-1', 'c-1', { reason: 'Spam sign' });
    expect(res).toBeDefined();
    expect(rawQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO moderation_cases'),
      ['c-1'],
    );
  });
});

describe('ReviewsService test helpers', () => {
  it('testReviewCandidate prepares profile, records vote, and triggers single-reviewer consensus', async () => {
    const rawQuery = jest.fn().mockResolvedValue([]);
    const candidate = {
      id: 'cand-test-1',
      status: CandidateStatus.PENDING_REVIEW,
      submission: { surveyorId: 'rev-test-1' }, // same as reviewer (self-review testing)
    };
    const candidates = {
      findOne: jest.fn().mockResolvedValue(candidate),
      update: jest.fn().mockResolvedValue(undefined),
      manager: { query: rawQuery },
    } as unknown as Repository<UnverifiedSignCandidate>;
    const reviews = {
      delete: jest.fn().mockResolvedValue(undefined),
      create: jest.fn((val) => val),
      save: jest.fn(async (val) => ({ ...val, id: 'review-1' })),
    } as unknown as Repository<CandidateReview>;
    const consensus = {
      evaluate: jest.fn().mockResolvedValue({ id: 'log-test-1', finalOutcome: 'APPROVED' }),
    } as unknown as ConsensusService;

    const service = new ReviewsService(candidates, reviews, {} as any, consensus);

    const result = await service.testReviewCandidate('cand-test-1', 'rev-test-1', {
      vote: 1,
      suggestedSignTypeId: 5,
    });

    expect(result.success).toBe(true);
    expect(result.candidateId).toBe('cand-test-1');
    expect(result.reviewerId).toBe('rev-test-1');
    expect(result.consensusLog).toEqual({ id: 'log-test-1', finalOutcome: 'APPROVED' });
    expect(rawQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO reviewer_profiles'),
      ['rev-test-1'],
    );
    expect(reviews.delete).toHaveBeenCalledWith({ candidateId: 'cand-test-1', reviewerId: 'rev-test-1' });
    expect(consensus.evaluate).toHaveBeenCalledWith('cand-test-1');
  });

  it('directCandidatesToReviewer resets candidate status and clears skips/reviews for reviewer', async () => {
    const rawQuery = jest.fn().mockResolvedValue([]);
    const candidates = {
      find: jest.fn().mockResolvedValue([{ id: 'c-1' }, { id: 'c-2' }]),
      manager: { query: rawQuery },
    } as unknown as Repository<UnverifiedSignCandidate>;

    const service = new ReviewsService(candidates, {} as any, {} as any, {} as any);

    const result = await service.directCandidatesToReviewer('rev-test-1', ['c-1', 'c-2']);

    expect(result.success).toBe(true);
    expect(result.assignedCount).toBe(2);
    expect(rawQuery).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM reviewer_skipped_candidates'),
      ['rev-test-1', ['c-1', 'c-2']],
    );
    expect(rawQuery).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM candidate_reviews'),
      ['rev-test-1', ['c-1', 'c-2']],
    );
    expect(rawQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE unverified_sign_candidates SET status = 'PENDING_REVIEW'"),
      [['c-1', 'c-2']],
    );
  });
});

