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

  it('rejects a staff action when the report is no longer actionable', async () => {
    const { service, missing } = buildService();
    missing.findOne.mockResolvedValue({ id: 'R1', status: MissingTypeStatus.MERGED });

    await expect(service.updateMissingReport('R1', 'staff-1', { actionType: 'REJECT' }))
      .rejects.toThrow('Report must be PENDING or INCOMPLETE');
    expect(missing.save).not.toHaveBeenCalled();
  });

  it('escalates a report with preliminary notes and records an audit action', async () => {
    const { service, missing, dataSource } = buildService();
    const report = {
      id: 'R1',
      status: MissingTypeStatus.PENDING,
      candidateId: null,
      reporterId: 'U1',
      proposedName: 'Unknown sign',
      staffNotes: null,
    };
    missing.findOne
      .mockResolvedValueOnce(report)
      .mockResolvedValueOnce({ ...report, status: MissingTypeStatus.ESCALATED_ADMIN });
    const manager = {
      query: jest.fn()
        .mockResolvedValueOnce([{ id: 'R1', status: MissingTypeStatus.PENDING }])
        .mockResolvedValueOnce([{ id: 'R1' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'CASE1' }])
        .mockResolvedValueOnce([]),
    };
    dataSource.transaction.mockImplementation((fn: (m: any) => any) => fn(manager));

    await service.updateMissingReport('R1', 'staff-1', {
      actionType: 'ESCALATE_ADMIN',
      staffNotes: 'Possible regulatory sign; needs admin review.',
    });

    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('SET status = $2, staff_notes = $3'),
      ['R1', MissingTypeStatus.ESCALATED_ADMIN, 'Possible regulatory sign; needs admin review.', 'staff-1', MissingTypeStatus.PENDING],
    );
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining("'ESCALATE_ADMIN'"),
      ['CASE1', 'staff-1', 'Possible regulatory sign; needs admin review.'],
    );
  });

  it('requires preliminary notes before escalating a report', async () => {
    const { service, missing, cases } = buildService();
    missing.findOne.mockResolvedValue({ id: 'R1', status: MissingTypeStatus.PENDING });

    await expect(service.updateMissingReport('R1', 'staff-1', { actionType: 'ESCALATE_ADMIN' }))
      .rejects.toThrow('staffNotes is required for ESCALATE_ADMIN');
    expect(cases.save).not.toHaveBeenCalled();
  });

  it('rejects a report and its held candidate atomically with an audit action', async () => {
    const { service, missing, dataSource, notifications } = buildService();
    const report = {
      id: 'R1',
      status: MissingTypeStatus.PENDING,
      candidateId: 'C1',
      reporterId: 'U1',
      proposedName: 'Unknown sign',
    };
    missing.findOne
      .mockResolvedValueOnce(report)
      .mockResolvedValueOnce({ ...report, status: MissingTypeStatus.REJECTED });
    const manager = {
      query: jest.fn()
        .mockResolvedValueOnce([{
          id: 'R1',
          candidate_id: 'C1',
          reporter_id: 'U1',
          proposed_name: 'Unknown sign',
          status: MissingTypeStatus.PENDING,
        }])
        .mockResolvedValueOnce([{ id: 'C1', status: CandidateStatus.MISSING_TYPE_HOLD }])
        .mockResolvedValueOnce([{ id: 'R1' }])
        .mockResolvedValueOnce([{ id: 'C1' }])
        .mockResolvedValueOnce([{ id: 'CASE1' }])
        .mockResolvedValueOnce([]),
    };
    dataSource.transaction.mockImplementation((fn: (m: any) => any) => fn(manager));

    await service.updateMissingReport('R1', 'staff-1', { actionType: 'REJECT' });

    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE unverified_sign_candidates'),
      ['C1', CandidateStatus.REJECTED, null, CandidateStatus.MISSING_TYPE_HOLD],
    );
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining("VALUES ($1, $2, $3, $4)"),
      ['CASE1', 'REJECT', 'staff-1', null],
    );
    expect(notifications.create).toHaveBeenCalledWith(
      'U1', 'MISSING_TYPE_REJECTED', expect.any(String), expect.any(String),
      'missing_sign_type_report', 'R1',
    );
  });

  it('preserves catalog merge semantics while applying the staff merge transactionally', async () => {
    const { service, missing, signTypeRepo, dataSource } = buildService();
    const report = {
      id: 'R1',
      status: MissingTypeStatus.PENDING,
      candidateId: 'C1',
      reporterId: 'U1',
      proposedName: 'Unknown sign',
    };
    missing.findOne
      .mockResolvedValueOnce(report)
      .mockResolvedValueOnce({ ...report, status: MissingTypeStatus.MERGED, mergedIntoSignTypeId: 42 });
    signTypeRepo.findOne.mockResolvedValue({ id: 42 });
    const manager = {
      query: jest.fn()
        .mockResolvedValueOnce([{ id: 'R1', candidate_id: 'C1', reporter_id: 'U1', proposed_name: 'Unknown sign', status: MissingTypeStatus.PENDING }])
        .mockResolvedValueOnce([{ id: 'C1', status: CandidateStatus.MISSING_TYPE_HOLD }])
        .mockResolvedValueOnce([{ id: 'R1' }])
        .mockResolvedValueOnce([{ id: 'C1' }])
        .mockResolvedValueOnce([{ id: 'CASE1' }])
        .mockResolvedValueOnce([]),
    };
    dataSource.transaction.mockImplementation((fn: (m: any) => any) => fn(manager));

    await service.updateMissingReport('R1', 'staff-1', {
      actionType: 'MERGE',
      mergedSignTypeId: 42,
    });

    expect(signTypeRepo.findOne).toHaveBeenCalledWith({ where: { id: 42 } });
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('SET status = $2, predicted_sign_type_id'),
      ['C1', CandidateStatus.PENDING_REVIEW, 42, CandidateStatus.MISSING_TYPE_HOLD],
    );
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining("VALUES ($1, $2, $3, $4)"),
      ['CASE1', 'MERGE', 'staff-1', null],
    );
  });

  it('requests a report-linked recapture and updates report, candidate, case, and audit atomically', async () => {
    const { service, missing, dataSource, notifications } = buildService();
    const report = {
      id: 'R1',
      status: MissingTypeStatus.INCOMPLETE,
      candidateId: 'C1',
      reporterId: 'U1',
      proposedName: null,
    };
    missing.findOne.mockResolvedValue(report);
    const manager = {
      query: jest.fn()
        .mockResolvedValueOnce([{
          id: 'R1',
          candidate_id: 'C1',
          reporter_id: 'U1',
          proposed_name: null,
          status: MissingTypeStatus.PENDING,
        }])
        .mockResolvedValueOnce([{
          id: 'C1',
          status: CandidateStatus.MISSING_TYPE_HOLD,
          surveyor_id: 'SURVEYOR1',
        }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'R1' }])
        .mockResolvedValueOnce([{ id: 'C1' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'CASE1' }])
        .mockResolvedValueOnce([]),
    };
    dataSource.transaction.mockImplementation((fn: (m: any) => any) => fn(manager));

    const result = await service.updateMissingReport('R1', 'staff-1', {
      actionType: 'REQUEST_RECAPTURE',
      actionNote: 'Please recapture from the same location.',
    });

    expect(result).toMatchObject({ id: 'R1', status: MissingTypeStatus.INCOMPLETE });
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('missing_type_report_id'),
      ['C1', 'staff-1', 'SURVEYOR1', 'R1', 'Please recapture from the same location.'],
    );
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining("SET status = $2"),
      ['C1', CandidateStatus.RECAPTURE_REQUESTED, CandidateStatus.MISSING_TYPE_HOLD],
    );
    expect(notifications.create).toHaveBeenCalledWith(
      'U1',
      'MISSING_TYPE_INCOMPLETE',
      expect.any(String),
      expect.any(String),
      'missing_sign_type_report',
      'R1',
    );
    expect(notifications.create).toHaveBeenCalledWith(
      'SURVEYOR1',
      'IMAGE_RECAPTURE_REQUESTED',
      expect.any(String),
      'Please recapture from the same location.',
      'candidate',
      'C1',
    );
  });

  it('rejects an escalated report through the admin decision path and records the action', async () => {
    const { service, missing, dataSource, notifications } = buildService();
    missing.findOne.mockResolvedValue({
      id: 'R1',
      status: MissingTypeStatus.REJECTED,
      candidateId: null,
      reporterId: 'REVIEWER1',
      proposedName: null,
    });
    const manager = {
      query: jest.fn()
        .mockResolvedValueOnce([{
          id: 'R1',
          candidate_id: null,
          reporter_id: 'REVIEWER1',
          proposed_name: null,
          status: MissingTypeStatus.ESCALATED_ADMIN,
        }])
        .mockResolvedValueOnce([{ id: 'R1' }])
        .mockResolvedValueOnce([{ id: 'CASE1' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
    };
    dataSource.transaction.mockImplementation((fn: (m: any) => any) => fn(manager));

    const result = await service.applyAdminMissingReportAction('R1', 'ADMIN1', {
      actionType: 'REJECT',
      reason: 'Evidence does not support the report.',
    });

    if (!('status' in result)) throw new Error('Expected admin report rejection response');
    expect(result.status).toBe(MissingTypeStatus.REJECTED);
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO moderation_actions'),
      ['CASE1', 'REJECT', 'ADMIN1', 'Evidence does not support the report.'],
    );
    expect(notifications.create).toHaveBeenCalledWith(
      'REVIEWER1', 'MISSING_TYPE_REJECTED', expect.any(String), expect.any(String),
      'missing_sign_type_report', 'R1',
    );
  });

  it('requires a ban target and reason for admin ban decisions', async () => {
    const { service, dataSource } = buildService();

    await expect(service.applyAdminMissingReportAction('R1', 'ADMIN1', {
      actionType: 'BAN_USER',
      reason: 'Policy violation',
    })).rejects.toThrow('banTarget is required for BAN_USER');
    await expect(service.applyAdminMissingReportAction('R1', 'ADMIN1', {
      actionType: 'REJECT',
      reason: '   ',
    })).rejects.toThrow('reason is required for an admin decision');
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('bans only the selected report reporter and atomically records status history and moderation audit', async () => {
    const { service, missing, dataSource, notifications } = buildService();
    missing.findOne.mockResolvedValue({
      id: 'R1',
      status: MissingTypeStatus.REJECTED,
      candidateId: null,
      reporterId: 'REVIEWER1',
      proposedName: 'Unknown sign',
    });
    const manager = {
      query: jest.fn()
        .mockResolvedValueOnce([{
          id: 'R1',
          candidate_id: null,
          reporter_id: 'REVIEWER1',
          proposed_name: 'Unknown sign',
          status: MissingTypeStatus.ESCALATED_ADMIN,
          reviewed_by: 'STAFF1',
        }])
        .mockResolvedValueOnce([{ id: 'REVIEWER1', status: 'ACTIVE' }])
        .mockResolvedValueOnce([{ id: 'R1' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'CASE1' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
    };
    dataSource.transaction.mockImplementation((fn: (m: any) => any) => fn(manager));

    const result = await service.applyAdminMissingReportAction('R1', 'ADMIN1', {
      actionType: 'BAN_USER',
      banTarget: 'REVIEWER',
      reason: 'Confirmed abuse of reporting.',
    });

    if (!('bannedUser' in result)) throw new Error('Expected admin ban response');
    expect(result.bannedUser).toEqual({ id: 'REVIEWER1', oldStatus: 'ACTIVE', newStatus: 'BANNED' });
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM users u'),
      ['REVIEWER1', 'REVIEWER'],
    );
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO user_status_history'),
      ['REVIEWER1', 'ACTIVE', 'Confirmed abuse of reporting.', 'ADMIN1'],
    );
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('ADMIN_NEW_SIGN_USER_BAN'),
      [
        'ADMIN1',
        'REVIEWER1',
        JSON.stringify({ status: 'ACTIVE' }),
        JSON.stringify({
          status: 'BANNED',
          reason: 'Confirmed abuse of reporting.',
          reportId: 'R1',
          targetRole: 'REVIEWER',
        }),
      ],
    );
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO moderation_actions'),
      ['CASE1', 'BAN_USER', 'ADMIN1', 'REVIEWER user REVIEWER1 banned: Confirmed abuse of reporting.'],
    );
    expect(notifications.create).toHaveBeenCalled();
  });

  it('lets Admin request recapture from an escalated report and resolves the escalation case', async () => {
    const { service, missing, dataSource } = buildService();
    missing.findOne.mockResolvedValue({
      id: 'R1',
      status: MissingTypeStatus.INCOMPLETE,
      candidateId: 'C1',
      reporterId: 'REVIEWER1',
      proposedName: 'Unknown sign',
    });
    const manager = {
      query: jest.fn()
        .mockResolvedValueOnce([{
          id: 'R1',
          candidate_id: 'C1',
          reporter_id: 'REVIEWER1',
          proposed_name: 'Unknown sign',
          status: MissingTypeStatus.ESCALATED_ADMIN,
        }])
        .mockResolvedValueOnce([{
          id: 'C1',
          status: CandidateStatus.MISSING_TYPE_HOLD,
          surveyor_id: 'SURVEYOR1',
        }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'R1' }])
        .mockResolvedValueOnce([{ id: 'C1' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'ESCALATION_CASE' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
    };
    dataSource.transaction.mockImplementation((fn: (m: any) => any) => fn(manager));

    const result = await service.applyAdminMissingReportAction('R1', 'ADMIN1', {
      actionType: 'REQUEST_RECAPTURE',
      reason: 'Image evidence is insufficient.',
    });

    if (!('status' in result)) throw new Error('Expected admin recapture response');
    expect(result.status).toBe(MissingTypeStatus.INCOMPLETE);
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE id = $1 AND status = $5'),
      ['R1', MissingTypeStatus.INCOMPLETE, 'Image evidence is insufficient.', 'ADMIN1', MissingTypeStatus.ESCALATED_ADMIN],
    );
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE moderation_cases'),
      ['ESCALATION_CASE', 'RESOLVED', 'Image evidence is insufficient.'],
    );
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
