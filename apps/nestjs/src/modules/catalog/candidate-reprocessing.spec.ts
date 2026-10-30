import { NotFoundException } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';

describe('CandidateReprocessingSpec (Flow 10 & Req 4.10)', () => {
  let catalogService: CatalogService;
  let catalogController: CatalogController;

  const mockSignTypes = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
  };

  const mockCategories = {
    findOne: jest.fn(),
  };

  const mockSignTypeImages = {
    find: jest.fn(),
    findOne: jest.fn(),
    remove: jest.fn(),
    save: jest.fn(),
  };

  const mockDataSource = {
    query: jest.fn(),
    transaction: jest.fn(),
  };

  const mockCatalogSyncService = {
    syncLabels: jest.fn(),
    rebuildPrototypes: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    catalogService = new CatalogService(
      mockCategories as any,
      mockSignTypes as any,
      {} as any, // prompts
      mockSignTypeImages as any,
      {} as any, // osm
      {} as any, // systemParams
      mockDataSource as any,
      mockCatalogSyncService as any,
    );
    catalogController = new CatalogController(catalogService);
  });

  it('REP-001: should trigger candidate reprocessing and query candidate pool', async () => {
    mockSignTypes.findOne.mockResolvedValue({
      id: 205,
      signCode: 'W.235',
    });

    mockDataSource.query
      .mockResolvedValueOnce([
        {
          id: 'cand-1',
          submission_id: 'sub-1',
          confidence_score: 0.45,
          status: 'PENDING_REVIEW',
        },
      ]) // candidates query
      .mockResolvedValueOnce([]) // update candidate
      .mockResolvedValueOnce([]); // insert history

    const res = await catalogService.reprocessUnknownCandidates(205, 0.70);

    expect(res).toBeDefined();
    expect(res.signTypeId).toBe(205);
    expect(res.signCode).toBe('W.235');
    expect(res.reprocessedCount).toBe(1);
    expect(res.upgradedCount).toBe(1);
  });

  it('REP-002: should update candidate prediction and status when similarity >= threshold', async () => {
    mockSignTypes.findOne.mockResolvedValue({
      id: 301,
      signCode: 'P.102',
    });

    mockDataSource.query
      .mockResolvedValueOnce([
        {
          id: 'cand-upgrade-1',
          submission_id: 'sub-99',
          confidence_score: 0.35,
          status: 'MISSING_TYPE_HOLD',
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await catalogService.reprocessUnknownCandidates(301, 0.70);

    expect(mockDataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE unverified_sign_candidates'),
      [301, 0.85, 'cand-upgrade-1'],
    );
  });

  it('REP-003: should leave candidates untouched when similarity is below threshold', async () => {
    mockSignTypes.findOne.mockResolvedValue({
      id: 404,
      signCode: 'I.401',
    });

    mockDataSource.query.mockResolvedValueOnce([
      {
        id: 'cand-low-1',
        submission_id: 'sub-55',
        confidence_score: 0.2,
        status: 'REJECTED',
      },
    ]);

    // High threshold: 0.95 (sim 0.85 is below this)
    const res = await catalogService.reprocessUnknownCandidates(404, 0.95);

    expect(res.reprocessedCount).toBe(1);
    expect(res.upgradedCount).toBe(0);
    expect(mockDataSource.query).toHaveBeenCalledTimes(1); // Only the SELECT, no UPDATE
  });

  it('REP-004: should insert audit status history for re-matched candidate', async () => {
    mockSignTypes.findOne.mockResolvedValue({
      id: 505,
      signCode: 'R.301',
    });

    mockDataSource.query
      .mockResolvedValueOnce([
        {
          id: 'cand-audit-1',
          submission_id: 'sub-audit-1',
          confidence_score: 0.4,
          status: 'REJECTED',
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await catalogService.reprocessUnknownCandidates(505, 0.70);

    expect(mockDataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO submission_status_history'),
      [
        'sub-audit-1',
        'REJECTED',
        expect.stringContaining('Auto-reprocessed candidate cand-audit-1 against new catalog sign type #505 (R.301)'),
      ],
    );
  });

  it('REP-005: should throw NotFoundException when sign type does not exist', async () => {
    mockSignTypes.findOne.mockResolvedValue(null);

    await expect(
      catalogService.reprocessUnknownCandidates(99999),
    ).rejects.toThrow(NotFoundException);
  });

  it('REP-006: controller should route reprocessCandidates properly', async () => {
    mockSignTypes.findOne.mockResolvedValue({
      id: 606,
      signCode: 'W.201',
    });

    mockDataSource.query.mockResolvedValueOnce([]); // 0 candidates

    const res = await catalogController.reprocessCandidates(606, { similarityThreshold: 0.80 });

    expect(res.signTypeId).toBe(606);
    expect(res.reprocessedCount).toBe(0);
  });
});
