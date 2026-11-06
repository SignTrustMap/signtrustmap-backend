import { CandidatesController } from './candidates.controller';
import { ReviewsService } from '../application/reviews.service';

describe('CandidatesController', () => {
  let controller: CandidatesController;
  let service: {
    getReviewedCandidates: jest.Mock;
  };

  const mockUser = { id: 'rev-1', email: 'reviewer@stm.dev', role: 'REVIEWER' };

  beforeEach(() => {
    service = {
      getReviewedCandidates: jest.fn(),
    };
    controller = new CandidatesController(service as unknown as ReviewsService);
  });

  it('getCandidates passes authenticated user id and query options to service', async () => {
    const mockResponse = {
      items: [{ id: 'cand-1', status: 'IN_CONSENSUS', lifecycleStatus: 'IN_CONSENSUS', statusTag: 'IN_CONSENSUS' }],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
      counts: { ALL: 1, PENDING_REVIEW: 0, IN_CONSENSUS: 1, RESOLVED: 0, all: 1, unprocessed: 0, inReview: 1, reviewed: 0 },
      categories: [
        { id: 'ALL', label: 'Tất cả trạng thái', count: 1 },
        { id: 'PENDING_REVIEW', label: 'Chưa xử lý', count: 0 },
        { id: 'IN_CONSENSUS', label: 'Đang xem xét', count: 1 },
        { id: 'RESOLVED', label: 'Đã giải quyết', count: 0 },
      ],
    };
    service.getReviewedCandidates.mockResolvedValue(mockResponse);

    const res = await controller.getCandidates(mockUser, {
      page: 1,
      pageSize: 20,
      status: 'in_review',
      sortBy: 'reviewedAt',
      sortOrder: 'DESC',
    });

    expect(res).toEqual(mockResponse);
    expect(service.getReviewedCandidates).toHaveBeenCalledWith(
      'rev-1',
      1,
      20,
      'in_review',
      undefined,
      undefined,
      'reviewedAt',
      'DESC',
    );
  });

  it('allows ADMIN to specify reviewerId', async () => {
    const adminUser = { id: 'admin-1', role: 'ADMIN' };
    service.getReviewedCandidates.mockResolvedValue({ items: [], total: 0 });

    await controller.getCandidates(adminUser, {
      reviewerId: 'rev-999',
      status: 'Chưa xử lý',
    });

    expect(service.getReviewedCandidates).toHaveBeenCalledWith(
      'rev-999',
      1,
      20,
      'Chưa xử lý',
      undefined,
      undefined,
      'reviewedAt',
      'DESC',
    );
  });

  it('allows ADMIN to view all candidates regardless of person involved when reviewerId is omitted', async () => {
    const adminUser = { id: 'admin-1', role: 'ADMIN' };
    service.getReviewedCandidates.mockResolvedValue({ items: [], total: 0 });

    await controller.getCandidates(adminUser, {
      status: 'Chưa xử lý',
    });

    expect(service.getReviewedCandidates).toHaveBeenCalledWith(
      undefined,
      1,
      20,
      'Chưa xử lý',
      undefined,
      undefined,
      'reviewedAt',
      'DESC',
    );
  });
});

