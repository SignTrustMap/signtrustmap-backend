import { DataSource, Repository } from 'typeorm';
import { ConsensusService } from '../consensus/application/consensus.service';
import { ConsensusConfig } from '../consensus/infrastructure/persistence/consensus-config.entity';
import { ConsensusLog, ConsensusOutcome } from '../consensus/infrastructure/persistence/consensus-log.entity';
import {
  CandidateStatus,
  UnverifiedSignCandidate,
} from '../survey/infrastructure/persistence/unverified-sign-candidate.entity';
import { CandidateReview } from '../reviews/infrastructure/persistence/candidate-review.entity';
import { RoutePreviewService } from '../navigation/application/route-preview.service';
import { RoutingService } from '../navigation/application/routing.service';
import { RouteSignQueryService } from '../sign-map/application/route-sign-query.service';
import { WalletService } from '../wallet/application/wallet.service';
import { TransactionType } from '../wallet/infrastructure/persistence/credit-transaction.entity';
import { NotificationsService } from '../notifications/notifications.service';

describe('WorkflowIntegrationTest (Direct DI)', () => {
  let consensusService: ConsensusService;
  let routePreviewService: RoutePreviewService;
  let walletService: WalletService;

  const mockSurveyorId = 'surv-001';
  const mockReviewer1 = 'rev-001';
  const mockReviewer2 = 'rev-002';
  const mockCandidateId = 'cand-001';
  const mockSignTypeId = 5;

  let candidateRepo: jest.Mocked<Repository<UnverifiedSignCandidate>>;
  let configRepo: jest.Mocked<Repository<ConsensusConfig>>;
  let logRepo: jest.Mocked<Repository<ConsensusLog>>;
  let reviewRepo: jest.Mocked<Repository<CandidateReview>>;
  let dataSource: jest.Mocked<DataSource>;
  let notificationsService: jest.Mocked<NotificationsService>;
  let mockRoutingService: jest.Mocked<RoutingService>;
  let mockRouteSignQueryService: jest.Mocked<RouteSignQueryService>;

  beforeEach(() => {
    configRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 1,
        approvalThreshold: 1.0,
        rejectionThreshold: -1.0,
        minVotesRequired: 2,
        alphaSmoothingFactor: 0.1,
        weightCorrect: 1.0,
        penaltyFalse: 2.0,
        minSampleBaseline: 5,
        minReliabilityThreshold: 50.0,
        consecutiveErrorLimit: 3,
        suspensionCooldownDays: 7,
        provisionalVoteWeight: 0.5,
      }),
    } as unknown as jest.Mocked<Repository<ConsensusConfig>>;

    logRepo = {
      create: jest.fn((val) => val),
      save: jest.fn(async (val) => ({ ...val, id: 'log-001' })),
    } as unknown as jest.Mocked<Repository<ConsensusLog>>;

    candidateRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: mockCandidateId,
        status: CandidateStatus.PENDING_REVIEW,
        predictedSignTypeId: mockSignTypeId,
        signCropUrl: 'https://s3.signmap.site/stm-sign-crops/cand-001.jpg',
        submissionId: 'sub-001',
      }),
      update: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<Repository<UnverifiedSignCandidate>>;

    reviewRepo = {
      find: jest.fn().mockResolvedValue([
        { reviewerId: mockReviewer1, vote: 1, suggestedSignTypeId: null },
        { reviewerId: mockReviewer2, vote: 1, suggestedSignTypeId: null },
      ]),
    } as unknown as jest.Mocked<Repository<CandidateReview>>;

    dataSource = {
      query: jest.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('reviewer_profiles')) {
          return [{ reliability_score: 95, is_provisional: false, total_correct_votes: 20, total_false_votes: 1 }];
        }
        if (sql.includes('candidate_geo_estimations')) {
          return [{ sign_wkt: 'POINT(106.7015 10.7762)', traffic_direction: 45 }];
        }
        if (sql.includes('SELECT id FROM verified_traffic_signs')) {
          return [{ id: 'vts-001' }];
        }
        if (sql.includes('survey_submissions')) {
          return [{ surveyor_id: mockSurveyorId }];
        }
        return [];
      }),
    } as unknown as jest.Mocked<DataSource>;

    walletService = {
      resolveRewardAmount: jest.fn().mockResolvedValue(5),
      creditUser: jest.fn().mockResolvedValue({
        transactionId: 'tx-001',
        newBalance: 125,
      }),
      deductUser: jest.fn().mockResolvedValue({
        transactionId: 'tx-002',
        newBalance: 120,
      }),
    } as unknown as WalletService;

    notificationsService = {
      send: jest.fn().mockResolvedValue(undefined),
      create: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<NotificationsService>;

    consensusService = new ConsensusService(
      configRepo,
      logRepo,
      candidateRepo,
      reviewRepo,
      dataSource,
      walletService,
      notificationsService,
    );

    const geometry = [
      { latitude: 10.7769, longitude: 106.7009 },
      { latitude: 10.7745, longitude: 106.7025 },
    ];

    mockRoutingService = {
      findDirections: jest.fn().mockResolvedValue({
        origin: geometry[0],
        destination: geometry[1],
        snappedOrigin: { ...geometry[0], nodeId: null, distanceMeters: 0 },
        snappedDestination: { ...geometry[1], nodeId: null, distanceMeters: 0 },
        shortestPath: {
          rank: 1,
          primary: true,
          recommendation: 'Shortest route',
          distanceMeters: 2500,
          durationSeconds: 300,
          distanceRatioToShortest: 1,
          nodeIds: [],
          edgeIds: [],
          geometry,
          steps: [
            {
              type: 'turn',
              instruction: 'Head north on Le Loi',
              edgeId: null,
              fromNodeId: null,
              toNodeId: null,
              roadName: 'Le Loi',
              roadClass: 'driving',
              distanceMeters: 500,
              durationSeconds: 60,
              geometry,
            },
          ],
        },
        alternatives: [],
      }),
    } as unknown as jest.Mocked<RoutingService>;

    mockRouteSignQueryService = {
      findAlongRoute: jest.fn().mockResolvedValue({
        routeDistanceMeters: 2500,
        corridorWidthMeters: 30,
        signCount: 1,
        signs: [
          {
            distanceAlongRouteMeters: 280,
            distanceFromRouteMeters: 4.5,
            sign: {
              id: 'vts-001',
              latitude: 10.7762,
              longitude: 106.7015,
              trafficDirection: 45,
              signCropUrl: 'crop.jpg',
              status: 'ACTIVE',
              freshnessScore: 1,
              lastVerifiedAt: new Date(),
              createdAt: new Date(),
              updatedAt: new Date(),
              signType: {
                id: mockSignTypeId,
                categoryId: 1,
                signCode: 'W.201',
                nameVi: 'W.201',
                nameEn: 'W.201',
                value: null,
                isActive: true,
                category: {
                  id: 1,
                  code: 'WARNING',
                  nameVi: 'Warning',
                  nameEn: 'Warning',
                },
              },
            },
          },
        ],
      }),
    } as unknown as jest.Mocked<RouteSignQueryService>;

    routePreviewService = new RoutePreviewService(mockRoutingService, mockRouteSignQueryService);
  });

  describe('End-to-End Contributor & Consumer Lifecycle', () => {
    it('processes consensus approval, credits reviewers & surveyors, updates spatial registry, and previews route corridor', async () => {
      // 1. Consensus Evaluation of unverified sign candidate
      const log = await consensusService.evaluate(mockCandidateId);
      expect(log).toBeDefined();
      expect(log?.finalOutcome).toBe(ConsensusOutcome.APPROVED);
      expect(log?.verifiedSignTypeId).toBe(mockSignTypeId);

      // Verify candidate status was updated to VERIFIED
      expect(candidateRepo.update).toHaveBeenCalledWith(mockCandidateId, {
        status: CandidateStatus.VERIFIED,
      });

      // Verify reviewers were credited
      expect(walletService.creditUser).toHaveBeenCalledWith(
        mockReviewer1,
        expect.any(Number),
        TransactionType.REVIEW_REWARD,
        'consensus_log',
        'log-001',
        expect.any(String),
      );

      // 2. Direct surveyor reward payout
      const creditRes = await walletService.creditUser(
        mockSurveyorId,
        25,
        TransactionType.SURVEY_REWARD,
        'submission',
        'sub-001',
        'Survey verified reward',
      );
      expect(creditRes.newBalance).toBe(125);

      // 3. Driver queries corridor route preview containing the newly published sign
      const routePreview = await routePreviewService.previewRoute({
        originLatitude: 10.7769,
        originLongitude: 106.7009,
        destinationLatitude: 10.7745,
        destinationLongitude: 106.7025,
        maxAlternatives: 0,
      });

      expect(routePreview).toBeDefined();
      expect(routePreview.route.distanceMeters).toBe(2500);
      expect(routePreview.trafficSigns.length).toBe(1);
      expect(routePreview.trafficSigns[0].id).toBe('vts-001');
      expect(routePreview.trafficSigns[0].routeOffsetMeters).toBe(280);

      // 4. Driver navigation fee deduction
      const deductRes = await walletService.deductUser(
        'driver-001',
        5,
        TransactionType.NAVIGATION_FEE,
        'navigation_session',
        'sess-001',
        'Corridor navigation fee',
      );
      expect(deductRes.newBalance).toBe(120);
      expect(walletService.deductUser).toHaveBeenCalledWith(
        'driver-001',
        5,
        TransactionType.NAVIGATION_FEE,
        'navigation_session',
        'sess-001',
        'Corridor navigation fee',
      );
    });
  });
});
