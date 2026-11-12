import { ForbiddenException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ModerationCase } from '../infrastructure/persistence/moderation-case.entity';
import { ModerationAction } from '../infrastructure/persistence/moderation-action.entity';
import { MissingSignTypeReport, MissingTypeStatus } from '../infrastructure/persistence/missing-sign-type-report.entity';
import { SignCategory } from '../../catalog/sign-category.entity';
import { TrafficSignType } from '../../catalog/traffic-sign-type.entity';
import { UnverifiedSignCandidate, CandidateStatus } from '../../survey/infrastructure/persistence/unverified-sign-candidate.entity';
import { CandidateRecaptureRequest } from '../../reviews/infrastructure/persistence/candidate-recapture-request.entity';
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
    const dataSource = {
      query: jest.fn().mockImplementation((sql: string) =>
        sql.includes('SELECT DISTINCT split_part')
          ? [{ prefix: 'P' }, { prefix: 'W' }, { prefix: 'I' }]
          : [],
      ),
      transaction: jest.fn(),
    };
    const notifications = { create: jest.fn().mockResolvedValue(undefined), createBulk: jest.fn().mockResolvedValue(undefined) };
    const catalogService = { createSignType: jest.fn() };
    const catalogSyncService = { syncLabels: jest.fn().mockResolvedValue(undefined) };
    const minioStorageService = {
      putObject: jest.fn().mockResolvedValue(undefined),
      getPublicUrl: jest.fn().mockImplementation((_bucket: string, objectName: string) => 'https://s3.test/' + objectName),
      removeObject: jest.fn().mockResolvedValue(undefined),
    };
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
      minioStorageService as any,
    );
    return { service, cases, actions, missing, catRepo, signTypeRepo, candRepo, dataSource, notifications, catalogService, catalogSyncService, minioStorageService };
  }

  function representativeImage(): Express.Multer.File {
    return {
      originalname: 'sign.jpg',
      mimetype: 'image/jpeg',
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00]),
      size: 4,
    } as Express.Multer.File;
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
      originalReporterId: 'U1',
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

  it('rejects a report without a candidate', async () => {
    const { service, dataSource } = buildService();

    await expect(service.reportMissingType('U1', {} as any)).rejects.toThrow(
      'candidateId is required',
    );

    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('rejects a name-only report without a candidate', async () => {
    const { service, dataSource } = buildService();
    await expect(service.reportMissingType('U1', { proposedName: 'No Horn' } as any))
      .rejects.toThrow('candidateId is required');
    expect(dataSource.transaction).not.toHaveBeenCalled();
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
      ['C1', 'staff-1', 'R1', 'Please recapture from the same location.'],
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
    expect(notifications.create).toHaveBeenCalledTimes(1);
  });

  it('creates an open recapture quest without requiring a preselected active surveyor', async () => {
    const { service, dataSource, missing } = buildService();
    missing.findOne.mockResolvedValue({
      id: 'R1',
      status: MissingTypeStatus.INCOMPLETE,
      candidateId: 'C1',
    });
    const manager = {
      query: jest.fn()
        .mockResolvedValueOnce([{
          id: 'R1',
          candidate_id: 'C1',
          reporter_id: 'U1',
          proposed_name: null,
          status: MissingTypeStatus.PENDING,
        }])
        .mockResolvedValueOnce([{ id: 'C1', status: CandidateStatus.MISSING_TYPE_HOLD }])
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
      expect.stringContaining('INSERT INTO candidate_recapture_requests'),
      ['C1', 'staff-1', 'R1', 'Please recapture from the same location.'],
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

  it('bans the original reviewer selected for a new-sign report', async () => {
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
          original_reporter_id: 'ORIGINAL_REVIEWER',
          proposed_name: 'Unknown sign',
          status: MissingTypeStatus.ESCALATED_ADMIN,
          reviewed_by: 'STAFF1',
        }])
        .mockResolvedValueOnce([{ id: 'ORIGINAL_REVIEWER', status: 'ACTIVE' }])
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
    expect(result.bannedUser).toEqual({ id: 'ORIGINAL_REVIEWER', oldStatus: 'ACTIVE', newStatus: 'BANNED' });
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM users u'),
      ['ORIGINAL_REVIEWER', 'REVIEWER'],
    );
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO user_status_history'),
      ['ORIGINAL_REVIEWER', 'ACTIVE', 'Confirmed abuse of reporting.', 'ADMIN1'],
    );
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('ADMIN_NEW_SIGN_USER_BAN'),
      [
        'ADMIN1',
        'ORIGINAL_REVIEWER',
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
      ['CASE1', 'BAN_USER', 'ADMIN1', 'REVIEWER user ORIGINAL_REVIEWER banned: Confirmed abuse of reporting.'],
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
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO candidate_recapture_requests'),
      ['C1', 'ADMIN1', 'R1', 'Image evidence is insufficient.'],
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
        .mockResolvedValueOnce([{ id: 'C1', status: CandidateStatus.MISSING_TYPE_HOLD }])
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
      ['C1', 'STAFF1', 'REPORT1', 'Please recapture'],
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

  it('throws ForbiddenException when non-admin staff attempts to resolveCase with APPROVED actionType', async () => {
    const { service, cases } = buildService();
    cases.findOne.mockResolvedValue({ id: 'CASE1', status: 'IN_REVIEW', targetEntityType: 'missing_sign_type_report', targetEntityId: 'R1' });

    await expect(service.resolveCase('CASE1', 'STAFF1', { actionType: 'APPROVED', reportId: 'R1' } as any, 'STAFF'))
      .rejects.toThrow(ForbiddenException);
  });

  it('allows resolveCase with APPROVED actionType when userRole is array containing ADMIN', async () => {
    const { service, cases, missing, catRepo, catalogService } = buildService();
    cases.findOne.mockResolvedValue({ id: 'CASE1', status: 'IN_REVIEW', targetEntityType: 'missing_sign_type_report', targetEntityId: 'R1' });
    missing.findOne.mockResolvedValue({ id: 'R1', status: MissingTypeStatus.PENDING, proposedCategoryId: 1 });
    catRepo.findOne.mockResolvedValue({ id: 1, code: 'PROHIBITORY' });
    catalogService.createSignType.mockResolvedValue({ id: 42, signCode: 'P.128a' });

    await service.resolveCase('CASE1', 'ADMIN1', { actionType: 'APPROVED', reportId: 'R1' } as any, ['ADMIN', 'STAFF']);
    expect(cases.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'RESOLVED' }));
  });

  it('resolveCase returns idempotently when a CATALOG_PROPOSAL case is already RESOLVED and its report is APPROVED', async () => {
    const { service, cases, missing } = buildService();
    const resolvedCase = {
      id: 'CASE1',
      caseType: 'CATALOG_PROPOSAL',
      status: 'RESOLVED',
      targetEntityType: 'missing_sign_type_report',
      targetEntityId: 'R1',
    };
    cases.findOne.mockResolvedValue(resolvedCase);
    missing.findOne.mockResolvedValue({ id: 'R1', status: MissingTypeStatus.APPROVED });

    const res = await service.resolveCase('CASE1', 'ADMIN1', { actionType: 'APPROVED', reportId: 'R1' } as any, ['ADMIN']);
    expect(res).toBe(resolvedCase);
    expect(cases.save).not.toHaveBeenCalled();
  });

  it('approve-and-create-type automatically closes open moderation cases for the approved report', async () => {
    const { service, cases, actions, missing, catRepo, signTypeRepo, dataSource, catalogService } = buildService();
    const report = { id: 'R1', status: MissingTypeStatus.ESCALATED_ADMIN, candidateId: null, proposedName: 'No Horn', proposedCategoryId: 1, reporterId: 'U1' };
    const openCase = { id: 'CASE-OPEN', caseType: 'CATALOG_PROPOSAL', targetEntityType: 'missing_sign_type_report', targetEntityId: 'R1', status: 'PENDING', assignedStaffId: null };
    missing.findOne.mockResolvedValue(report);
    catRepo.findOne.mockResolvedValue({ id: 1, code: 'PROHIBITORY' });
    signTypeRepo.findOne.mockResolvedValue(null);
    catalogService.createSignType.mockResolvedValue({ id: 42, signCode: 'P.128a' });
    cases.find.mockResolvedValue([openCase]);
    dataSource.query.mockImplementation((sql: string) =>
      sql.includes('SELECT DISTINCT split_part') ? [{ prefix: 'P' }] : [],
    );

    await service.approveAndCreateType('R1', 'ADMIN1', {
      signCode: 'P.128a',
      nameVi: 'Cấm bấm còi',
      nameEn: 'No Horn',
      proposedCategoryId: 1,
      allowedVehicles: ['CAR'],
      staffNotes: 'ok',
    }, representativeImage());

    expect(cases.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'CASE-OPEN', status: 'RESOLVED', resolutionNote: 'ok' }));
    expect(actions.save).toHaveBeenCalledWith(expect.objectContaining({ caseId: 'CASE-OPEN', actionType: 'APPROVED', performedBy: 'ADMIN1' }));
  });

  it('normalizes status OPEN to PENDING in listCases', async () => {
    const { service, cases } = buildService();
    cases.findAndCount.mockResolvedValue([[], 0]);

    await service.listCases('OPEN', 1, 10);
    expect(cases.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'PENDING' },
      }),
    );
  });

  it('approve-and-create-type provisions the sign type, bumps catalog version, releases the held candidate and triggers AI label sync', async () => {
    const { service, missing, catRepo, signTypeRepo, candRepo, dataSource, notifications, catalogService, catalogSyncService, minioStorageService } = buildService();
    const report = { id: 'R1', status: MissingTypeStatus.PENDING, candidateId: 'C1', proposedName: 'No Horn', proposedCategoryId: 1, reporterId: 'U1', suggestedShape: 'CIRCLE', suggestedColorScheme: null };
    missing.findOne.mockResolvedValue(report);
    catRepo.findOne.mockResolvedValue({ id: 1, code: 'PROHIBITORY' });
    signTypeRepo.findOne.mockResolvedValue(null);
    catalogService.createSignType.mockResolvedValue({ id: 42, signCode: 'P.128a' });
    dataSource.query.mockImplementation((sql: string) =>
      sql.includes('SELECT DISTINCT split_part')
        ? [{ prefix: 'P' }, { prefix: 'W' }, { prefix: 'I' }]
        : [],
    );

    const result = await service.approveAndCreateType('R1', 'staff-1', {
      signCode: 'P. 128A',
      nameVi: 'Cáº¥m báº¥m cÃ²i',
      nameEn: 'No Horn',
      proposedCategoryId: 1,
      aiLabelPrompt: 'a circular white sign with red border showing a crossed-out horn',
      allowedVehicles: ['CAR', 'MOTORCYCLE'],
    }, representativeImage());

    expect(catalogService.createSignType).toHaveBeenCalledWith(expect.objectContaining({
      signCode: 'P.128a',
      categoryId: 1,
      nameVi: 'Cáº¥m báº¥m cÃ²i',
      allowedVehicles: ['CAR', 'MOTORCYCLE'],
      representativeImageKey: expect.stringContaining('catalog/representative/P.128a-'),
    }));
    expect(minioStorageService.putObject).toHaveBeenCalledWith(
      'stm-sign-crops',
      expect.stringContaining('catalog/representative/P.128a-'),
      representativeImage().buffer,
      'image/jpeg',
    );
    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('SELECT DISTINCT split_part'));
    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('catalog_versions'), ['staff-1', expect.any(String), 42]);
    expect(candRepo.update).toHaveBeenCalledWith({ id: 'C1', status: CandidateStatus.MISSING_TYPE_HOLD }, { predictedSignTypeId: 42, status: CandidateStatus.PENDING_REVIEW });
    expect(missing.save).toHaveBeenCalledWith(expect.objectContaining({ status: MissingTypeStatus.APPROVED, mergedIntoSignTypeId: 42 }));
    expect(notifications.create).toHaveBeenCalledWith('U1', expect.stringContaining('MISSING_TYPE_APPROVED'), expect.any(String), expect.any(String), 'missing_sign_type_report', 'R1');
    expect(catalogSyncService.syncLabels).toHaveBeenCalledTimes(1);
    expect(result.createdSignType).toMatchObject({ id: 42, signCode: 'P.128a' });
    expect(result.report).toMatchObject({ status: MissingTypeStatus.APPROVED });
  });

  it('approve-and-create-type accepts canonical catalog sign code prefixes', async () => {
    const { service, missing, catRepo, signTypeRepo, dataSource, catalogService } = buildService();
    const report = { id: 'R1', status: MissingTypeStatus.PENDING, candidateId: 'C1', proposedName: 'Test Sign', proposedCategoryId: 1, reporterId: 'U1' };
    missing.findOne.mockResolvedValue(report);
    catRepo.findOne.mockResolvedValue({ id: 1, code: 'PROHIBITORY' });
    signTypeRepo.findOne.mockResolvedValue(null);
    catalogService.createSignType.mockResolvedValue({ id: 99, signCode: 'P.110' });
    dataSource.query.mockImplementation((sql: string) =>
      sql.includes('SELECT DISTINCT split_part') ? [{ prefix: 'P' }] : [],
    );

    const result = await service.approveAndCreateType('R1', 'staff-1', {
      signCode: ' p. 110 ',
      nameVi: 'Biá»ƒn kiá»ƒm thá»­',
      nameEn: 'Testing Sign',
      proposedCategoryId: 1,
      allowedVehicles: ['CAR'],
    }, representativeImage());

    expect(catalogService.createSignType).toHaveBeenCalledWith(expect.objectContaining({
      signCode: 'P.110',
      categoryId: 1,
      nameVi: 'Biá»ƒn kiá»ƒm thá»­',
      representativeImageKey: expect.stringContaining('catalog/representative/P.110-'),
    }));
    expect(result.createdSignType).toMatchObject({ id: 99, signCode: 'P.110' });
  });

  it('approve-and-create-type completes approval even if bumpCatalogVersion or candidate release throws', async () => {
    const { service, missing, catRepo, signTypeRepo, dataSource, catalogService, candRepo } = buildService();
    const report = { id: 'R1', status: MissingTypeStatus.PENDING, candidateId: 'C1', proposedName: 'No Horn', proposedCategoryId: 1, reporterId: 'U1' };
    missing.findOne.mockResolvedValue(report);
    catRepo.findOne.mockResolvedValue({ id: 1, code: 'PROHIBITORY' });
    signTypeRepo.findOne.mockResolvedValue(null);
    catalogService.createSignType.mockResolvedValue({ id: 42, signCode: 'P.128' });
    candRepo.update.mockRejectedValueOnce(new Error('PostgreSQL error'));
    dataSource.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT DISTINCT split_part')) return [{ prefix: 'P' }];
      if (sql.includes('catalog_versions') || sql.includes('UPDATE unverified_sign_candidates')) {
        throw new Error('PostgreSQL error');
      }
      return [];
    });

    const result = await service.approveAndCreateType('R1', 'staff-1', {
      signCode: 'P.128',
      nameVi: 'Cáº¥m báº¥m cÃ²i',
      nameEn: 'No Horn',
      proposedCategoryId: 1,
      allowedVehicles: ['CAR'],
    }, representativeImage());

    expect(missing.save).toHaveBeenCalledWith(expect.objectContaining({ status: MissingTypeStatus.APPROVED, mergedIntoSignTypeId: 42 }));
    expect(result.createdSignType).toMatchObject({ id: 42, signCode: 'P.128' });
    expect(result.report).toMatchObject({ status: MissingTypeStatus.APPROVED });
  });

  it('rejects an existing sign code instead of silently approving a different report into it', async () => {
    const { service, missing, catRepo, signTypeRepo, dataSource, catalogService } = buildService();
    const report = { id: 'R1', status: MissingTypeStatus.PENDING, candidateId: 'C1', proposedName: 'No Horn', proposedCategoryId: 1, reporterId: 'U1' };
    missing.findOne.mockResolvedValue(report);
    catRepo.findOne.mockResolvedValue({ id: 1, code: 'PROHIBITORY' });
    signTypeRepo.findOne.mockResolvedValue({ id: 751, signCode: 'P.128a' });
    dataSource.query.mockImplementation((sql: string) =>
      sql.includes('SELECT DISTINCT split_part') ? [{ prefix: 'P' }] : [],
    );

    await expect(service.approveAndCreateType('R1', 'staff-1', {
      signCode: 'P.128a',
      nameVi: 'Biá»ƒn P.128',
      nameEn: 'Sign P.128',
      proposedCategoryId: 1,
      allowedVehicles: ['CAR'],
    }, representativeImage())).rejects.toThrow('sign_code "P.128a" exists');

    expect(catalogService.createSignType).not.toHaveBeenCalled();
    expect(missing.save).not.toHaveBeenCalled();
    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('SELECT DISTINCT split_part'));
  });

  it('requires a valid image upload, sign-code prefix, and numbered sign-code format before creating a type', async () => {
    const { service, missing, catRepo, signTypeRepo, dataSource } = buildService();
    missing.findOne.mockResolvedValue({
      id: 'R1',
      status: MissingTypeStatus.PENDING,
      proposedName: 'Unknown sign',
    });
    catRepo.findOne.mockResolvedValue({ id: 1 });
    signTypeRepo.findOne.mockResolvedValue(null);

    await expect(service.approveAndCreateType('R1', 'ADMIN1', {
      signCode: 'P.128',
      allowedVehicles: ['CAR'],
    })).rejects.toThrow('Representative image upload is required');

    await expect(service.approveAndCreateType('R1', 'ADMIN1', {
      signCode: 'CUSTOM',
      allowedVehicles: ['CAR'],
    }, representativeImage())).rejects.toThrow('signCode must match PREFIX.number');

    await expect(service.approveAndCreateType('R1', 'ADMIN1', {
      signCode: 'X.128',
      allowedVehicles: ['CAR'],
    }, representativeImage())).rejects.toThrow('signCode prefix must match an existing catalog prefix');

    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('SELECT DISTINCT split_part'));
  });

  it('does not approve a report when catalog creation fails and removes the uploaded image', async () => {
    const { service, missing, catRepo, signTypeRepo, catalogService, minioStorageService } = buildService();
    missing.findOne.mockResolvedValue({
      id: 'R1',
      status: MissingTypeStatus.PENDING,
      proposedName: 'Unknown sign',
    });
    catRepo.findOne.mockResolvedValue({ id: 1 });
    signTypeRepo.findOne.mockResolvedValue(null);
    catalogService.createSignType.mockRejectedValue(new Error('catalog insert failed'));

    await expect(service.approveAndCreateType('R1', 'ADMIN1', {
      signCode: 'P.128a',
      allowedVehicles: ['CAR'],
    }, representativeImage())).rejects.toThrow('catalog insert failed');

    expect(missing.save).not.toHaveBeenCalled();
    expect(minioStorageService.putObject).toHaveBeenCalledTimes(1);
    expect(minioStorageService.removeObject).toHaveBeenCalledWith({
      bucket: 'stm-sign-crops',
      objectName: expect.stringContaining('catalog/representative/P.128a-'),
    });
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

  it('uses pessimistic row lock without aggregate COUNT() when Admin requests recapture via TypeORM repositories', async () => {
    const { service, missing, dataSource } = buildService();
    missing.findOne.mockResolvedValue({
      id: 'R-REPO',
      status: MissingTypeStatus.INCOMPLETE,
      candidateId: 'C-REPO',
      reporterId: 'REV1',
    });

    const makeQb = (overrides: Record<string, any> = {}) => {
      const qb: any = {
        setLock: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
        getOne: jest.fn().mockResolvedValue(null),
        getMany: jest.fn().mockResolvedValue([]),
        getCount: jest.fn().mockImplementation(() => {
          throw new Error('FOR UPDATE is not allowed with aggregate functions');
        }),
        ...overrides,
      };
      return qb;
    };

    const reportLockQb = makeQb({
      getOne: jest.fn().mockResolvedValue({
        id: 'R-REPO',
        candidateId: 'C-REPO',
        reporterId: 'REV1',
        proposedName: 'TEst 6',
        status: MissingTypeStatus.PENDING,
      }),
    });
    const reportUpdateQb = makeQb();
    const candLockQb = makeQb({
      getOne: jest.fn().mockResolvedValue({
        id: 'C-REPO',
        status: CandidateStatus.PENDING_REVIEW,
      }),
    });
    const candUpdateQb = makeQb();
    const recCheckQb = makeQb({ getMany: jest.fn().mockResolvedValue([]) });
    const recRepo = {
      createQueryBuilder: jest.fn(() => recCheckQb),
      create: jest.fn((v: any) => v),
      save: jest.fn(async (v: any) => v),
    };
    const caseQb = makeQb({
      getOne: jest.fn().mockResolvedValue({ id: 'CASE-REPO', status: 'PENDING' }),
    });
    const caseRepo = {
      createQueryBuilder: jest.fn(() => caseQb),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      create: jest.fn((v: any) => v),
      save: jest.fn(async (v: any) => v),
    };
    const actionRepo = {
      create: jest.fn((v: any) => v),
      save: jest.fn(async (v: any) => v),
    };

    const manager = {
      getRepository: jest.fn((entity: any) => {
        if (entity === MissingSignTypeReport) {
          return {
            createQueryBuilder: jest.fn((alias?: string) => (alias ? reportLockQb : reportUpdateQb)),
          };
        }
        if (entity === UnverifiedSignCandidate) {
          return {
            createQueryBuilder: jest.fn((alias?: string) => (alias ? candLockQb : candUpdateQb)),
          };
        }
        if (entity === CandidateRecaptureRequest) return recRepo;
        if (entity === ModerationCase) return caseRepo;
        if (entity === ModerationAction) return actionRepo;
        return {};
      }),
    };
    dataSource.transaction.mockImplementation((fn: (m: any) => any) => fn(manager));

    const result = await service.applyAdminMissingReportAction('R-REPO', 'ADMIN1', {
      actionType: 'REQUEST_RECAPTURE',
      reason: 'Need clearer field photo',
    });

    expect(result).toMatchObject({ id: 'R-REPO', status: MissingTypeStatus.INCOMPLETE });
    expect(recCheckQb.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(recCheckQb.select).toHaveBeenCalledWith(['r.id']);
    expect(recCheckQb.getMany).toHaveBeenCalled();
    expect(recCheckQb.getCount).not.toHaveBeenCalled();
    expect(recRepo.create).toHaveBeenCalledWith(expect.objectContaining({
      candidateId: 'C-REPO',
      missingTypeReportId: 'R-REPO',
      newSignTypeReportId: 'R-REPO',
    }));
    expect(caseRepo.update).toHaveBeenCalledWith('CASE-REPO', expect.objectContaining({
      status: 'RESOLVED',
      resolutionNote: 'Need clearer field photo',
    }));
  });

  it('strips leading # when searching listMissingReports and listCases by UUID or report name', async () => {
    const { service, missing, cases, dataSource } = buildService();
    const reportQb: any = {
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([
        [{ id: '288661b8-6eea-42af-8800-caf67895dbd3', status: MissingTypeStatus.PENDING, proposedName: 'TEst 6' }],
        1,
      ]),
    };
    (missing as any).createQueryBuilder = jest.fn(() => reportQb);

    const caseQb: any = {
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([
        [{
          id: 'case-1',
          caseType: 'CATALOG_PROPOSAL',
          targetEntityType: 'missing_sign_type_report',
          targetEntityId: '288661b8-6eea-42af-8800-caf67895dbd3',
          status: 'PENDING',
        }],
        1,
      ]),
    };
    (cases as any).createQueryBuilder = jest.fn(() => caseQb);
    dataSource.query.mockResolvedValue([
      {
        id: '288661b8-6eea-42af-8800-caf67895dbd3',
        proposed_name: 'TEst 6',
        status: 'ESCALATED_ADMIN',
        reporter_id: 'u-1',
        reporter_name: 'Demo User',
        reporter_email: 'demo@stm.dev',
      },
    ]);

    const repRes = await service.listMissingReports(undefined, 1, 20, '#288661b8');
    expect(repRes.total).toBe(1);
    expect(reportQb.andWhere).toHaveBeenCalledWith(expect.any(String), { pattern: '%288661b8%' });

    const caseRes = await service.listCases(undefined, 1, 20, '#288661b8-6eea-42af-8800-caf67895dbd3');
    expect(caseRes.total).toBe(1);
    expect(caseQb.andWhere).toHaveBeenCalledWith(expect.any(String), {
      pattern: '%288661b8-6eea-42af-8800-caf67895dbd3%',
    });
    expect(caseRes.items[0]).toMatchObject({
      proposedName: 'TEst 6',
      targetTitle: 'TEst 6',
    });
  });
});
