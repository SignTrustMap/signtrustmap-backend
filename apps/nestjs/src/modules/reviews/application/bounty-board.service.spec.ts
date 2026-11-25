import { BountyBoardService } from './bounty-board.service';
import {
  QuestTargetType,
  QuestClaimStatus,
} from '../infrastructure/persistence/reviewer-quest-claim.entity';
import { BadRequestException } from '@nestjs/common';

describe('BountyBoardService', () => {
  let service: BountyBoardService;
  let questRepo: any;
  let candidateRepo: any;
  let taskRepo: any;
  let profileRepo: any;
  let paramService: any;
  let dataSource: any;

  beforeEach(async () => {
    questRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn((dto: any) => ({ ...dto, id: 'claim-uuid-1' })),
      save: jest.fn(async (entity: any) => entity),
      createQueryBuilder: jest.fn(),
    };

    candidateRepo = {
      findOne: jest.fn().mockResolvedValue(null),
    };

    taskRepo = {
      findOne: jest.fn().mockResolvedValue(null),
    };

    profileRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue(undefined),
    };

    paramService = {
      getNumber: jest.fn((key: string, def: number) => {
        if (key === 'reviewer.quest_time_limit_minutes') return Promise.resolve(120);
        if (key === 'reviewer.max_active_claims_per_user') return Promise.resolve(3);
        if (key === 'reviewer.quest_timeout_penalty_score') return Promise.resolve(5.0);
        return Promise.resolve(def);
      }),
      getBoolean: jest.fn().mockResolvedValue(true),
    };

    dataSource = {
      query: jest.fn().mockResolvedValue([]),
    };

    service = new BountyBoardService(
      questRepo,
      candidateRepo,
      taskRepo,
      profileRepo,
      paramService,
      dataSource,
    );
  });

  describe('claimQuest', () => {
    it('successfully claims candidate validation quest and sets 120-minute expiry', async () => {
      candidateRepo.findOne.mockResolvedValue({
        id: 'candidate-1',
        status: 'PENDING_REVIEW',
        bountyCredits: 10,
        submission: { surveyorId: 'surveyor-other' },
      });

      const claim = await service.claimQuest('reviewer-1', {
        targetType: QuestTargetType.CANDIDATE_VALIDATION,
        targetId: 'candidate-1',
      });

      expect(claim).toBeDefined();
      expect(claim.reviewerId).toBe('reviewer-1');
      expect(claim.timeLimitMinutes).toBe(120);
      expect(claim.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(questRepo.save).toHaveBeenCalled();
    });

    it('rejects claim when concurrent active claim limit is reached', async () => {
      questRepo.count.mockResolvedValue(3);

      await expect(
        service.claimQuest('reviewer-1', {
          targetType: QuestTargetType.CANDIDATE_VALIDATION,
          targetId: 'cand-2',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('expireStaleClaims & cronjob', () => {
    it('expires stale claims and penalizes reliability score', async () => {
      const staleClaim: any = {
        id: 'stale-claim-1',
        reviewerId: 'reviewer-late',
        status: QuestClaimStatus.CLAIMED,
        timeLimitMinutes: 120,
        expiresAt: new Date(Date.now() - 10000),
        penaltyApplied: false,
      };

      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([staleClaim]),
      };
      questRepo.createQueryBuilder.mockReturnValue(qb);

      const res = await service.expireStaleClaims();

      expect(res.expiredCount).toBe(1);
      expect(staleClaim.status).toBe(QuestClaimStatus.EXPIRED);
      expect(staleClaim.penaltyApplied).toBe(true);
      expect(questRepo.save).toHaveBeenCalledWith(staleClaim);
      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE reviewer_profiles'),
        [5.0, 'reviewer-late'],
      );
    });

    it('handleCronExpireStaleClaims triggers expireStaleClaims', async () => {
      const spy = jest.spyOn(service, 'expireStaleClaims').mockResolvedValue({ expiredCount: 2 });
      await service.handleCronExpireStaleClaims();
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('expireSingleClaim', () => {
    it('expires single claim immediately and deducts reliability penalty', async () => {
      const claim = {
        id: 'claim-single',
        reviewerId: 'rev-single',
        status: QuestClaimStatus.CLAIMED,
        timeLimitMinutes: 60,
      } as any;

      const res = await service.expireSingleClaim(claim);
      expect(res.status).toBe(QuestClaimStatus.EXPIRED);
      expect(res.penaltyApplied).toBe(true);
      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE reviewer_profiles'),
        [5.0, 'rev-single'],
      );
    });
  });
});
