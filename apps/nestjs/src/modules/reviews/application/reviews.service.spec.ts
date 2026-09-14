import { Repository, SelectQueryBuilder } from 'typeorm';
import { TrafficSignType } from '../../catalog/traffic-sign-type.entity';
import { ConsensusService } from '../../consensus/application/consensus.service';
import { UnverifiedSignCandidate } from '../../survey/infrastructure/persistence/unverified-sign-candidate.entity';
import { CandidateReview } from '../infrastructure/persistence/candidate-review.entity';
import { ReviewsService } from './reviews.service';

describe('ReviewsService queue', () => {
  it('excludes candidates already reviewed by the current reviewer', async () => {
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
