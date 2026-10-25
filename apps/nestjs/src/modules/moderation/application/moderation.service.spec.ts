import { DataSource, Repository } from 'typeorm';
import { ModerationCase } from '../infrastructure/persistence/moderation-case.entity';
import { ModerationAction } from '../infrastructure/persistence/moderation-action.entity';
import { MissingSignTypeReport, MissingTypeStatus } from '../infrastructure/persistence/missing-sign-type-report.entity';
import { SignCategory } from '../../catalog/sign-category.entity';
import { TrafficSignType } from '../../catalog/traffic-sign-type.entity';
import { UnverifiedSignCandidate, CandidateStatus } from '../../survey/infrastructure/persistence/unverified-sign-candidate.entity';
import { NotificationsService } from '../../notifications/notifications.service';
import { CatalogService } from '../../catalog/catalog.service';
import { CatalogSyncService } from '../../../integrations/catalog-sync/catalog-sync.service';
import { ModerationService } from './moderation.service';

describe('ModerationService (Scenario #4: missing sign type)', () => {
  function buildService() {
    const cases = { findOne: jest.fn(), findAndCount: jest.fn().mockResolvedValue([[], 0]), find: jest.fn().mockResolvedValue([]), save: jest.fn((v: any) => v), create: jest.fn((v: any) => v) };
    const actions = { create: jest.fn((v: any) => v), save: jest.fn((v: any) => v), find: jest.fn().mockResolvedValue([]) };
    const missing = { findOne: jest.fn(), findAndCount: jest.fn().mockResolvedValue([[], 0]), save: jest.fn((v: any) => v) };
    const catRepo = { findOne: jest.fn(), create: jest.fn((v: any) => v), save: jest.fn((v: any) => v) };
    const signTypeRepo = { findOne: jest.fn(), create: jest.fn((v: any) => v), save: jest.fn((v: any) => v) };
    const candRepo = { findOne: jest.fn(), update: jest.fn().mockResolvedValue(undefined), create: jest.fn((v: any) => v), save: jest.fn((v: any) => v) };
    const dataSource = { query: jest.fn().mockResolvedValue([]), transaction: jest.fn() };
    const notifications = { create: jest.fn().mockResolvedValue(undefined), createBulk: jest.fn().mockResolvedValue(undefined) };
    const catalogService = { createSignType: jest.fn() };
    const catalogSyncService = { syncLabels: jest.fn().mockResolvedValue(undefined) };
    const service = new ModerationService(
      cases as unknown as Repository<ModerationCase>,
      actions as unknown as Repository<ModerationAction>,
      missing as unknown as Repository<MissingSignTypeReport>,
      catRepo as unknown as Repository<SignCategory>,
      signTypeRepo as unknown as Repository<TrafficSignType>,
      candRepo as unknown as Repository<UnverifiedSignCandidate>,
      dataSource as unknown as DataSource,
      notifications as unknown as NotificationsService,
      catalogService as unknown as CatalogService,
      catalogSyncService as unknown as CatalogSyncService,
    );
    return { service, cases, actions, missing, catRepo, signTypeRepo, candRepo, dataSource, notifications, catalogService, catalogSyncService };
  }

  it('parks the candidate on MISSING_TYPE_HOLD when a reviewer reports a missing type', async () => {
    const { service, candRepo, missing, catRepo, dataSource } = buildService();
    catRepo.findOne.mockResolvedValue({ id: 1, code: 'PROHIBITORY' });
    const manager = {
      query: jest.fn()
        .mockResolvedValueOnce([{ id: 'C1', status: CandidateStatus.PENDING_REVIEW }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'C1' }]),
      create: jest.fn((_e: any, d: any) => ({ ...d })),
      save: jest.fn(async (r: any) => ({ ...r, id: 'report-1' })),
    };
    dataSource.transaction.mockImplementation((fn: (m: any) => any) => fn(manager));

    const result = await service.reportMissingType('U1', {
      candidateId: 'C1',
      proposedCategoryId: 1,
    });

    expect(manager.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('FOR UPDATE'),
      ['C1'],
    );
    expect(manager.create).toHaveBeenCalledWith(MissingSignTypeReport, expect.objectContaining({
      candidateId: 'C1',
      proposedName: null,
      proposedCategoryId: 1,
    }));
    expect(manager.query).toHaveBeenLastCalledWith(
      expect.stringContaining("SET status = $2"),
      ['C1', CandidateStatus.MISSING_TYPE_HOLD],
    );
    expect(candRepo.findOne).not.toHaveBeenCalled();
    expect(missing.findOne).not.toHaveBeenCalled();
    expect(result.id).toBe('report-1');
  });

  it('rejects a report without a candidate or legacy proposed name', async () => {
    const { service, dataSource } = buildService();

    await expect(service.reportMissingType('U1', {} as any)).rejects.toThrow(
      'candidateId is required when no proposedName is provided',
    );

    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('preserves legacy reports that provide a proposed name without a candidate', async () => {
    const { service, dataSource } = buildService();
    const manager = {
      create: jest.fn((_e: any, d: any) => ({ ...d })),
      save: jest.fn(async (r: any) => ({ ...r, id: 'legacy-report' })),
    };
    dataSource.transaction.mockImplementation((fn: (m: any) => any) => fn(manager));

    const result = await service.reportMissingType('U1', { proposedName: 'No Horn' });

    expect(manager.create).toHaveBeenCalledWith(MissingSignTypeReport, expect.objectContaining({
      candidateId: null,
      proposedName: 'No Horn',
    }));
    expect(result.id).toBe('legacy-report');
  });

  it('rejects duplicate active reports for a candidate', async () => {
    const { service, dataSource } = buildService();
    const manager = {
      query: jest.fn()
        .mockResolvedValueOnce([{ id: 'C1', status: CandidateStatus.PENDING_REVIEW }])
        .mockResolvedValueOnce([{ id: 'report-existing' }]),
      create: jest.fn(),
      save: jest.fn(),
    };
    dataSource.transaction.mockImplementation((fn: (m: any) => any) => fn(manager));

    await expect(service.reportMissingType('U1', { candidateId: 'C1' })).rejects.toThrow(
      'An active new-sign report already exists for candidate C1',
    );

    expect(manager.create).not.toHaveBeenCalled();
    expect(manager.query).toHaveBeenCalledTimes(2);
  });

  it('rejecting a report marks the linked candidate REJECTED and notifies the reporter', async () => {
    const { service, missing, candRepo, dataSource, notifications } = buildService();
    missing.findOne.mockResolvedValue({ id: 'R1', status: MissingTypeStatus.PENDING, candidateId: 'C1', proposedName: 'No Horn', reporterId: 'U1' });
    candRepo.findOne.mockResolvedValue({ id: 'C1', status: CandidateStatus.MISSING_TYPE_HOLD });
    dataSource.query.mockResolvedValue([]);

    await service.updateMissingReport('R1', 'staff-1', { status: MissingTypeStatus.REJECTED });

    expect(candRepo.update).toHaveBeenCalledWith({ id: 'C1' }, { status: CandidateStatus.REJECTED });
    expect(notifications.create).toHaveBeenCalledWith('U1', 'MISSING_TYPE_REJECTED', expect.any(String), expect.any(String), 'missing_sign_type_report', 'R1');
  });

  it('returns reopened PENDING reports with replacement candidate evidence in the Staff queue', async () => {
    const { service, missing, dataSource } = buildService();
    missing.findAndCount.mockResolvedValue([[{ id: 'R1', status: MissingTypeStatus.PENDING, candidateId: 'C1' }], 1]);
    dataSource.query.mockResolvedValue([{
      id: 'C1', predicted_sign_type_id: 7, confidence_score: 0.9,
      best_frame_url: 'stm-sign-crops/recaptures/frame.jpg',
      sign_crop_url: 'stm-sign-crops/recaptures/crop.jpg', status: CandidateStatus.MISSING_TYPE_HOLD,
      longitude: 106.6, latitude: 10.7,
    }]);
    const result = await service.listMissingReports(MissingTypeStatus.PENDING, 1, 20);
    expect(result.items[0]).toMatchObject({
      id: 'R1', status: MissingTypeStatus.PENDING,
      candidate: expect.objectContaining({
        bestFrameUrl: 'stm-sign-crops/recaptures/frame.jpg',
        signCropUrl: 'stm-sign-crops/recaptures/crop.jpg',
        status: CandidateStatus.MISSING_TYPE_HOLD,
      }),
    });
  });

  it('creates an associated recapture request and resolves a moderation case transactionally', async () => {
    const { service, cases, dataSource } = buildService();
    cases.findOne.mockResolvedValue({ id: 'CASE1', status: 'IN_REVIEW', targetEntityType: 'candidate', targetEntityId: 'C1' });
    const manager = {
      query: jest.fn()
        .mockResolvedValueOnce([{ id: 'CASE1', status: 'IN_REVIEW', target_entity_id: 'C1' }])
        .mockResolvedValueOnce([{ id: 'C1', status: CandidateStatus.MISSING_TYPE_HOLD, surveyor_id: 'SURV1' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'REPORT1' }])
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'CASE1', status: 'RESOLVED', target_entity_id: 'C1' }])
        .mockResolvedValueOnce([]),
    };
    dataSource.transaction.mockImplementation((fn: (m: any) => any) => fn(manager));

    const result = await service.resolveCase('CASE1', 'STAFF1', {
      actionType: 'REQUEST_RECAPTURE',
      resolutionNote: 'Please recapture',
    } as any);

    expect(result.status).toBe('RESOLVED');
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('missing_type_report_id'),
      ['C1', 'STAFF1', 'SURV1', 'REPORT1', 'Please recapture'],
    );
  });

  it('rejects ambiguous moderation recapture association before changing case or candidate', async () => {
    const { service, cases, dataSource } = buildService();
    cases.findOne.mockResolvedValue({ id: 'CASE1', status: 'IN_REVIEW', targetEntityType: 'candidate', targetEntityId: 'C1' });
    const manager = {
      query: jest.fn()
        .mockResolvedValueOnce([{ id: 'CASE1', status: 'IN_REVIEW', target_entity_id: 'C1' }])
        .mockResolvedValueOnce([{ id: 'C1', status: CandidateStatus.MISSING_TYPE_HOLD, surveyor_id: 'SURV1' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'REPORT1' }, { id: 'REPORT2' }]),
    };
    dataSource.transaction.mockImplementation((fn: (m: any) => any) => fn(manager));

    await expect(service.resolveCase('CASE1', 'STAFF1', { actionType: 'REQUEST_RECAPTURE' } as any))
      .rejects.toThrow('expected exactly one INCOMPLETE');
    expect(manager.query).not.toHaveBeenCalledWith(expect.stringContaining("SET status = 'RECAPTURE_REQUESTED'"), expect.anything());
  });

  it('approve-and-create-type provisions the sign type, bumps catalog version, releases the held candidate and triggers AI label sync', async () => {
    const { service, missing, catRepo, signTypeRepo, dataSource, notifications, catalogService, catalogSyncService } = buildService();
    const report = { id: 'R1', status: MissingTypeStatus.PENDING, candidateId: 'C1', proposedName: 'No Horn', proposedCategoryId: 1, reporterId: 'U1', suggestedShape: 'CIRCLE', suggestedColorScheme: null };
    missing.findOne.mockResolvedValue(report);
    catRepo.findOne.mockResolvedValue({ id: 1, code: 'PROHIBITORY' });
    signTypeRepo.findOne.mockResolvedValue(null);
    catalogService.createSignType.mockResolvedValue({ id: 42, signCode: 'P.128' });
    dataSource.query.mockResolvedValue([]);

    const result = await service.approveAndCreateType('R1', 'staff-1', {
      signCode: 'P.128',
      nameVi: 'Cấm bấm còi',
      nameEn: 'No Horn',
      proposedCategoryId: 1,
      aiLabelPrompt: 'a circular white sign with red border showing a crossed-out horn',
    });

    expect(catalogService.createSignType).toHaveBeenCalledWith(expect.objectContaining({ signCode: 'P.128', categoryId: 1, nameVi: 'Cấm bấm còi' }));
    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('catalog_versions'), ['staff-1', expect.any(String), 42]);
    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE unverified_sign_candidates'), [42, 'C1']);
    expect(missing.save).toHaveBeenCalledWith(expect.objectContaining({ status: MissingTypeStatus.APPROVED, mergedIntoSignTypeId: 42 }));
    expect(notifications.create).toHaveBeenCalledWith('U1', expect.stringContaining('MISSING_TYPE_APPROVED'), expect.any(String), expect.any(String), 'missing_sign_type_report', 'R1');
    expect(catalogSyncService.syncLabels).toHaveBeenCalledTimes(1);
    expect(result.createdSignType).toMatchObject({ id: 42, signCode: 'P.128' });
    expect(result.report).toMatchObject({ status: MissingTypeStatus.APPROVED });
  });

  it('approve-and-create-type completes approval even if bumpCatalogVersion or candidate release throws', async () => {
    const { service, missing, catRepo, signTypeRepo, dataSource, catalogService } = buildService();
    const report = { id: 'R1', status: MissingTypeStatus.PENDING, candidateId: 'C1', proposedName: 'No Horn', proposedCategoryId: 1, reporterId: 'U1' };
    missing.findOne.mockResolvedValue(report);
    catRepo.findOne.mockResolvedValue({ id: 1, code: 'PROHIBITORY' });
    signTypeRepo.findOne.mockResolvedValue(null);
    catalogService.createSignType.mockResolvedValue({ id: 42, signCode: 'P.128' });
    dataSource.query.mockImplementation(async (sql: string) => {
      if (sql.includes('catalog_versions') || sql.includes('UPDATE unverified_sign_candidates')) {
        throw new Error('PostgreSQL error');
      }
      return [];
    });

    const result = await service.approveAndCreateType('R1', 'staff-1', {
      signCode: 'P.128',
      nameVi: 'Cấm bấm còi',
      nameEn: 'No Horn',
      proposedCategoryId: 1,
    });

    expect(missing.save).toHaveBeenCalledWith(expect.objectContaining({ status: MissingTypeStatus.APPROVED, mergedIntoSignTypeId: 42 }));
    expect(result.createdSignType).toMatchObject({ id: 42, signCode: 'P.128' });
    expect(result.report).toMatchObject({ status: MissingTypeStatus.APPROVED });
  });

  it('approve-and-create-type reuses existing sign type if signCode already exists (idempotent retry)', async () => {
    const { service, missing, catRepo, signTypeRepo, dataSource, catalogService } = buildService();
    const report = { id: 'R1', status: MissingTypeStatus.PENDING, candidateId: 'C1', proposedName: 'No Horn', proposedCategoryId: 1, reporterId: 'U1' };
    missing.findOne.mockResolvedValue(report);
    catRepo.findOne.mockResolvedValue({ id: 1, code: 'PROHIBITORY' });
    signTypeRepo.findOne.mockResolvedValue({ id: 751, signCode: 'T.404' });
    dataSource.query.mockResolvedValue([]);

    const result = await service.approveAndCreateType('R1', 'staff-1', {
      signCode: 'T.404',
      nameVi: 'Biển T.404',
      nameEn: 'Sign T.404',
      proposedCategoryId: 1,
    });

    expect(catalogService.createSignType).not.toHaveBeenCalled();
    expect(missing.save).toHaveBeenCalledWith(expect.objectContaining({ status: MissingTypeStatus.APPROVED, mergedIntoSignTypeId: 751 }));
    expect(result.createdSignType).toMatchObject({ id: 751, signCode: 'T.404' });
    expect(result.report).toMatchObject({ status: MissingTypeStatus.APPROVED });
  });

  it('syncs ModerationCase when a missing-type report is escalated to Admin and handles filter aliases', async () => {
    const { service, missing, cases, dataSource } = buildService();
    const report = { id: 'R-ESC', status: MissingTypeStatus.PENDING, candidateId: 'C1', staffNotes: 'Novel sign needing review' };
    missing.findOne.mockResolvedValue(report);
    cases.findOne.mockResolvedValue(null);
    cases.create.mockImplementation((c) => c);
    cases.save.mockImplementation(async (c) => c);
    missing.save.mockImplementation(async (r) => r);
    dataSource.query.mockResolvedValue([]);

    await service.updateMissingReport('R-ESC', 'staff-1', { status: 'IN_REVIEW', staffNotes: 'Escalated to admin' });

    expect(report.status).toBe(MissingTypeStatus.ESCALATED_ADMIN);
    expect(cases.create).toHaveBeenCalledWith(expect.objectContaining({
      caseType: 'CATALOG_PROPOSAL',
      targetEntityType: 'missing_sign_type_report',
      targetEntityId: 'R-ESC',
      assignedStaffId: 'staff-1',
      status: 'PENDING',
    }));
    expect(cases.save).toHaveBeenCalled();

    missing.findAndCount.mockResolvedValue([[ { id: 'R-ESC', status: MissingTypeStatus.ESCALATED_ADMIN, candidateId: 'C1' } ], 1]);
    const listResult = await service.listMissingReports('APPROVED', 1, 10);
    expect(listResult.items[0]).toMatchObject({
      id: 'R-ESC',
      status: 'IN_REVIEW',
      rawStatus: MissingTypeStatus.ESCALATED_ADMIN,
    });
  });
});
