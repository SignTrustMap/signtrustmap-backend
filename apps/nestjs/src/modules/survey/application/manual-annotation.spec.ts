import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SurveyService } from './survey.service';
import { ModerationService } from '../../moderation/application/moderation.service';
import { SubmissionStatus } from '../infrastructure/persistence/survey-submission.entity';
import { CandidateStatus } from '../infrastructure/persistence/unverified-sign-candidate.entity';
import { ModerationStatus, ModerationType } from '../../moderation/infrastructure/persistence/moderation-case.entity';
import { TransactionType } from '../../wallet/infrastructure/persistence/credit-transaction.entity';

describe('Surveyor Negative Feedback & Reputation System', () => {
  describe('SurveyService.submitManualAnnotation', () => {
    let service: SurveyService;
    let submissionRepo: any;
    let candidateRepo: any;
    let moderationCaseRepo: any;
    let surveyorProfileRepo: any;
    let mediaFileRepo: any;
    let paramService: any;
    let dataSource: any;

    beforeEach(() => {
      submissionRepo = {
        findOne: jest.fn(),
        save: jest.fn(async (s: any) => s),
      };
      candidateRepo = {
        create: jest.fn((dto: any) => ({ id: 'cand-1', ...dto })),
        save: jest.fn(async (c: any) => c),
      };
      moderationCaseRepo = {
        create: jest.fn((dto: any) => ({ id: 'case-1', ...dto })),
        save: jest.fn(async (m: any) => m),
      };
      surveyorProfileRepo = {
        findOne: jest.fn(),
        save: jest.fn(async (p: any) => p),
      };
      mediaFileRepo = {
        findOne: jest.fn(),
      };
      paramService = {
        getBoolean: jest.fn().mockResolvedValue(true),
        getNumber: jest.fn((key: string, def: number) => {
          if (key === 'survey.negative_review_window_hours') return Promise.resolve(72);
          if (key === 'survey.manual_annotation_min_reliability_threshold') return Promise.resolve(0.4);
          if (key === 'survey.manual_annotation_reward_credits') return Promise.resolve(35);
          return Promise.resolve(def);
        }),
      };
      dataSource = {
        query: jest.fn().mockResolvedValue([]),
      };

      service = new SurveyService(
        {} as any,
        {} as any,
        submissionRepo,
        {} as any,
        dataSource,
        {} as any,
        {} as any,
        undefined,
        undefined,
        surveyorProfileRepo,
        mediaFileRepo,
        candidateRepo,
        moderationCaseRepo,
        undefined,
        paramService,
      );
    });

    it('rejects if manual annotation feature is disabled', async () => {
      paramService.getBoolean.mockResolvedValue(false);
      await expect(
        service.submitManualAnnotation('user-1', 'sub-1', {
          mediaFileId: 'mf-1',
          signTypeId: 101,
          boundingBox: { xmin: 0.1, ymin: 0.1, xmax: 0.5, ymax: 0.5 },
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects if submission is not owned by surveyor', async () => {
      submissionRepo.findOne.mockResolvedValue({
        id: 'sub-1',
        surveyorId: 'other-user',
        status: SubmissionStatus.NO_SIGN_DETECTED,
      });

      await expect(
        service.submitManualAnnotation('user-1', 'sub-1', {
          mediaFileId: 'mf-1',
          signTypeId: 101,
          boundingBox: { xmin: 0.1, ymin: 0.1, xmax: 0.5, ymax: 0.5 },
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects if submission status is not NO_SIGN_DETECTED', async () => {
      submissionRepo.findOne.mockResolvedValue({
        id: 'sub-1',
        surveyorId: 'user-1',
        status: SubmissionStatus.COMPLETED,
      });

      await expect(
        service.submitManualAnnotation('user-1', 'sub-1', {
          mediaFileId: 'mf-1',
          signTypeId: 101,
          boundingBox: { xmin: 0.1, ymin: 0.1, xmax: 0.5, ymax: 0.5 },
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects if surveyor reliability is below minimum threshold', async () => {
      submissionRepo.findOne.mockResolvedValue({
        id: 'sub-1',
        surveyorId: 'user-1',
        status: SubmissionStatus.NO_SIGN_DETECTED,
        updatedAt: new Date(),
      });
      surveyorProfileRepo.findOne.mockResolvedValue({
        userId: 'user-1',
        reliabilityScore: 0.25, // below 0.40
        isAnnotationSuspended: false,
      });

      await expect(
        service.submitManualAnnotation('user-1', 'sub-1', {
          mediaFileId: 'mf-1',
          signTypeId: 101,
          boundingBox: { xmin: 0.1, ymin: 0.1, xmax: 0.5, ymax: 0.5 },
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects if bounding box coordinates are degenerate', async () => {
      submissionRepo.findOne.mockResolvedValue({
        id: 'sub-1',
        surveyorId: 'user-1',
        status: SubmissionStatus.NO_SIGN_DETECTED,
        updatedAt: new Date(),
      });
      surveyorProfileRepo.findOne.mockResolvedValue({
        userId: 'user-1',
        reliabilityScore: 1.0,
      });

      await expect(
        service.submitManualAnnotation('user-1', 'sub-1', {
          mediaFileId: 'mf-1',
          signTypeId: 101,
          boundingBox: { xmin: 0.5, ymin: 0.5, xmax: 0.2, ymax: 0.2 },
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('successfully submits manual annotation, routes to Staff Moderation and updates submission', async () => {
      const sub = {
        id: 'sub-1',
        surveyorId: 'user-1',
        status: SubmissionStatus.NO_SIGN_DETECTED,
        hasManualAnnotation: false,
        manualAnnotationStatus: null,
        updatedAt: new Date(),
      };
      submissionRepo.findOne.mockResolvedValue(sub);
      surveyorProfileRepo.findOne.mockResolvedValue({
        userId: 'user-1',
        reliabilityScore: 0.95,
      });
      mediaFileRepo.findOne.mockResolvedValue({
        id: 'mf-1',
        fileUrl: 'https://s3.signmap.site/submissions/frame.jpg',
      });

      const res = await service.submitManualAnnotation('user-1', 'sub-1', {
        mediaFileId: 'mf-1',
        signTypeId: 102,
        boundingBox: { xmin: 0.2, ymin: 0.3, xmax: 0.6, ymax: 0.7 },
        notes: 'Partially obscured by leaves',
      });

      expect(res.status).toBe('SUBMITTED_FOR_STAFF_VERIFICATION');
      expect(res.candidateId).toBe('cand-1');
      expect(res.caseId).toBe('case-1');

      expect(candidateRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          predictedSignTypeId: 102,
          isManualAnnotation: true,
          manualAnnotationBy: 'user-1',
          status: CandidateStatus.ESCALATED_MODERATION,
          bountyCredits: 35,
        }),
      );

      expect(moderationCaseRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          caseType: ModerationType.MANUAL_SURVEY_ANNOTATION,
          targetEntityType: 'unverified_sign_candidates',
          targetEntityId: 'cand-1',
          status: ModerationStatus.PENDING,
        }),
      );

      expect(sub.hasManualAnnotation).toBe(true);
      expect(sub.manualAnnotationStatus).toBe('PENDING_STAFF');
      expect(submissionRepo.save).toHaveBeenCalledWith(sub);
    });
  });

  describe('ModerationService.resolveManualAnnotationCase', () => {
    let service: ModerationService;
    let casesRepo: any;
    let actionsRepo: any;
    let candRepo: any;
    let surveyorProfileRepo: any;
    let surveyorReputationRepo: any;
    let walletService: any;
    let notificationsService: any;
    let paramService: any;
    let dataSource: any;

    beforeEach(() => {
      casesRepo = {
        findOne: jest.fn(),
        save: jest.fn(async (c: any) => c),
      };
      actionsRepo = {
        create: jest.fn((dto: any) => ({ id: 'act-1', ...dto })),
        save: jest.fn(async (a: any) => a),
      };
      candRepo = {
        findOne: jest.fn(),
        save: jest.fn(async (c: any) => c),
      };
      surveyorProfileRepo = {
        findOne: jest.fn(),
        save: jest.fn(async (p: any) => p),
      };
      surveyorReputationRepo = {
        create: jest.fn((dto: any) => ({ id: 'rep-1', ...dto })),
        save: jest.fn(async (r: any) => r),
      };
      walletService = {
        creditUser: jest.fn().mockResolvedValue({ walletId: 'w-1', newBalance: 135 }),
        deductUser: jest.fn().mockResolvedValue({ walletId: 'w-1', newBalance: 80 }),
        getWallet: jest.fn().mockResolvedValue({ wallet: { balance: 100 } }),
      };
      notificationsService = {
        create: jest.fn().mockResolvedValue(true),
      };
      paramService = {
        getNumber: jest.fn((key: string, def: number) => {
          if (key === 'survey.manual_annotation_reward_credits') return Promise.resolve(35);
          if (key === 'survey.manual_annotation_penalty_credits') return Promise.resolve(20);
          if (key === 'survey.manual_annotation_reward_reputation_boost') return Promise.resolve(0.05);
          if (key === 'survey.manual_annotation_penalty_reputation_drop') return Promise.resolve(0.15);
          if (key === 'survey.manual_annotation_consecutive_error_limit') return Promise.resolve(3);
          return Promise.resolve(def);
        }),
      };
      dataSource = {
        query: jest.fn().mockResolvedValue([]),
      };

      service = new ModerationService(
        casesRepo,
        actionsRepo,
        {} as any,
        {} as any,
        {} as any,
        candRepo,
        dataSource,
        notificationsService,
        {} as any,
        {} as any,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        walletService,
        paramService,
        surveyorProfileRepo,
        surveyorReputationRepo,
      );
    });

    it('approves manual annotation: credits bonus +35, boosts reliability +0.05, verifies candidate, and notifies surveyor', async () => {
      const modCase = {
        id: 'case-100',
        caseType: ModerationType.MANUAL_SURVEY_ANNOTATION,
        targetEntityType: 'unverified_sign_candidates',
        targetEntityId: 'cand-100',
        status: ModerationStatus.PENDING,
      };
      casesRepo.findOne.mockResolvedValue(modCase);

      const candidate = {
        id: 'cand-100',
        submissionId: 'sub-100',
        predictedSignTypeId: 102,
        manualAnnotationBy: 'user-surveyor',
        status: CandidateStatus.ESCALATED_MODERATION,
      };
      candRepo.findOne.mockResolvedValue(candidate);

      const profile = {
        userId: 'user-surveyor',
        reliabilityScore: 0.90,
        approvedManualAnnotations: 2,
        totalManualAnnotations: 3,
        consecutiveAnnotationErrors: 1,
      };
      surveyorProfileRepo.findOne.mockResolvedValue(profile);

      const resolved = await service.resolveManualAnnotationCase('staff-1', 'case-100', {
        resolutionNote: 'Valid sign verified',
        actionType: 'APPROVE',
      });

      expect(resolved.status).toBe(ModerationStatus.RESOLVED);
      expect(walletService.creditUser).toHaveBeenCalledWith(
        'user-surveyor',
        35,
        TransactionType.SURVEY_REWARD,
        'unverified_sign_candidates',
        'cand-100',
        expect.stringContaining('Reward for verified manual sign annotation'),
        expect.any(Object),
      );

      // Reliability: 0.90 + 0.05 = 0.95
      expect(profile.reliabilityScore).toBe(0.95);
      expect(profile.approvedManualAnnotations).toBe(3);
      expect(profile.consecutiveAnnotationErrors).toBe(0);
      expect(surveyorProfileRepo.save).toHaveBeenCalledWith(profile);

      expect(surveyorReputationRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          surveyorId: 'user-surveyor',
          previousScore: 0.9,
          newScore: 0.95,
          delta: 0.05,
          changeReason: 'MANUAL_ANNOTATION_APPROVED',
        }),
      );

      expect(candidate.status).toBe(CandidateStatus.VERIFIED);
      expect(candRepo.save).toHaveBeenCalledWith(candidate);
      expect(notificationsService.create).toHaveBeenCalledWith(
        'user-surveyor',
        'MANUAL_ANNOTATION_APPROVED',
        expect.any(String),
        expect.any(String),
        'candidate',
        'cand-100',
      );
    });

    it('rejects manual annotation: debits penalty credits -20, deducts reliability -0.15, increments error count, and suspends when threshold reached', async () => {
      const modCase = {
        id: 'case-200',
        caseType: ModerationType.MANUAL_SURVEY_ANNOTATION,
        targetEntityType: 'unverified_sign_candidates',
        targetEntityId: 'cand-200',
        status: ModerationStatus.PENDING,
      };
      casesRepo.findOne.mockResolvedValue(modCase);

      const candidate = {
        id: 'cand-200',
        submissionId: 'sub-200',
        predictedSignTypeId: 102,
        manualAnnotationBy: 'user-surveyor',
        status: CandidateStatus.ESCALATED_MODERATION,
      };
      candRepo.findOne.mockResolvedValue(candidate);

      const profile = {
        userId: 'user-surveyor',
        reliabilityScore: 0.80,
        rejectedManualAnnotations: 2,
        totalManualAnnotations: 5,
        consecutiveAnnotationErrors: 2, // reaching 3 will trigger lockout
        isAnnotationSuspended: false,
      };
      surveyorProfileRepo.findOne.mockResolvedValue(profile);

      const resolved = await service.resolveManualAnnotationCase('staff-1', 'case-200', {
        resolutionNote: 'No traffic sign here, empty tree branch',
        actionType: 'REJECT',
      });

      expect(resolved.status).toBe(ModerationStatus.RESOLVED);
      expect(walletService.deductUser).toHaveBeenCalledWith(
        'user-surveyor',
        20,
        TransactionType.MANUAL_ADJUSTMENT,
        'unverified_sign_candidates',
        'cand-200',
        expect.stringContaining('Penalty for rejected manual sign annotation'),
        expect.any(Object),
      );

      // Reliability: 0.80 - 0.15 = 0.65
      expect(profile.reliabilityScore).toBe(0.65);
      expect(profile.rejectedManualAnnotations).toBe(3);
      expect(profile.consecutiveAnnotationErrors).toBe(3);
      expect(profile.isAnnotationSuspended).toBe(true);
      expect(surveyorProfileRepo.save).toHaveBeenCalledWith(profile);

      expect(surveyorReputationRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          surveyorId: 'user-surveyor',
          previousScore: 0.8,
          newScore: 0.65,
          delta: -0.15,
          changeReason: 'MANUAL_ANNOTATION_REJECTED',
        }),
      );

      expect(candidate.status).toBe(CandidateStatus.REJECTED);
      expect(candRepo.save).toHaveBeenCalledWith(candidate);
      expect(notificationsService.create).toHaveBeenCalledWith(
        'user-surveyor',
        'MANUAL_ANNOTATION_REJECTED',
        expect.any(String),
        expect.any(String),
        'candidate',
        'cand-200',
      );
    });
  });
});
