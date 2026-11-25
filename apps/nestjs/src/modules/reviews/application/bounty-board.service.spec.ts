import { BountyBoardService } from './bounty-board.service';
import {
  QuestTargetType,
  QuestClaimStatus,
} from '../infrastructure/persistence/reviewer-quest-claim.entity';
import { BadRequestException } from '@nestjs/common';

function makeQueryBuilderMock(rows: any[] = []) {
  return {
    leftJoin: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue(rows),
  };
}

describe('BountyBoardService', () => {
  let service: BountyBoardService;
  let questRepo: any;
  let candidateRepo: any;
  let taskRepo: any;
  let profileRepo: any;
  let paramService: any;
  let dataSource: any;
  let spatialAdminService: any;

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
      createQueryBuilder: jest.fn(() => makeQueryBuilderMock([])),
    };

    taskRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      createQueryBuilder: jest.fn(() => makeQueryBuilderMock([])),
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

    spatialAdminService = {
      resolveLocation: jest.fn().mockResolvedValue({
        roadName: 'Đường Lê Lợi',
        displayAddress: 'Đường Lê Lợi, Phường Bến Thành, TP. Hồ Chí Minh',
      }),
    };

    service = new BountyBoardService(
      questRepo,
      candidateRepo,
      taskRepo,
      profileRepo,
      paramService,
      dataSource,
      spatialAdminService,
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

  describe('getMyClaims', () => {
    it('returns empty array without querying target repositories when user has no claims', async () => {
      questRepo.find.mockResolvedValue([]);

      const result = await service.getMyClaims('reviewer-1');

      expect(result).toEqual([]);
      expect(candidateRepo.createQueryBuilder).not.toHaveBeenCalled();
      expect(taskRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('enriches candidate and revalidation claims with sign, location, image, and reward metadata', async () => {
      const futureExpiry = new Date(Date.now() + 60 * 60 * 1000);
      questRepo.find.mockResolvedValue([
        {
          id: 'claim-reval-1',
          reviewerId: 'reviewer-1',
          targetType: QuestTargetType.REVALIDATION_TASK,
          targetId: 'task-1',
          status: QuestClaimStatus.CLAIMED,
          timeLimitMinutes: 120,
          claimedAt: new Date(),
          expiresAt: futureExpiry,
          completedAt: null,
          baseRewardCredits: 120,
          escalatedBonusCredits: 0,
          penaltyApplied: false,
          penaltyNotes: null,
        },
        {
          id: 'claim-cand-1',
          reviewerId: 'reviewer-1',
          targetType: QuestTargetType.CANDIDATE_VALIDATION,
          targetId: 'cand-1',
          status: QuestClaimStatus.CLAIMED,
          timeLimitMinutes: 120,
          claimedAt: new Date(),
          expiresAt: futureExpiry,
          completedAt: null,
          baseRewardCredits: 10,
          escalatedBonusCredits: 5,
          penaltyApplied: false,
          penaltyNotes: null,
        },
      ]);

      taskRepo.createQueryBuilder.mockReturnValue(
        makeQueryBuilderMock([
          {
            id: 'task-1',
            verified_sign_id: 'vsign-1',
            priority: 'HIGH',
            target_status: 'OPEN',
            urgency: 0.9,
            votes_count: 1,
            is_promoted: true,
            task_expired_at: futureExpiry,
            sign_type_id: 12,
            sign_crop_url: 'crops/reval-1.jpg',
            road_name: 'Nguyễn Huệ',
            display_address: 'Nguyễn Huệ, Phường Sài Gòn, TP. Hồ Chí Minh',
            freshness_score: 0.25,
            sign_status: 'STALE',
            last_verified_at: new Date('2026-01-01T00:00:00Z'),
            traffic_direction: 90,
            sign_code: 'P.102',
            sign_name: 'Cấm đi ngược chiều',
            sign_name_en: 'No entry',
            category_code: 'PROHIBITION',
            category_name: 'Biển báo cấm',
            category_name_en: 'Prohibition',
            latitude: 10.774,
            longitude: 106.703,
          },
        ]),
      );

      candidateRepo.createQueryBuilder.mockReturnValue(
        makeQueryBuilderMock([
          {
            id: 'cand-1',
            submission_id: 'sub-1',
            sign_crop_url: 'crops/cand-1.jpg',
            best_frame_url: 'frames/cand-1.jpg',
            confidence_score: 0.91,
            spatial_confidence: 'HIGH',
            target_status: 'IN_CONSENSUS',
            votes_count: 1,
            is_promoted: true,
            sign_type_id: 24,
            sign_code: 'W.224',
            sign_name: 'Đường người đi bộ cắt ngang',
            sign_name_en: 'Pedestrian crossing',
            category_code: 'WARNING',
            category_name: 'Biển báo nguy hiểm',
            category_name_en: 'Warning',
            latitude: 10.7769,
            longitude: 106.7009,
            estimated_distance_meters: 14.5,
            bearing_angle: 45,
            traffic_direction: 180,
          },
        ]),
      );

      const res = await service.getMyClaims('reviewer-1', {
        status: QuestClaimStatus.CLAIMED,
        latitude: 10.7769,
        longitude: 106.7009,
      });

      expect(questRepo.find).toHaveBeenCalledWith({
        where: { reviewerId: 'reviewer-1', status: QuestClaimStatus.CLAIMED },
        order: { claimedAt: 'DESC' },
      });

      expect(res).toHaveLength(2);

      expect(res[0]).toMatchObject({
        id: 'claim-reval-1',
        targetType: QuestTargetType.REVALIDATION_TASK,
        targetId: 'task-1',
        title: 'Revalidate Sign: Cấm đi ngược chiều',
        totalRewardCredits: 120,
        isExpired: false,
        verifiedSignId: 'vsign-1',
        priority: 'HIGH',
        targetStatus: 'OPEN',
        signCode: 'P.102',
        signName: 'Cấm đi ngược chiều',
        signNameEn: 'No entry',
        categoryCode: 'PROHIBITION',
        signCropUrl: 'crops/reval-1.jpg',
        displayAddress: 'Nguyễn Huệ, Phường Sài Gòn, TP. Hồ Chí Minh',
        roadName: 'Nguyễn Huệ',
        latitude: 10.774,
        longitude: 106.703,
        freshnessScore: 0.25,
        signStatus: 'STALE',
      });
      expect(res[0].remainingSeconds).toBeGreaterThan(3500);
      expect(res[0].distanceMeters).toBeGreaterThan(0);

      expect(res[1]).toMatchObject({
        id: 'claim-cand-1',
        targetType: QuestTargetType.CANDIDATE_VALIDATION,
        targetId: 'cand-1',
        title: 'Verify Đường người đi bộ cắt ngang (W.224)',
        totalRewardCredits: 15,
        isExpired: false,
        submissionId: 'sub-1',
        confidenceScore: 0.91,
        spatialConfidence: 'HIGH',
        targetStatus: 'IN_CONSENSUS',
        signCode: 'W.224',
        signName: 'Đường người đi bộ cắt ngang',
        signCropUrl: 'crops/cand-1.jpg',
        bestFrameUrl: 'frames/cand-1.jpg',
        latitude: 10.7769,
        longitude: 106.7009,
        distanceMeters: 0,
        roadName: 'Đường Lê Lợi',
        displayAddress: 'Đường Lê Lợi, Phường Bến Thành, TP. Hồ Chí Minh',
      });
      // Only candidate claim lacked displayAddress; revalidation task already had it
      expect(spatialAdminService.resolveLocation).toHaveBeenCalledTimes(1);
    });

    it('gracefully falls back when target enrichment queries fail or coordinates come from submission note', async () => {
      questRepo.find.mockResolvedValue([
        {
          id: 'claim-fallback-1',
          reviewerId: 'reviewer-1',
          targetType: QuestTargetType.CANDIDATE_VALIDATION,
          targetId: 'cand-note-1',
          status: QuestClaimStatus.EXPIRED,
          timeLimitMinutes: 120,
          claimedAt: new Date(),
          expiresAt: new Date(Date.now() - 60_000),
          completedAt: null,
          baseRewardCredits: 20,
          escalatedBonusCredits: 0,
          penaltyApplied: true,
          penaltyNotes: 'Expired',
        },
      ]);

      candidateRepo.createQueryBuilder.mockReturnValue(
        makeQueryBuilderMock([
          {
            id: 'cand-note-1',
            submission_id: 'sub-note-1',
            latitude: null,
            longitude: null,
            submission_note: 'Manual survey GPS: 10.78000, 106.69000',
          },
        ]),
      );

      const res = await service.getMyClaims('reviewer-1');

      expect(res).toHaveLength(1);
      expect(res[0]).toMatchObject({
        id: 'claim-fallback-1',
        title: 'Verify Traffic Sign Candidate',
        totalRewardCredits: 20,
        remainingSeconds: 0,
        isExpired: true,
        latitude: 10.78,
        longitude: 106.69,
        distanceMeters: null,
      });
      // Expired claims should not trigger spatial resolution calls
      expect(spatialAdminService.resolveLocation).not.toHaveBeenCalled();
    });
  });
});
