import { ReviewsController } from './reviews.controller';
import { ReviewsService } from '../application/reviews.service';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';

describe('ReviewsController', () => {
  let controller: ReviewsController;
  let service: {
    getMyHistory: jest.Mock;
    getMyStats: jest.Mock;
    getSignRemedies: jest.Mock;
    selectSignRemedy: jest.Mock;
    getCandidateDetail: jest.Mock;
    reportCandidate: jest.Mock;
    skipCandidate: jest.Mock;
    canNotIdentify: jest.Mock;
    undoVote: jest.Mock;
    queue: jest.Mock;
    getUnscoredCandidates: jest.Mock;
    setActiveLearningPriority: jest.Mock;
    setBulkActiveLearningPriorities: jest.Mock;
    vote: jest.Mock;
    requestRecapture: jest.Mock;
    submitRecapture: jest.Mock;
    getRecapturesForCandidate: jest.Mock;
    getMyRecaptures: jest.Mock;
    getReviewedCandidates: jest.Mock;
  };

  const mockUser = { id: 'rev-1', email: 'reviewer@stm.dev' };

  beforeEach(() => {
    service = {
      getMyHistory: jest.fn(),
      getMyStats: jest.fn(),
      getSignRemedies: jest.fn(),
      selectSignRemedy: jest.fn(),
      getCandidateDetail: jest.fn(),
      reportCandidate: jest.fn(),
      skipCandidate: jest.fn(),
      canNotIdentify: jest.fn(),
      undoVote: jest.fn(),
      queue: jest.fn(),
      getUnscoredCandidates: jest.fn(),
      setActiveLearningPriority: jest.fn(),
      setBulkActiveLearningPriorities: jest.fn(),
      vote: jest.fn(),
      requestRecapture: jest.fn(),
      submitRecapture: jest.fn(),
      getRecapturesForCandidate: jest.fn(),
      getMyRecaptures: jest.fn(),
      getReviewedCandidates: jest.fn(),
    };
    controller = new ReviewsController(service as unknown as ReviewsService);
  });

  it('myHistory parses pagination and passes to service', async () => {
    service.getMyHistory.mockResolvedValue({ items: [], total: 0 });
    const res = await controller.myHistory(mockUser, '2', '15', 'APPROVED', 'Speed', 'surv-1');
    expect(res).toEqual({ items: [], total: 0 });
    expect(service.getMyHistory).toHaveBeenCalledWith(mockUser.id, 2, 15, 'APPROVED', 'Speed', 'surv-1');
  });

  it('getSignRemedies returns AI replacement suggestions for a candidate', async () => {
    const remedies = [
      { rank: 1, signTypeId: 7, standardCode: 'W.227', confidence: 0.82 },
    ];
    service.getSignRemedies.mockReturnValue(remedies);

    expect(controller.getSignRemedies('00000000-0000-0000-0000-000000000001')).toEqual(remedies);
    expect(service.getSignRemedies).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001');
  });

  it('selectSignRemedy passes reviewer selection to the service', async () => {
    const selection = { candidateId: 'cand-1', selectedSignTypeId: 7 };
    const dto = { signTypeId: 7, reason: 'Best visual match' };
    service.selectSignRemedy.mockResolvedValue(selection);

    await expect(controller.selectSignRemedy(mockUser, 'cand-1', dto)).resolves.toEqual(selection);
    expect(service.selectSignRemedy).toHaveBeenCalledWith(mockUser.id, 'cand-1', dto);
  });

  it('myStats and stats call service.getMyStats', async () => {
    service.getMyStats.mockResolvedValue({ totalVotes: 50, accuracyRate: 0.95 });
    const res1 = await controller.myStats(mockUser);
    const res2 = await controller.stats(mockUser);
    expect(res1).toEqual({ totalVotes: 50, accuracyRate: 0.95 });
    expect(res2).toEqual({ totalVotes: 50, accuracyRate: 0.95 });
    expect(service.getMyStats).toHaveBeenCalledTimes(2);
  });

  it('getCandidate calls service.getCandidateDetail', async () => {
    service.getCandidateDetail.mockResolvedValue({ id: 'cand-1' });
    const res = await controller.getCandidate('cand-1');
    expect(res).toEqual({ id: 'cand-1' });
    expect(service.getCandidateDetail).toHaveBeenCalledWith('cand-1');
  });

  it('report calls service.reportCandidate', async () => {
    service.reportCandidate.mockResolvedValue({ reported: true });
    const res = await controller.report(mockUser, 'cand-1', { reason: 'BLURRY' });
    expect(res).toEqual({ reported: true });
    expect(service.reportCandidate).toHaveBeenCalledWith(mockUser.id, 'cand-1', { reason: 'BLURRY' });
  });

  it('skipCandidate calls service.skipCandidate', async () => {
    service.skipCandidate.mockResolvedValue({ skipped: true });
    const res = await controller.skipCandidate(mockUser, 'cand-1');
    expect(res).toEqual({ skipped: true });
    expect(service.skipCandidate).toHaveBeenCalledWith(mockUser.id, 'cand-1');
  });

  it('canNotIdentify calls service.canNotIdentify', async () => {
    service.canNotIdentify.mockResolvedValue({ marked: true });
    const res = await controller.canNotIdentify(mockUser, 'cand-1', { note: 'Night shot' });
    expect(res).toEqual({ marked: true });
    expect(service.canNotIdentify).toHaveBeenCalledWith(mockUser.id, 'cand-1', 'Night shot');
  });

  it('undoVote calls service.undoVote', async () => {
    service.undoVote.mockResolvedValue({ undone: true });
    const res = await controller.undoVote(mockUser, 'cand-1');
    expect(res).toEqual({ undone: true });
    expect(service.undoVote).toHaveBeenCalledWith(mockUser.id, 'cand-1');
  });

  it('queue calls service.queue with pagination defaults', async () => {
    service.queue.mockResolvedValue({ items: [], total: 0 });
    const res = await controller.queue(mockUser, { page: 1, pageSize: 25 });
    expect(res).toEqual({ items: [], total: 0 });
    expect(service.queue).toHaveBeenCalledWith(mockUser.id, 1, 25, false);
  });

  it('getUnscored calls service.getUnscoredCandidates', async () => {
    service.getUnscoredCandidates.mockResolvedValue([]);
    const res = await controller.getUnscored('30');
    expect(res).toEqual([]);
    expect(service.getUnscoredCandidates).toHaveBeenCalledWith(30);
  });

  it('setPriority calls service.setActiveLearningPriority', async () => {
    service.setActiveLearningPriority.mockResolvedValue({ candidateId: 'cand-1', priority: 0.85 });
    const res = await controller.setPriority('cand-1', { priority: 0.85 });
    expect(res).toEqual({ candidateId: 'cand-1', priority: 0.85 });
    expect(service.setActiveLearningPriority).toHaveBeenCalledWith('cand-1', 0.85);
  });

  it('setBulkPriorities calls service.setBulkActiveLearningPriorities', async () => {
    service.setBulkActiveLearningPriorities.mockResolvedValue({ updated: 2 });
    const res = await controller.setBulkPriorities({ items: [{ candidateId: 'c1', priority: 0.9 }] });
    expect(res).toEqual({ updated: 2 });
    expect(service.setBulkActiveLearningPriorities).toHaveBeenCalledWith([{ candidateId: 'c1', priority: 0.9 }]);
  });

  it('enforces REVIEWER and ADMIN roles for voting and review triage actions', () => {
    expect(Reflect.getMetadata(ROLES_KEY, ReviewsController.prototype.vote)).toEqual([
      'REVIEWER',
      'ADMIN',
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, ReviewsController.prototype.undoVote)).toEqual([
      'REVIEWER',
      'ADMIN',
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, ReviewsController.prototype.skipCandidate)).toEqual([
      'REVIEWER',
      'ADMIN',
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, ReviewsController.prototype.canNotIdentify)).toEqual([
      'REVIEWER',
      'ADMIN',
    ]);
  });

  it('vote calls service.vote with vote DTO', async () => {
    service.vote.mockResolvedValue({ status: 'CONFIRMED' });
    const res = await controller.vote(mockUser, 'cand-1', { vote: 1 });
    expect(res).toEqual({ status: 'CONFIRMED' });
    expect(service.vote).toHaveBeenCalledWith(mockUser.id, 'cand-1', { vote: 1 });
  });

  it('requestRecapture calls service.requestRecapture with reviewer and dto', async () => {
    service.requestRecapture.mockResolvedValue({ success: true, requestId: 'req-1' });
    const dto = { reason: 'BLURRY', note: 'Too blurry to read speed limit' };
    const res = await controller.requestRecapture(mockUser, 'cand-1', dto);
    expect(res).toEqual({ success: true, requestId: 'req-1' });
    expect(service.requestRecapture).toHaveBeenCalledWith(mockUser.id, 'cand-1', dto, false);
  });

  it('requestRecapture passes allowSelf=true when user is ADMIN', async () => {
    service.requestRecapture.mockResolvedValue({ success: true, requestId: 'req-2' });
    const adminUser = { id: 'admin-1', role: 'ADMIN' };
    const dto = { reason: 'POOR_LIGHTING' };
    const res = await controller.requestRecapture(adminUser, 'cand-1', dto);
    expect(res).toEqual({ success: true, requestId: 'req-2' });
    expect(service.requestRecapture).toHaveBeenCalledWith('admin-1', 'cand-1', dto, true);
  });

  it('submitRecapture passes authenticated surveyor and multipart files', async () => {
    service.submitRecapture.mockResolvedValue({ success: true, candidateId: 'cand-1' });
    const files = { signCrop: [{ originalname: 'crop.jpg' }], bestFrame: [{ originalname: 'frame.jpg' }] } as any;
    const dto = { latitude: 10.77, longitude: 106.7 } as any;
    const res = await controller.submitRecapture(mockUser, 'cand-1', dto, files);
    expect(res).toEqual({ success: true, candidateId: 'cand-1' });
    expect(service.submitRecapture).toHaveBeenCalledWith(mockUser.id, 'cand-1', dto, files);
  });

  it('getCandidateRecaptures calls service.getRecapturesForCandidate', async () => {
    service.getRecapturesForCandidate.mockResolvedValue([{ id: 'req-1', reason: 'BLURRY' }]);
    const res = await controller.getCandidateRecaptures('cand-1');
    expect(res).toEqual([{ id: 'req-1', reason: 'BLURRY' }]);
    expect(service.getRecapturesForCandidate).toHaveBeenCalledWith('cand-1');
  });

  it('getMyRecaptures calls service.getMyRecaptures with parsed pagination', async () => {
    service.getMyRecaptures.mockResolvedValue({ items: [], total: 0 });
    const res = await controller.getMyRecaptures(mockUser, '2', '10');
    expect(res).toEqual({ items: [], total: 0 });
    expect(service.getMyRecaptures).toHaveBeenCalledWith(mockUser.id, 2, 10, undefined, undefined);
  });

  it('passes surveyor GPS coordinates for nearby open recapture quests', async () => {
    service.getMyRecaptures.mockResolvedValue({ items: [], total: 0 });

    await controller.getMyRecaptures(mockUser, undefined, undefined, '10.7', '106.6');

    expect(service.getMyRecaptures).toHaveBeenCalledWith(
      mockUser.id,
      1,
      20,
      10.7,
      106.6,
    );
  });

  describe('getReviewedCandidates and getMyReviewedCandidates', () => {
    const mockReviewedResult = {
      items: [
        {
          id: 'cand-1',
          status: 'IN_CONSENSUS',
          lifecycleStatus: 'IN_CONSENSUS',
          statusTag: 'IN_CONSENSUS',
          statusTagVi: 'Đang xem xét',
          review: { vote: 1, reviewedAt: new Date() },
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
      counts: {
        ALL: 1,
        PENDING_REVIEW: 0,
        IN_CONSENSUS: 1,
        RESOLVED: 0,
        all: 1,
        unprocessed: 0,
        inReview: 1,
        reviewed: 0,
      },
      categories: [
        { id: 'ALL', label: 'Tất cả trạng thái', count: 1 },
        { id: 'PENDING_REVIEW', label: 'Chưa xử lý', count: 0 },
        { id: 'IN_CONSENSUS', label: 'Đang xem xét', count: 1 },
        { id: 'RESOLVED', label: 'Đã giải quyết', count: 0 },
      ],
    };

    it('getReviewedCandidates delegates to service with parsed query parameters', async () => {
      service.getReviewedCandidates.mockResolvedValue(mockReviewedResult);

      const res = await controller.getReviewedCandidates(mockUser, {
        page: 2,
        pageSize: 15,
        status: 'in_review',
        search: 'P.102',
        surveyorId: 'surv-1',
        sortBy: 'reviewedAt',
        sortOrder: 'DESC',
      });

      expect(res).toEqual(mockReviewedResult);
      expect(service.getReviewedCandidates).toHaveBeenCalledWith(
        mockUser.id,
        2,
        15,
        'in_review',
        'P.102',
        'surv-1',
        'reviewedAt',
        'DESC',
      );
    });

    it('supports Vietnamese status tags (Đang xem xét, Chưa xử lý, Đã giải quyết, Tất cả trạng thái)', async () => {
      service.getReviewedCandidates.mockResolvedValue(mockReviewedResult);

      await controller.getReviewedCandidates(mockUser, {
        status: 'Đang xem xét',
      });

      expect(service.getReviewedCandidates).toHaveBeenCalledWith(
        mockUser.id,
        1,
        20,
        'Đang xem xét',
        undefined,
        undefined,
        'reviewedAt',
        'DESC',
      );
    });

    it('allows ADMIN to query specific reviewerId', async () => {
      const adminUser = { id: 'admin-1', role: 'ADMIN' };
      service.getReviewedCandidates.mockResolvedValue({ items: [], total: 0 });

      await controller.getReviewedCandidates(adminUser, {
        reviewerId: 'rev-target',
        status: 'reviewed',
      });

      expect(service.getReviewedCandidates).toHaveBeenCalledWith(
        'rev-target',
        1,
        20,
        'reviewed',
        undefined,
        undefined,
        'reviewedAt',
        'DESC',
      );
    });

    it('allows ADMIN to query all candidates regardless of reviewer when reviewerId is omitted', async () => {
      const adminUser = { id: 'admin-1', role: 'ADMIN' };
      service.getReviewedCandidates.mockResolvedValue({ items: [], total: 0 });

      await controller.getReviewedCandidates(adminUser, {
        status: 'reviewed',
      });

      expect(service.getReviewedCandidates).toHaveBeenCalledWith(
        undefined,
        1,
        20,
        'reviewed',
        undefined,
        undefined,
        'reviewedAt',
        'DESC',
      );
    });

    it('getMyReviewedCandidates calls getReviewedCandidates', async () => {
      service.getReviewedCandidates.mockResolvedValue(mockReviewedResult);

      const res = await controller.getMyReviewedCandidates(mockUser, {
        page: 1,
        pageSize: 20,
        status: 'unprocessed',
      });

      expect(res).toEqual(mockReviewedResult);
      expect(service.getReviewedCandidates).toHaveBeenCalledWith(
        mockUser.id,
        1,
        20,
        'unprocessed',
        undefined,
        undefined,
        'reviewedAt',
        'DESC',
      );
    });
  });
});
