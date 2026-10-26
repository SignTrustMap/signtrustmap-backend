import { Injectable, NotFoundException, BadRequestException, ConflictException, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager, In, ILike } from 'typeorm';
import { randomUUID } from 'crypto';
import { MissingSignTypeReport, MissingTypeStatus } from '../infrastructure/persistence/missing-sign-type-report.entity';
import { ModerationAction } from '../infrastructure/persistence/moderation-action.entity';
import { ModerationCase, ModerationStatus, ModerationType } from '../infrastructure/persistence/moderation-case.entity';
import { SignCategory } from '../../catalog/sign-category.entity';
import { TrafficSignType } from '../../catalog/traffic-sign-type.entity';
import { UnverifiedSignCandidate, CandidateStatus } from '../../survey/infrastructure/persistence/unverified-sign-candidate.entity';
import { CreateMissingTypeReportDto, ResolveCaseDto, UpdateMissingTypeReportDto, ApproveAndCreateTypeDto, AdminMissingTypeActionDto } from '../presentation/dto/moderation.dto';
import { NotificationsService } from '../../notifications/notifications.service';
import { CatalogService } from '../../catalog/catalog.service';
import { CatalogSyncService } from '../../../integrations/catalog-sync/catalog-sync.service';
import { MinioStorageService, STM_BUCKETS } from '../../../integrations/minio/minio-storage.service';
import { VEHICLE_TYPES } from '../../../common/vehicle-types';
import { validateFileSignature } from '../../survey/domain/media-validator';
import { MediaFileType } from '../../survey/domain/submission-contract';

export interface CandidateEnriched {
  id: string;
  predictedSignTypeId: number;
  confidenceScore: number;
  bestFrameUrl: string;
  signCropUrl: string;
  status: string;
  longitude: number | null;
  latitude: number | null;
}

function getAffectedRowCount(result: any): number {
  if (typeof result?.rowCount === 'number') return result.rowCount;
  if (Array.isArray(result) && typeof result[1] === 'number') return result[1];
  if (Array.isArray(result)) return result.length;
  return 0;
}

@Injectable()
export class ModerationService {
  private readonly logger = new Logger(ModerationService.name);
  constructor(
    @InjectRepository(ModerationCase) private cases: Repository<ModerationCase>,
    @InjectRepository(ModerationAction) private actions: Repository<ModerationAction>,
    @InjectRepository(MissingSignTypeReport) private missing: Repository<MissingSignTypeReport>,
    @InjectRepository(SignCategory) private catRepo: Repository<SignCategory>,
    @InjectRepository(TrafficSignType) private signTypeRepo: Repository<TrafficSignType>,
    @InjectRepository(UnverifiedSignCandidate) private candRepo: Repository<UnverifiedSignCandidate>,
    private readonly dataSource: DataSource,
    private readonly notificationsService: NotificationsService,
    private readonly catalogService: CatalogService,
    private readonly catalogSyncService: CatalogSyncService,
    @Optional() private readonly minioStorageService?: MinioStorageService,
  ) {}

  /**
   * Reviewer reports a sign that is not in the catalog yet.
   * The linked candidate is atomically parked in MISSING_TYPE_HOLD so the
   * review/consensus queue stops offering it until staff resolve the report.
   */
  async reportMissingType(reporterId: string, dto: CreateMissingTypeReportDto) {
    const proposedName = dto.proposedName?.trim() || null;
    if (!dto.candidateId && !proposedName) {
      throw new BadRequestException('candidateId is required when no proposedName is provided');
    }

    return this.dataSource.transaction(async (manager) => {
      if (dto.candidateId) {
        const candidates: Array<{ id: string; status: CandidateStatus }> = await manager.query(
          `SELECT id, status
           FROM unverified_sign_candidates
           WHERE id = $1
           FOR UPDATE`,
          [dto.candidateId],
        );
        const candidate = candidates[0];
        if (!candidate) throw new NotFoundException('Candidate ' + dto.candidateId + ' not found');
        if (![CandidateStatus.PENDING_REVIEW, CandidateStatus.IN_CONSENSUS].includes(candidate.status)) {
          throw new BadRequestException('Candidate ' + dto.candidateId + ' is not available for a new-sign report');
        }

        const activeReports: Array<{ id: string }> = await manager.query(
          `SELECT id
           FROM missing_sign_type_reports
           WHERE candidate_id = $1 AND status NOT IN ('MERGED', 'APPROVED', 'REJECTED')
           LIMIT 1`,
          [dto.candidateId],
        );
        if (activeReports.length > 0) {
          throw new ConflictException('An active new-sign report already exists for candidate ' + dto.candidateId);
        }
      }
      if (dto.proposedCategoryId != null) {
        const cat = await this.catRepo.findOne({ where: { id: dto.proposedCategoryId } });
        if (!cat) throw new BadRequestException('SignCategory #' + dto.proposedCategoryId + ' not found');
      }
      const r = manager.create(MissingSignTypeReport, {
        reporterId,
        candidateId: dto.candidateId ?? null,
        proposedCategoryId: dto.proposedCategoryId ?? null,
        proposedName,
        description: dto.description ?? null,
        suggestedShape: dto.suggestedShape ?? null,
        suggestedColorScheme: dto.suggestedColorScheme ?? null,
      } as any);
      const saved = (await manager.save(r)) as unknown as MissingSignTypeReport;
      if (dto.candidateId) {
        const updatedCandidates: Array<{ id: string }> = await manager.query(
          `UPDATE unverified_sign_candidates
           SET status = $2
           WHERE id = $1 AND status IN ('PENDING_REVIEW', 'IN_CONSENSUS')
           RETURNING id`,
          [dto.candidateId, CandidateStatus.MISSING_TYPE_HOLD],
        );
        if (getAffectedRowCount(updatedCandidates) !== 1) {
          throw new ConflictException('Candidate ' + dto.candidateId + ' changed state while reporting a new sign');
        }
        this.logger.log('Parked candidate ' + dto.candidateId + ' on MISSING_TYPE_HOLD (report ' + saved.id + ')');
      }
      return saved;
    });
  }

  async listMissingReports(status?: string, page = 1, pageSize = 20) {
    const p = Math.max(1, page), ps = Math.min(Math.max(1, pageSize), 100);
    const where: any = {};
    if (status) {
      const upper = status.toUpperCase();
      if (upper === 'OPEN') {
        where.status = MissingTypeStatus.PENDING;
      } else if (upper === 'APPROVED') {
        where.status = In([MissingTypeStatus.APPROVED, MissingTypeStatus.ESCALATED_ADMIN]);
      } else if (upper === 'IN_REVIEW' || upper === 'ESCALATED') {
        where.status = MissingTypeStatus.ESCALATED_ADMIN;
      } else {
        const allowed = Object.values(MissingTypeStatus);
        if (!allowed.includes(upper as MissingTypeStatus)) throw new BadRequestException('status must be one of ' + allowed.join(', '));
        where.status = upper;
      }
    }
    const [items, total] = await this.missing.findAndCount({ where, order: { createdAt: 'DESC' }, skip: (p - 1) * ps, take: ps });
    const enriched = await this.enrichWithCandidates(items);
    return { items: enriched, total, page: p, pageSize: ps, totalPages: Math.ceil(total / ps) };
  }

  async updateMissingReport(reportId: string, reviewerId: string, dto: UpdateMissingTypeReportDto) {
    if (dto.actionType) {
      const report = await this.missing.findOne({ where: { id: reportId } as any });
      if (!report) throw new NotFoundException('MissingSignTypeReport ' + reportId + ' not found');
      if (![MissingTypeStatus.PENDING, MissingTypeStatus.INCOMPLETE].includes(report.status)) {
        throw new BadRequestException('Report must be PENDING or INCOMPLETE to perform a staff action');
      }

      const notes = dto.staffNotes ?? dto.actionNote;
      switch (dto.actionType) {
        case 'MERGE': {
          const signTypeId = dto.mergedSignTypeId ?? dto.mergedIntoSignTypeId;
          if (signTypeId == null) throw new BadRequestException('mergedSignTypeId is required for MERGE');
          if (dto.status && dto.status !== MissingTypeStatus.MERGED) {
            throw new BadRequestException('status conflicts with MERGE action');
          }
          return this.applyStaffReportDecision(reportId, reviewerId, 'MERGE', Number(signTypeId), notes ?? null);
        }
        case 'REJECT':
          if (dto.status && dto.status !== MissingTypeStatus.REJECTED) {
            throw new BadRequestException('status conflicts with REJECT action');
          }
          return this.applyStaffReportDecision(reportId, reviewerId, 'REJECT', null, notes ?? null);
        case 'ESCALATE_ADMIN': {
          if (!notes?.trim()) throw new BadRequestException('staffNotes is required for ESCALATE_ADMIN');
          if (report.status !== MissingTypeStatus.PENDING) {
            throw new BadRequestException('Only PENDING reports can be escalated to Admin');
          }
          if (dto.status && !['IN_REVIEW', 'ESCALATED', MissingTypeStatus.ESCALATED_ADMIN].includes(dto.status)) {
            throw new BadRequestException('status conflicts with ESCALATE_ADMIN action');
          }
          return this.escalateMissingReportToAdmin(reportId, reviewerId, notes.trim());
        }
        case 'REQUEST_RECAPTURE':
          if (dto.status && dto.status !== MissingTypeStatus.INCOMPLETE) {
            throw new BadRequestException('status conflicts with REQUEST_RECAPTURE action');
          }
          return this.requestMissingReportRecapture(reportId, reviewerId, notes?.trim() || null);
        default:
          throw new BadRequestException('Unsupported staff action');
      }
    }

    const report: any = await this.missing.findOne({ where: { id: reportId } as any });
    if (!report) throw new NotFoundException('MissingSignTypeReport ' + reportId + ' not found');
    let requestedStatus = dto.status;
    if (requestedStatus === 'IN_REVIEW' || requestedStatus === 'ESCALATED') requestedStatus = MissingTypeStatus.ESCALATED_ADMIN;
    else if (requestedStatus === 'OPEN') requestedStatus = MissingTypeStatus.PENDING;
    const allowed = Object.values(MissingTypeStatus);
    if (requestedStatus && !allowed.some((status) => status === requestedStatus)) throw new BadRequestException('status must be one of ' + allowed.join(', '));
    const mergedId = dto.mergedSignTypeId ?? dto.mergedIntoSignTypeId;
    if (mergedId != null) {
      const t = await this.signTypeRepo.findOne({ where: { id: Number(mergedId) } });
      if (!t) throw new BadRequestException('TrafficSignType #' + mergedId + ' not found');
      report.mergedIntoSignTypeId = Number(mergedId);
    }
    const previousStatus = report.status;
    if (requestedStatus) report.status = requestedStatus;
    if (dto.staffNotes != null) report.staffNotes = dto.staffNotes;
    else if (dto.actionNote != null) report.staffNotes = dto.actionNote;
    if (dto.suggestedShape != null) report.suggestedShape = dto.suggestedShape;
    if (dto.suggestedColorScheme != null) report.suggestedColorScheme = dto.suggestedColorScheme;
    report.reviewedBy = reviewerId;
    await this.missing.save(report);

    if (report.status === MissingTypeStatus.ESCALATED_ADMIN) {
      const existingCase = await this.cases.findOne({
        where: { targetEntityType: 'missing_sign_type_report', targetEntityId: report.id },
      });
      if (!existingCase) {
        const newCase = this.cases.create({
          caseType: ModerationType.CATALOG_PROPOSAL,
          targetEntityType: 'missing_sign_type_report',
          targetEntityId: report.id,
          assignedStaffId: reviewerId,
          status: ModerationStatus.PENDING,
          resolutionNote: report.staffNotes || 'Escalated to Admin for Catalog creation',
        });
        await this.cases.save(newCase);
      } else if (existingCase.status !== ModerationStatus.RESOLVED) {
        existingCase.assignedStaffId = reviewerId;
        if (report.staffNotes) existingCase.resolutionNote = report.staffNotes;
        await this.cases.save(existingCase);
      }
    }

    await this.applyCandidateSideEffect(report as MissingSignTypeReport, previousStatus);
    return (await this.enrichWithCandidates([report as MissingSignTypeReport]))[0];
  }

  private async applyStaffReportDecision(
    reportId: string,
    staffId: string,
    decision: 'MERGE' | 'REJECT',
    signTypeId: number | null,
    note: string | null,
  ) {
    if (decision === 'MERGE') {
      const signType = await this.signTypeRepo.findOne({ where: { id: signTypeId as number } });
      if (!signType) throw new BadRequestException('TrafficSignType #' + signTypeId + ' not found');
    }

    const result = await this.dataSource.transaction(async (manager) => {
      const reportRows: any[] = await manager.query(
        `SELECT id, candidate_id, reporter_id, proposed_name, status
         FROM missing_sign_type_reports
         WHERE id = $1
         FOR UPDATE`,
        [reportId],
      );
      const report = reportRows[0];
      if (!report) throw new NotFoundException('MissingSignTypeReport ' + reportId + ' not found');
      if (![MissingTypeStatus.PENDING, MissingTypeStatus.INCOMPLETE].includes(report.status)) {
        throw new BadRequestException('Report must be PENDING or INCOMPLETE to perform a staff action');
      }

      if (report.candidate_id) {
        const candidates: any[] = await manager.query(
          `SELECT id, status FROM unverified_sign_candidates WHERE id = $1 FOR UPDATE`,
          [report.candidate_id],
        );
        if (!candidates[0]) throw new NotFoundException('Candidate ' + report.candidate_id + ' not found');
        if (candidates[0].status !== CandidateStatus.MISSING_TYPE_HOLD) {
          throw new ConflictException('Candidate must be on MISSING_TYPE_HOLD to resolve this report');
        }
      }

      const nextStatus = decision === 'MERGE' ? MissingTypeStatus.MERGED : MissingTypeStatus.REJECTED;
      const updatedReports: any[] = await manager.query(
        `UPDATE missing_sign_type_reports
         SET status = $2, merged_into_sign_type_id = $3,
             staff_notes = COALESCE($4, staff_notes), reviewed_by = $5, updated_at = NOW()
         WHERE id = $1 AND status IN ($6, $7)
         RETURNING id`,
        [reportId, nextStatus, signTypeId, note, staffId, MissingTypeStatus.PENDING, MissingTypeStatus.INCOMPLETE],
      );
      if (getAffectedRowCount(updatedReports) !== 1) throw new ConflictException('Report state changed before applying staff decision');

      if (report.candidate_id) {
        const candidateStatus = decision === 'MERGE' ? CandidateStatus.PENDING_REVIEW : CandidateStatus.REJECTED;
        const candidateUpdate: any[] = await manager.query(
          `UPDATE unverified_sign_candidates
           SET status = $2, predicted_sign_type_id = COALESCE($3, predicted_sign_type_id)
           WHERE id = $1 AND status = $4
           RETURNING id`,
          [report.candidate_id, candidateStatus, signTypeId, CandidateStatus.MISSING_TYPE_HOLD],
        );
        if (getAffectedRowCount(candidateUpdate) !== 1) throw new ConflictException('Candidate state changed before applying staff decision');
      }

      const caseRows: any[] = await manager.query(
        `INSERT INTO moderation_cases
           (case_type, target_entity_type, target_entity_id, assigned_staff_id, status, resolution_note, resolved_at)
         VALUES ($1, 'missing_sign_type_report', $2, $3, $4, $5, NOW())
         RETURNING id`,
        [ModerationType.CATALOG_PROPOSAL, reportId, staffId, ModerationStatus.RESOLVED, note],
      );
      const caseId = caseRows[0]?.id;
      if (!caseId) throw new Error('Failed to create report decision moderation case');
      await manager.query(
        `INSERT INTO moderation_actions (case_id, action_type, performed_by, note)
         VALUES ($1, $2, $3, $4)`,
        [caseId, decision, staffId, note],
      );
      return { reporterId: report.reporter_id, proposedName: report.proposed_name };
    });

    if (result.reporterId) {
      const isMerge = decision === 'MERGE';
      await this.notifyReporter(
        { id: reportId, reporterId: result.reporterId, proposedName: result.proposedName },
        decision === 'MERGE' ? 'MERGED' : 'REJECTED',
        isMerge ? 'Báo cáo biển báo mới đã được gộp' : 'Báo cáo biển báo mới bị từ chối',
        isMerge
          ? 'Báo cáo "' + (result.proposedName || 'biển báo mới') + '" của bạn đã được gộp vào loại biển báo hiện có #' + signTypeId + '.'
          : 'Báo cáo "' + (result.proposedName || 'biển báo mới') + '" của bạn đã bị nhân viên từ chối.',
      );
    }
    return this.getMissingReport(reportId);
  }

  private async escalateMissingReportToAdmin(reportId: string, staffId: string, note: string) {
    await this.dataSource.transaction(async (manager) => {
      const reportRows: any[] = await manager.query(
        `SELECT id, status FROM missing_sign_type_reports WHERE id = $1 FOR UPDATE`,
        [reportId],
      );
      const report = reportRows[0];
      if (!report) throw new NotFoundException('MissingSignTypeReport ' + reportId + ' not found');
      if (report.status !== MissingTypeStatus.PENDING) {
        throw new BadRequestException('Only PENDING reports can be escalated to Admin');
      }

      const updatedReports: any[] = await manager.query(
        `UPDATE missing_sign_type_reports
         SET status = $2, staff_notes = $3, reviewed_by = $4, updated_at = NOW()
         WHERE id = $1 AND status = $5
         RETURNING id`,
        [reportId, MissingTypeStatus.ESCALATED_ADMIN, note, staffId, MissingTypeStatus.PENDING],
      );
      if (getAffectedRowCount(updatedReports) !== 1) throw new ConflictException('Report state changed before escalation');

      const existingCases: any[] = await manager.query(
        `SELECT id, status FROM moderation_cases
         WHERE target_entity_type = 'missing_sign_type_report' AND target_entity_id = $1
         ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [reportId],
      );
      let caseId = existingCases[0]?.id;
      if (caseId) {
        await manager.query(
          `UPDATE moderation_cases
           SET status = $2, assigned_staff_id = $3, resolution_note = $4, resolved_at = NULL
           WHERE id = $1`,
          [caseId, ModerationStatus.PENDING, staffId, note],
        );
      } else {
        const caseRows: any[] = await manager.query(
          `INSERT INTO moderation_cases
             (case_type, target_entity_type, target_entity_id, assigned_staff_id, status, resolution_note)
           VALUES ($1, 'missing_sign_type_report', $2, $3, $4, $5)
           RETURNING id`,
          [ModerationType.CATALOG_PROPOSAL, reportId, staffId, ModerationStatus.PENDING, note],
        );
        caseId = caseRows[0]?.id;
      }
      if (!caseId) throw new Error('Failed to create admin escalation moderation case');
      await manager.query(
        `INSERT INTO moderation_actions (case_id, action_type, performed_by, note)
         VALUES ($1, 'ESCALATE_ADMIN', $2, $3)`,
        [caseId, staffId, note],
      );
    });

    const escalated = await this.getMissingReport(reportId);
    await this.notifyReporter(
      escalated,
      'ESCALATED_ADMIN',
      'Báo cáo biển báo mới được chuyển lên quản trị viên',
      'Báo cáo "' + (escalated.proposedName || 'biển báo mới') + '" đã được chuyển lên quản trị viên để xem xét.',
    );
    return escalated;
  }

  async applyAdminMissingReportAction(reportId: string, adminId: string, dto: AdminMissingTypeActionDto) {
    const reason = dto.reason?.trim();
    if (!reason) throw new BadRequestException('reason is required for an admin decision');
    if (dto.actionType === 'REQUEST_RECAPTURE') {
      return this.requestMissingReportRecapture(
        reportId,
        adminId,
        reason,
        MissingTypeStatus.ESCALATED_ADMIN,
      );
    }
    if (dto.actionType === 'REJECT') {
      return this.rejectEscalatedReport(reportId, adminId, reason);
    }
    if (dto.actionType === 'BAN_USER') {
      if (!dto.banTarget) throw new BadRequestException('banTarget is required for BAN_USER');
      return this.banInvolvedReportUser(reportId, adminId, dto.banTarget, reason);
    }
    throw new BadRequestException('Unsupported admin action');
  }

  private async rejectEscalatedReport(reportId: string, adminId: string, reason: string) {
    const result = await this.dataSource.transaction(async (manager) => {
      const reportRows: any[] = await manager.query(
        `SELECT id, candidate_id, reporter_id, proposed_name, status
         FROM missing_sign_type_reports
         WHERE id = $1
         FOR UPDATE`,
        [reportId],
      );
      const report = reportRows[0];
      if (!report) throw new NotFoundException('MissingSignTypeReport ' + reportId + ' not found');
      if (report.status !== MissingTypeStatus.ESCALATED_ADMIN) {
        throw new BadRequestException('Only ESCALATED_ADMIN reports can receive admin decisions');
      }

      if (report.candidate_id) {
        const candidates: any[] = await manager.query(
          `SELECT id, status FROM unverified_sign_candidates WHERE id = $1 FOR UPDATE`,
          [report.candidate_id],
        );
        const candidate = candidates[0];
        if (!candidate) throw new NotFoundException('Candidate ' + report.candidate_id + ' not found');
        if (![CandidateStatus.MISSING_TYPE_HOLD, CandidateStatus.RECAPTURE_REQUESTED].includes(candidate.status)) {
          throw new ConflictException('Candidate is not in a state that can be rejected with this report');
        }
        const updatedCandidates: any[] = await manager.query(
          `UPDATE unverified_sign_candidates SET status = $2
           WHERE id = $1 AND status = $3
           RETURNING id`,
          [candidate.id, CandidateStatus.REJECTED, candidate.status],
        );
        if (getAffectedRowCount(updatedCandidates) !== 1) throw new ConflictException('Candidate state changed while rejecting report');
        await manager.query(
          `UPDATE candidate_recapture_requests
           SET completed_at = NOW()
           WHERE candidate_id = $1 AND completed_at IS NULL`,
          [candidate.id],
        );
      }

      const updatedReports: any[] = await manager.query(
        `UPDATE missing_sign_type_reports
         SET status = $2, staff_notes = $3, reviewed_by = $4, updated_at = NOW()
         WHERE id = $1 AND status = $5
         RETURNING id`,
        [reportId, MissingTypeStatus.REJECTED, reason, adminId, MissingTypeStatus.ESCALATED_ADMIN],
      );
      if (getAffectedRowCount(updatedReports) !== 1) throw new ConflictException('Report state changed while applying admin rejection');
      await this.resolveAdminReportCase(manager, reportId, adminId, 'REJECT', reason);
      return { reporterId: report.reporter_id, proposedName: report.proposed_name };
    });

    await this.notifyReporter(
      { id: reportId, reporterId: result.reporterId, proposedName: result.proposedName },
      'REJECTED',
      'Báo cáo biển báo mới bị từ chối',
      'Báo cáo "' + (result.proposedName || 'biển báo mới') + '" đã bị quản trị viên từ chối.',
    );
    return this.getMissingReport(reportId);
  }

  private async banInvolvedReportUser(
    reportId: string,
    adminId: string,
    targetRole: string,
    reason: string,
  ) {
    if (!['SURVEYOR', 'REVIEWER', 'STAFF'].includes(targetRole)) {
      throw new BadRequestException('banTarget must be SURVEYOR, REVIEWER, or STAFF');
    }
    const result = await this.dataSource.transaction(async (manager) => {
      const reportRows: any[] = await manager.query(
        `SELECT id, candidate_id, reporter_id, proposed_name, status, reviewed_by
         FROM missing_sign_type_reports
         WHERE id = $1
         FOR UPDATE`,
        [reportId],
      );
      const report = reportRows[0];
      if (!report) throw new NotFoundException('MissingSignTypeReport ' + reportId + ' not found');
      if (report.status !== MissingTypeStatus.ESCALATED_ADMIN) {
        throw new BadRequestException('Only ESCALATED_ADMIN reports can receive admin decisions');
      }

      let targetRows: any[];
      if (targetRole === 'REVIEWER') {
        targetRows = report.reporter_id ? [{ id: report.reporter_id }] : [];
      } else if (targetRole === 'SURVEYOR') {
        targetRows = report.candidate_id
          ? await manager.query(
            `SELECT COALESCE(
               (SELECT r.surveyor_id
                FROM candidate_recapture_requests r
                WHERE r.candidate_id = $1 AND r.surveyor_id IS NOT NULL
                ORDER BY r.created_at DESC
                LIMIT 1),
               (SELECT s.surveyor_id
                FROM unverified_sign_candidates c
                JOIN survey_submissions s ON s.id = c.submission_id
                WHERE c.id = $1)
             ) AS id`,
            [report.candidate_id],
          )
          : [];
      } else {
        targetRows = await manager.query(
          `SELECT COALESCE(
             (SELECT a.performed_by
              FROM moderation_actions a
              JOIN moderation_cases c ON c.id = a.case_id
              WHERE c.target_entity_type = 'missing_sign_type_report'
                AND c.target_entity_id = $1
                AND a.action_type IN ('ESCALATE_ADMIN', 'REQUEST_RECAPTURE', 'REJECT', 'MERGE')
                AND EXISTS (
                  SELECT 1 FROM user_roles ur
                  JOIN roles role ON role.id = ur.role_id
                  WHERE ur.user_id = a.performed_by AND ur.is_active = TRUE AND role.code = 'STAFF'
                )
              ORDER BY a.performed_at DESC
              LIMIT 1),
             (SELECT $2::uuid WHERE EXISTS (
               SELECT 1 FROM user_roles ur
               JOIN roles role ON role.id = ur.role_id
               WHERE ur.user_id = $2 AND ur.is_active = TRUE AND role.code = 'STAFF'
             ))
           ) AS id`,
          [reportId, report.reviewed_by],
        );
      }

      const targetId = targetRows[0]?.id;
      if (!targetId) throw new BadRequestException('No involved ' + targetRole.toLowerCase() + ' is associated with this report');
      const eligibleUsers: any[] = await manager.query(
        `SELECT u.id, u.status
         FROM users u
         WHERE u.id = $1
           AND EXISTS (
             SELECT 1 FROM user_roles ur
             JOIN roles role ON role.id = ur.role_id
             WHERE ur.user_id = u.id AND ur.is_active = TRUE AND role.code = $2
           )
           AND NOT EXISTS (
             SELECT 1 FROM user_roles ur
             JOIN roles role ON role.id = ur.role_id
             WHERE ur.user_id = u.id AND ur.is_active = TRUE AND role.code = 'ADMIN'
           )
         FOR UPDATE OF u`,
        [targetId, targetRole],
      );
      const target = eligibleUsers[0];
      if (!target) throw new BadRequestException('Selected involved user is not eligible for this ban action');
      if (target.status === 'BANNED') throw new BadRequestException('Selected user is already BANNED');

      if (report.candidate_id) {
        const candidates: any[] = await manager.query(
          `SELECT id, status FROM unverified_sign_candidates WHERE id = $1 FOR UPDATE`,
          [report.candidate_id],
        );
        const candidate = candidates[0];
        if (!candidate) throw new NotFoundException('Candidate ' + report.candidate_id + ' not found');
        if (![CandidateStatus.MISSING_TYPE_HOLD, CandidateStatus.RECAPTURE_REQUESTED].includes(candidate.status)) {
          throw new ConflictException('Candidate is not in a state that can be rejected with this report');
        }
        const updatedCandidates: any[] = await manager.query(
          `UPDATE unverified_sign_candidates SET status = $2
           WHERE id = $1 AND status = $3
           RETURNING id`,
          [candidate.id, CandidateStatus.REJECTED, candidate.status],
        );
        if (getAffectedRowCount(updatedCandidates) !== 1) throw new ConflictException('Candidate state changed while banning involved user');
        await manager.query(
          `UPDATE candidate_recapture_requests
           SET completed_at = NOW()
           WHERE candidate_id = $1 AND completed_at IS NULL`,
          [candidate.id],
        );
      }

      const updatedReports: any[] = await manager.query(
        `UPDATE missing_sign_type_reports
         SET status = $2, staff_notes = $3, reviewed_by = $4, updated_at = NOW()
         WHERE id = $1 AND status = $5
         RETURNING id`,
        [reportId, MissingTypeStatus.REJECTED, reason, adminId, MissingTypeStatus.ESCALATED_ADMIN],
      );
      if (getAffectedRowCount(updatedReports) !== 1) throw new ConflictException('Report state changed while banning involved user');

      await manager.query(
        `UPDATE users SET status = 'BANNED', updated_at = NOW() WHERE id = $1`,
        [target.id],
      );
      await manager.query(
        `INSERT INTO user_status_history (user_id, old_status, new_status, reason, changed_by)
         VALUES ($1, $2::user_status, 'BANNED'::user_status, $3, $4)`,
        [target.id, target.status, reason, adminId],
      );
      await manager.query(
        `INSERT INTO audit_logs
           (user_id, action, resource_name, resource_id, old_values, new_values)
         VALUES ($1, 'ADMIN_NEW_SIGN_USER_BAN', 'users', $2, $3::jsonb, $4::jsonb)`,
        [
          adminId,
          target.id,
          JSON.stringify({ status: target.status }),
          JSON.stringify({ status: 'BANNED', reason, reportId, targetRole }),
        ],
      );
      await this.resolveAdminReportCase(
        manager,
        reportId,
        adminId,
        'BAN_USER',
        `${targetRole} user ${target.id} banned: ${reason}`,
      );
      return {
        reporterId: report.reporter_id,
        proposedName: report.proposed_name,
        targetUserId: target.id,
        previousStatus: target.status,
      };
    });

    await this.notifyReporter(
      { id: reportId, reporterId: result.reporterId, proposedName: result.proposedName },
      'REJECTED',
      'Báo cáo biển báo mới đã được xử lý',
      'Báo cáo "' + (result.proposedName || 'biển báo mới') + '" đã được quản trị viên xử lý.',
    );
    return {
      report: await this.getMissingReport(reportId),
      bannedUser: { id: result.targetUserId, oldStatus: result.previousStatus, newStatus: 'BANNED' },
    };
  }

  private async resolveAdminReportCase(
    manager: any,
    reportId: string,
    adminId: string,
    actionType: string,
    reason: string,
  ): Promise<string> {
    const caseRows: any[] = await manager.query(
      `SELECT id FROM moderation_cases
       WHERE target_entity_type = 'missing_sign_type_report' AND target_entity_id = $1
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [reportId],
    );
    let caseId: string | undefined = caseRows[0]?.id;
    if (caseId) {
      await manager.query(
        `UPDATE moderation_cases
         SET status = $2, resolution_note = $3, resolved_at = NOW()
         WHERE id = $1`,
        [caseId, ModerationStatus.RESOLVED, reason],
      );
    } else {
      const insertedCases: any[] = await manager.query(
        `INSERT INTO moderation_cases
           (case_type, target_entity_type, target_entity_id, assigned_staff_id, status, resolution_note, resolved_at)
         VALUES ($1, 'missing_sign_type_report', $2, $3, $4, $5, NOW())
         RETURNING id`,
        [ModerationType.CATALOG_PROPOSAL, reportId, adminId, ModerationStatus.RESOLVED, reason],
      );
      caseId = insertedCases[0]?.id;
    }
    if (!caseId) throw new Error('Failed to resolve admin report moderation case');
    await manager.query(
      `INSERT INTO moderation_actions (case_id, action_type, performed_by, note)
       VALUES ($1, $2, $3, $4)`,
      [caseId, actionType, adminId, reason],
    );
    return caseId;
  }

  private async requestMissingReportRecapture(
    reportId: string,
    staffId: string,
    note: string | null,
    expectedStatus = MissingTypeStatus.PENDING,
  ) {
    let surveyorId: string | null = null;
    const result = await this.dataSource.transaction(async (manager) => {
      const reportRows: any[] = await manager.query(
        `SELECT id, candidate_id, reporter_id, proposed_name, status
         FROM missing_sign_type_reports
         WHERE id = $1
         FOR UPDATE`,
        [reportId],
      );
      const report = reportRows[0];
      if (!report) throw new NotFoundException('MissingSignTypeReport ' + reportId + ' not found');
      if (report.status !== expectedStatus) {
        throw new BadRequestException('Report status must be ' + expectedStatus + ' to request recapture');
      }
      if (!report.candidate_id) {
        throw new BadRequestException('A candidate-linked report is required to request recapture');
      }

      const candidateRows: any[] = await manager.query(
        `SELECT id, status
         FROM unverified_sign_candidates
         WHERE id = $1
         FOR UPDATE`,
        [report.candidate_id],
      );
      const candidate = candidateRows[0];
      if (!candidate) throw new NotFoundException('Candidate ' + report.candidate_id + ' not found');
      if (candidate.status !== CandidateStatus.MISSING_TYPE_HOLD) {
        throw new BadRequestException('Candidate must be on MISSING_TYPE_HOLD to request recapture');
      }

      const activeRequests: any[] = await manager.query(
        `SELECT id FROM candidate_recapture_requests
         WHERE candidate_id = $1 AND completed_at IS NULL
         FOR UPDATE`,
        [candidate.id],
      );
      if (activeRequests.length > 0) {
        throw new ConflictException('An active recapture request already exists for candidate ' + candidate.id);
      }
      surveyorId = await this.selectRandomActiveSurveyor(manager);

      const updatedReports: any[] = await manager.query(
        `UPDATE missing_sign_type_reports
         SET status = $2, staff_notes = COALESCE($3, staff_notes), reviewed_by = $4, updated_at = NOW()
         WHERE id = $1 AND status = $5
         RETURNING id`,
        [reportId, MissingTypeStatus.INCOMPLETE, note, staffId, expectedStatus],
      );
      if (getAffectedRowCount(updatedReports) !== 1) throw new ConflictException('Report state changed before recapture request creation');

      const updatedCandidates: any[] = await manager.query(
        `UPDATE unverified_sign_candidates
         SET status = $2
         WHERE id = $1 AND status = $3
         RETURNING id`,
        [candidate.id, CandidateStatus.RECAPTURE_REQUESTED, CandidateStatus.MISSING_TYPE_HOLD],
      );
      if (getAffectedRowCount(updatedCandidates) !== 1) {
        throw new ConflictException('Candidate state changed before recapture request creation');
      }

      try {
        await manager.query(
          `INSERT INTO candidate_recapture_requests
             (candidate_id, reviewer_id, surveyor_id, missing_type_report_id, reason, note)
           VALUES ($1, $2, $3, $4, 'MISSING_TYPE_RECAPTURE_REQUESTED', $5)`,
          [candidate.id, staffId, surveyorId, reportId, note],
        );
      } catch (error: any) {
        if (error?.code === '23505' || String(error?.detail ?? '').includes('uq_candidate_recapture_requests_one_active')) {
          throw new ConflictException('An active recapture request already exists for candidate ' + candidate.id);
        }
        throw error;
      }

      const reportCaseRows: any[] = await manager.query(
        `SELECT id FROM moderation_cases
         WHERE target_entity_type = 'missing_sign_type_report' AND target_entity_id = $1
         ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [reportId],
      );
      let moderationCaseId: string | undefined = reportCaseRows[0]?.id;
      if (moderationCaseId) {
        await manager.query(
          `UPDATE moderation_cases
           SET status = $2, resolution_note = $3, resolved_at = NOW()
           WHERE id = $1`,
          [moderationCaseId, ModerationStatus.RESOLVED, note],
        );
      } else {
        const caseRows: any[] = await manager.query(
          `INSERT INTO moderation_cases
             (case_type, target_entity_type, target_entity_id, assigned_staff_id, status, resolution_note, resolved_at)
           VALUES ($1, 'candidate', $2, $3, $4, $5, NOW())
           RETURNING id`,
          [ModerationType.CATALOG_PROPOSAL, candidate.id, staffId, ModerationStatus.RESOLVED, note],
        );
        moderationCaseId = caseRows[0]?.id;
      }
      if (!moderationCaseId) throw new Error('Failed to create recapture moderation case');
      await manager.query(
        `INSERT INTO moderation_actions (case_id, action_type, performed_by, note)
         VALUES ($1, 'REQUEST_RECAPTURE', $2, $3)`,
        [moderationCaseId, staffId, note],
      );
      return { reporterId: report.reporter_id, proposedName: report.proposed_name, candidateId: candidate.id };
    });

    if (result.reporterId) {
      try {
        await this.notificationsService.create(
          result.reporterId,
          'MISSING_TYPE_INCOMPLETE',
          'Báo cáo biển báo cần được chụp lại',
          'Báo cáo "' + (result.proposedName || 'biển báo mới') + '" cần được Surveyor chụp lại ảnh tại vị trí đã gửi.',
          'missing_sign_type_report',
          reportId,
        );
      } catch (error: any) {
        this.logger.warn('Report recapture notification failed: ' + error?.message);
      }
    }
    if (surveyorId) {
      try {
        await this.notificationsService.create(
          surveyorId,
          'IMAGE_RECAPTURE_REQUESTED',
          'Yêu cầu chụp lại ảnh biển báo',
          note || 'Nhân viên yêu cầu chụp lại ảnh biển báo tại vị trí đã gửi.',
          'candidate',
          result.candidateId,
        );
      } catch (error: any) {
        this.logger.warn('Surveyor recapture notification failed: ' + error?.message);
      }
    }
    return this.getMissingReport(reportId);
  }

  private async selectRandomActiveSurveyor(manager: EntityManager): Promise<string> {
    const surveyors: Array<{ id: string }> = await manager.query(
      `SELECT u.id
       FROM users u
       WHERE u.status = 'ACTIVE'
         AND EXISTS (
           SELECT 1
           FROM user_roles ur
           JOIN roles role ON role.id = ur.role_id
           WHERE ur.user_id = u.id
             AND ur.is_active = TRUE
             AND role.code = 'SURVEYOR'
         )
       ORDER BY RANDOM()
       LIMIT 1`,
    );
    if (!surveyors[0]) {
      throw new BadRequestException('No active surveyor is available for recapture assignment');
    }
    return surveyors[0].id;
  }
  async getMissingReport(id: string) {
    const r = await this.missing.findOne({ where: { id } });
    if (!r) throw new NotFoundException('MissingSignTypeReport ' + id + ' not found');
    const [enriched] = await this.enrichWithCandidates([r]);
    return enriched;
  }

  /**
   * Scenario #4 — admin approves the report, creates the TrafficSignType via
   * the catalog service, publishes a new catalog version, releases held
   * candidates back into the review queue, and triggers the AI label sync.
   */
  async approveAndCreateType(
    reportId: string,
    staffId: string,
    dto: ApproveAndCreateTypeDto,
    file?: Express.Multer.File,
  ) {
    const report = await this.missing.findOne({ where: { id: reportId } as any });
    if (!report) throw new NotFoundException('MissingSignTypeReport ' + reportId + ' not found');
    if (![MissingTypeStatus.PENDING, MissingTypeStatus.ESCALATED_ADMIN].includes(report.status)) {
      throw new BadRequestException('Only PENDING or ESCALATED_ADMIN reports can be approved');
    }
    if (!dto.signCode?.trim()) throw new BadRequestException('signCode is required');
    if (!file?.buffer?.length) throw new BadRequestException('Representative image upload is required');
    if (!this.minioStorageService) throw new BadRequestException('Catalog image storage is not configured');
    if (!dto.allowedVehicles?.length) {
      throw new BadRequestException('At least one allowed vehicle type is required');
    }
    if (dto.allowedVehicles?.some((vehicle) => !(VEHICLE_TYPES as readonly string[]).includes(vehicle))) {
      throw new BadRequestException('allowedVehicles contains an unsupported vehicle type');
    }

    const categoryId = dto.proposedCategoryId ?? report.proposedCategoryId;
    const category = categoryId != null ? await this.catRepo.findOne({ where: { id: categoryId } }) : null;
    const resolvedCategoryId = category?.id ?? (await this.requireFallbackCategory());

    const reportName = report.proposedName?.trim() || 'Biển báo mới';
    const nameVi = dto.nameVi?.trim() || reportName;
    const nameEn = dto.nameEn?.trim() || reportName;

    const signCode = await this.validateAndNormalizeSignCode(dto.signCode);
    const duplicate = await this.signTypeRepo.findOne({ where: { signCode: ILike(signCode) } });
    if (duplicate) throw new ConflictException(`sign_code "${signCode}" exists`);
    const uploadedImage = await this.uploadNewSignRepresentativeImage(file, signCode);
    const representativeImageKey = uploadedImage.imageUrl;
    const description = dto.description?.trim() || report.description || undefined;
    const aiLabelPrompt =
      dto.aiLabelPrompt?.trim() ||
      `Sign "${nameEn}" - road traffic sign (${nameVi || nameEn}). shape=${report.suggestedShape || 'unknown'}, color_scheme=${report.suggestedColorScheme || 'unknown'}`;

    let created: any;
    try {
      created = await this.catalogService.createSignType({
        categoryId: resolvedCategoryId,
        signCode,
        nameVi,
        nameEn,
        description,
        labelingGuidelines: dto.suggestedShape || dto.suggestedColorScheme
          ? `Shape: ${report.suggestedShape ?? 'unknown'}; color scheme: ${report.suggestedColorScheme ?? 'unknown'}`
          : undefined,
        aiLabelPrompt,
        shape: report.suggestedShape ?? dto.suggestedShape ?? undefined,
        colorScheme: report.suggestedColorScheme ?? dto.suggestedColorScheme ?? undefined,
        representativeImageKey,
        allowedVehicles: dto.allowedVehicles,
        isActive: true,
      });
    } catch (error) {
      try {
        await this.minioStorageService.removeObject({
          bucket: uploadedImage.bucket,
          objectName: uploadedImage.objectName,
        });
      } catch (cleanupError: any) {
        this.logger.warn('Failed to remove orphaned representative image: ' + cleanupError?.message);
      }
      throw error;
    }

    try {
      await this.bumpCatalogVersion(staffId, signCode, created.id);
    } catch (e: any) {
      this.logger.warn('Failed to bump catalog version for sign type #' + created.id + ': ' + (e as any)?.message);
    }

    if (report.candidateId) {
      try {
        await this.releaseCandidate(report.candidateId, created.id);
      } catch (e: any) {
        this.logger.warn('Failed to release candidate ' + report.candidateId + ': ' + (e as any)?.message);
      }
    }

    report.status = MissingTypeStatus.APPROVED;
    report.mergedIntoSignTypeId = created.id;
    report.reviewedBy = staffId;
    report.staffNotes = dto.staffNotes ?? report.staffNotes ?? ('Approved as TrafficSignType #' + created.id + ' (' + signCode + ')');
    await this.missing.save(report);

    await this.reportSyncedBackend(created.id);
    await this.notifyReporter(report, 'APPROVED', 'Báo cáo biển báo mới đã được chấp thuận', 'Báo cáo "' + (report.proposedName || 'biển báo mới') + '" đã được thêm vào danh mục với mã "' + signCode + '".');

    const [enriched] = await this.enrichWithCandidates([report]);
    return { report: enriched, createdSignType: created };
  }

  // ---- moderation cases (unchanged behaviour, enriched) ----
  async listCases(status?: string, page = 1, pageSize = 20) {
    const p = Math.max(1, page), ps = Math.min(Math.max(1, pageSize), 100);
    const where: any = {}; if (status) where.status = status;
    const [items, total] = await this.cases.findAndCount({ where, order: { createdAt: 'DESC' }, skip: (p - 1) * ps, take: ps });
    return { items, total, page: p, pageSize: ps, totalPages: Math.ceil(total / ps) };
  }
  async getCase(id: string) {
    const mc = await this.cases.findOne({ where: { id } });
    if (!mc) throw new NotFoundException('ModerationCase ' + id + ' not found');
    const acts = await this.actions.find({ where: { caseId: id }, order: { performedAt: 'ASC' } });
    return { ...mc, actions: acts };
  }
  async resolveCase(id: string, staffId: string, dto: ResolveCaseDto) {
    const mc = await this.cases.findOne({ where: { id } });
    if (!mc) throw new NotFoundException('ModerationCase ' + id + ' not found');
    if (mc.status === ModerationStatus.RESOLVED) throw new BadRequestException('Case is already resolved');
    const actionType = (dto.actionType || 'RESOLVE').toUpperCase();
    const reportId: string | null = (dto as any).reportId ?? null;
    const targetTypeId: number | null = (dto as any).targetSignTypeId ?? (dto as any).mergedIntoSignTypeId ?? null;
    if (actionType === 'REQUEST_RECAPTURE' && mc.targetEntityType === 'candidate' && mc.targetEntityId) {
      return this.resolveRecaptureCase(id, staffId, dto);
    }
    // Catalog side-effects for missing-type workflow
    if (actionType === 'APPROVED' && reportId) {
      await this.handleApprovedReport(reportId, staffId, dto);
    } else if (actionType === 'MERGED' && reportId && targetTypeId) {
      await this.handleMergedReport(reportId, staffId, dto, targetTypeId);
    } else if ((actionType === 'APPROVED' || actionType === 'MERGED') && mc.caseType === 'CATALOG_PROPOSAL' as any) {
      // Legacy: case target is the missing report id
      const rid = mc.targetEntityId;
      if (rid && actionType === 'APPROVED') await this.handleApprovedReport(rid, staffId, dto);
      else if (rid && actionType === 'MERGED' && targetTypeId) await this.handleMergedReport(rid, staffId, dto, targetTypeId);
    } else if (actionType === 'REQUEST_RECAPTURE' && mc.targetEntityType === 'candidate' && mc.targetEntityId) {
      try {
        await this.candRepo.update(mc.targetEntityId, { status: CandidateStatus.RECAPTURE_REQUESTED });
        const subRows: any[] = await this.dataSource.query(
          `SELECT s.surveyor_id FROM survey_submissions s
           JOIN unverified_sign_candidates c ON c.submission_id = s.id
           WHERE c.id = $1`,
          [mc.targetEntityId],
        );
        const surveyorId = subRows[0]?.surveyor_id ?? null;
        await this.dataSource.query(
          `INSERT INTO candidate_recapture_requests (candidate_id, reviewer_id, surveyor_id, reason, note)
           VALUES ($1, $2, $3, 'MODERATION_RECAPTURE_REQUESTED', $4)`,
          [mc.targetEntityId, staffId, surveyorId, dto.resolutionNote],
        );
        if (surveyorId && this.notificationsService) {
          await this.notificationsService.create(
            surveyorId,
            'IMAGE_RECAPTURE_REQUESTED',
            'Yêu cầu chụp lại ảnh biển báo',
            `Quản trị viên yêu cầu chụp lại ảnh biển báo: ${dto.resolutionNote}`,
            'candidate',
            mc.targetEntityId,
          );
        }
      } catch (err: any) {
        this.logger.warn(`Failed to process moderation recapture request: ${err?.message}`);
      }
    }
    mc.status = ModerationStatus.RESOLVED;
    mc.resolutionNote = dto.resolutionNote;
    mc.resolvedAt = new Date();
    if (!mc.assignedStaffId) mc.assignedStaffId = staffId;
    await this.cases.save(mc);
    const act = this.actions.create({ caseId: mc.id, actionType: actionType, performedBy: staffId, note: dto.actionNote ?? dto.resolutionNote } as any);
    await this.actions.save(act);
    // Notify reporter if this was a missing-type case
    try {
      const relatedReportId = reportId || (mc.caseType === 'CATALOG_PROPOSAL' as any ? mc.targetEntityId : null);
      if (relatedReportId) {
        const rep: any = await this.missing.findOne({ where: { id: relatedReportId } as any });
        const actionText: Record<string, string> = { APPROVED: 'đã được chấp thuận', MERGED: 'đã được gộp vào loại biển báo hiện có', REJECTED: 'đã bị từ chối' };
        if (rep?.reporterId) await this.notificationsService.create(rep.reporterId, 'MODERATION_RESOLVED', 'Cập nhật báo cáo biển báo mới', 'Báo cáo "' + (rep.proposedName || 'biển báo mới') + '" của bạn ' + (actionText[actionType] ?? 'đã được xử lý') + '.', 'moderation_case', mc.id);
      }
    } catch {}
    return mc;
  }
  private async resolveRecaptureCase(caseId: string, staffId: string, dto: ResolveCaseDto) {
    let surveyorId: string | null = null;
    const resolved = await this.dataSource.transaction(async (manager) => {
      const caseRows: any[] = await manager.query(
        `SELECT * FROM moderation_cases WHERE id = $1 FOR UPDATE`,
        [caseId],
      );
      const moderationCase = caseRows[0];
      if (!moderationCase) throw new NotFoundException('ModerationCase ' + caseId + ' not found');
      if (moderationCase.status === ModerationStatus.RESOLVED) throw new BadRequestException('Case is already resolved');

      const candidateRows: any[] = await manager.query(
        `SELECT c.id, c.status
         FROM unverified_sign_candidates c
         WHERE c.id = $1
         FOR UPDATE OF c`,
        [moderationCase.target_entity_id],
      );
      const candidate = candidateRows[0];
      if (!candidate) throw new NotFoundException('Candidate ' + moderationCase.target_entity_id + ' not found');
      if ([CandidateStatus.VERIFIED, CandidateStatus.REJECTED, CandidateStatus.RECAPTURE_REQUESTED].includes(candidate.status)) {
        throw new BadRequestException(`Cannot request recapture for candidate ${candidate.id} with status ${candidate.status}`);
      }
      const activeRows: any[] = await manager.query(
        `SELECT id FROM candidate_recapture_requests
         WHERE candidate_id = $1 AND completed_at IS NULL
         FOR UPDATE`,
        [candidate.id],
      );
      if (activeRows.length > 0) throw new ConflictException(`An active recapture request already exists for candidate ${candidate.id}`);

      const reportRows: any[] = await manager.query(
        `SELECT id FROM missing_sign_type_reports
         WHERE candidate_id = $1 AND status = 'INCOMPLETE'
         FOR UPDATE`,
        [candidate.id],
      );
      if (reportRows.length !== 1) {
        throw new BadRequestException(
          `Cannot request recapture for candidate ${candidate.id}: expected exactly one INCOMPLETE Missing Type Report, found ${reportRows.length}`,
        );
      }
      surveyorId = await this.selectRandomActiveSurveyor(manager);

      const candidateUpdate = await manager.query(
        `UPDATE unverified_sign_candidates
         SET status = 'RECAPTURE_REQUESTED'
         WHERE id = $1 AND status NOT IN ('VERIFIED', 'REJECTED', 'RECAPTURE_REQUESTED')`,
        [candidate.id],
      );
      if (getAffectedRowCount(candidateUpdate) !== 1) throw new BadRequestException('Candidate state changed before recapture request creation');

      try {
        await manager.query(
          `INSERT INTO candidate_recapture_requests
             (candidate_id, reviewer_id, surveyor_id, missing_type_report_id, reason, note)
           VALUES ($1, $2, $3, $4, 'MODERATION_RECAPTURE_REQUESTED', $5)`,
          [candidate.id, staffId, surveyorId, reportRows[0].id, dto.resolutionNote ?? null],
        );
      } catch (error: any) {
        if (error?.code === '23505' || String(error?.detail ?? '').includes('uq_candidate_recapture_requests_one_active')) {
          throw new ConflictException(`An active recapture request already exists for candidate ${candidate.id}`);
        }
        throw error;
      }

      const updatedCases: any[] = await manager.query(
        `UPDATE moderation_cases
         SET status = 'RESOLVED', resolution_note = $2, resolved_at = NOW(), assigned_staff_id = COALESCE(assigned_staff_id, $3)
         WHERE id = $1
         RETURNING *`,
        [caseId, dto.resolutionNote ?? null, staffId],
      );
      await manager.query(
        `INSERT INTO moderation_actions (case_id, action_type, performed_by, note)
         VALUES ($1, $2, $3, $4)`,
        [caseId, 'REQUEST_RECAPTURE', staffId, dto.actionNote ?? dto.resolutionNote ?? null],
      );
      return updatedCases[0];
    });

    if (surveyorId && this.notificationsService) {
      try {
        await this.notificationsService.create(
          surveyorId,
          'IMAGE_RECAPTURE_REQUESTED',
          'Yêu cầu chụp lại ảnh biển báo',
          `Quản trị viên yêu cầu chụp lại ảnh biển báo: ${dto.resolutionNote ?? ''}`,
          'candidate',
          resolved.target_entity_id,
        );
      } catch (error: any) {
        this.logger.warn(`Recapture notification failed: ${error?.message}`);
      }
    }
    return resolved;
  }

  private async handleApprovedReport(reportId: string, staffId: string, dto: ResolveCaseDto) {
    const report = await this.missing.findOne({ where: { id: reportId } as any });
    if (!report) throw new NotFoundException('MissingSignTypeReport ' + reportId + ' not found');
    if (report.status === MissingTypeStatus.APPROVED || report.status === MissingTypeStatus.MERGED) return; // idempotent
    let categoryId = report.proposedCategoryId;
    if (!categoryId) {
      const fallback = await this.catRepo.findOne({ order: { id: 'ASC' } as any });
      if (!fallback) throw new BadRequestException('No sign category exists to assign the new sign type');
      categoryId = fallback.id;
    }
    const reportName = report.proposedName?.trim() || 'Biển báo mới';
    const baseCode = (report.proposedName || 'NEW').toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 20) || 'NEW_SIGN';
    let signCode = baseCode;
    let suffix = 0;
    while (await this.signTypeRepo.findOne({ where: { signCode } })) { suffix++; signCode = baseCode + '_' + suffix; }
    const created = this.signTypeRepo.create({ categoryId, signCode, nameVi: reportName, nameEn: reportName, description: report.description ?? dto.resolutionNote ?? null, isActive: true, createdAt: new Date(), updatedAt: new Date() } as any);
    const saved = await this.signTypeRepo.save(created) as unknown as TrafficSignType;

    let repUrl: string | null = null;
    if (report.candidateId) {
      const candRows: any[] = await this.dataSource.query(
        'SELECT sign_crop_url, best_frame_url FROM unverified_sign_candidates WHERE id = $1',
        [report.candidateId],
      );
      repUrl = candRows[0]?.sign_crop_url || candRows[0]?.best_frame_url || null;
    }
    if (!repUrl) {
      repUrl = `https://s3.signmap.site/stm-sign-crops/representative/${signCode}.png`;
    }
    await this.dataSource.query(
      `INSERT INTO sign_type_images (sign_type_id, image_url, image_type, is_primary, uploaded_at)
       VALUES ($1, $2, 'REPRESENTATIVE', true, now())`,
      [saved.id, repUrl],
    );

    report.status = MissingTypeStatus.APPROVED;
    report.mergedIntoSignTypeId = saved.id;
    report.reviewedBy = staffId;
    report.staffNotes = dto.actionNote ?? dto.resolutionNote ?? null;
    await this.missing.save(report);
    this.logger.log('Approved report ' + reportId + ' -> created TrafficSignType #' + saved.id + ' (' + signCode + ')');
  }
  private async handleMergedReport(reportId: string, staffId: string, dto: ResolveCaseDto, targetSignTypeId: number) {
    const report = await this.missing.findOne({ where: { id: reportId } as any });
    if (!report) throw new NotFoundException('MissingSignTypeReport ' + reportId + ' not found');
    if (report.status === MissingTypeStatus.MERGED || report.status === MissingTypeStatus.APPROVED) return;
    const targetType = await this.signTypeRepo.findOne({ where: { id: targetSignTypeId } });
    if (!targetType) throw new BadRequestException('Target TrafficSignType #' + targetSignTypeId + ' not found');
    report.status = MissingTypeStatus.MERGED;
    report.mergedIntoSignTypeId = targetSignTypeId;
    report.reviewedBy = staffId;
    report.staffNotes = dto.actionNote ?? dto.resolutionNote ?? null;
    await this.missing.save(report);
    if (report.candidateId) await this.releaseCandidate(report.candidateId, targetSignTypeId);
    this.logger.log('Merged report ' + reportId + ' -> existing TrafficSignType #' + targetSignTypeId);
  }

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------

  private async requireFallbackCategory(): Promise<number> {
    const fallback = await this.catRepo.findOne({ order: { id: 'ASC' } as any });
    if (!fallback) throw new BadRequestException('No sign category exists; create one before approving a sign type');
    return fallback.id;
  }

  private async validateAndNormalizeSignCode(input: string): Promise<string> {
    const match = input.trim().match(/^([A-Za-z]+)\.\s*(\d+)([A-Za-z0-9]*)$/);
    if (!match) {
      throw new BadRequestException('signCode must match PREFIX.number with an optional alphanumeric suffix');
    }
    const [, rawPrefix, number, rawSuffix] = match;
    const prefix = rawPrefix.toUpperCase();
    const suffix = rawSuffix.toLowerCase();
    const existingPrefixes: Array<{ prefix: string }> = await this.dataSource.query(
      `SELECT DISTINCT split_part(upper(sign_code), '.', 1) AS prefix
       FROM traffic_sign_types
       WHERE upper(sign_code) ~ '^[A-Z]+\\.[0-9]+[A-Z0-9]*$'
       ORDER BY prefix`,
    );
    const validPrefixes = existingPrefixes.map((row) => row.prefix);
    if (!validPrefixes.includes(prefix)) {
      throw new BadRequestException(
        'signCode prefix must match an existing catalog prefix: ' + (validPrefixes.join(', ') || '(none)'),
      );
    }
    return `${prefix}.${number}${suffix}`;
  }

  private async uploadNewSignRepresentativeImage(file: Express.Multer.File, signCode: string) {
    const supportedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    if (!supportedTypes.includes(file.mimetype)) {
      throw new BadRequestException('Representative image must be JPEG, PNG, WebP, or HEIF');
    }
    if (file.size > 20 * 1024 * 1024) {
      throw new BadRequestException('Representative image exceeds 20 MB');
    }
    const signature = validateFileSignature(MediaFileType.IMAGE, file.buffer);
    if (!signature.valid) throw new BadRequestException(signature.error);

    const cleanCode = signCode.replace(/[^A-Za-z0-9._-]/g, '');
    const filename = (file.originalname || 'image.png').replace(/[^a-zA-Z0-9._-]/g, '');
    const reference = {
      bucket: STM_BUCKETS.IMAGE,
      objectName: `catalog/representative/${cleanCode}-${randomUUID()}-${filename}`,
    };
    await this.minioStorageService!.putObject(
      reference.bucket,
      reference.objectName,
      file.buffer,
      file.mimetype,
    );
    return {
      ...reference,
      imageUrl: this.minioStorageService!.getPublicUrl(reference.bucket, reference.objectName),
    };
  }

  private async bumpCatalogVersion(staffId: string, signCode: string, signTypeId: number): Promise<void> {
    try {
      await this.dataSource.query(
        `WITH pinned AS MATERIALIZED (
           SELECT MAX(version_number) AS max_v FROM catalog_versions
         ),
         updated AS (
           UPDATE catalog_versions SET is_current = false WHERE is_current = true
         ),
         inserted AS (
           INSERT INTO catalog_versions (version_number, published_by, change_summary, is_current)
           SELECT COALESCE(max_v, 0) + 1, $1::uuid, $2, true FROM pinned
           RETURNING id
         )
         INSERT INTO catalog_version_sign_types (catalog_version_id, sign_type_id, change_action)
         SELECT inserted.id, $3, 'ADDED'::catalog_change_action FROM inserted`,
        [staffId, 'Added sign type "' + signCode + '" from approved missing-type report', signTypeId],
      );
    } catch (e: any) {
      this.logger.warn('Failed to bump catalog version for sign type #' + signTypeId + ': ' + (e as any)?.message);
    }
  }

  private async releaseCandidate(candidateId: string, signTypeId: number): Promise<void> {
    try {
      await this.dataSource.query(
        `UPDATE unverified_sign_candidates
         SET predicted_sign_type_id = $1, status = 'PENDING_REVIEW'
         WHERE id = $2::uuid AND status = 'MISSING_TYPE_HOLD'`,
        [signTypeId, candidateId],
      );
      this.logger.log('Released candidate ' + candidateId + ' to PENDING_REVIEW (type #' + signTypeId + ')');
    } catch (e: any) {
      this.logger.warn('Failed to release candidate ' + candidateId + ': ' + (e as any)?.message);
    }
  }

  /** MERGED/REJECTED/INCOMPLETE triage side-effects on the linked candidate. */
  private async applyCandidateSideEffect(report: MissingSignTypeReport, previousStatus: MissingTypeStatus) {
    if (!report.candidateId) return;
    const candidate = await this.candRepo.findOne({ where: { id: report.candidateId } });
    if (!candidate) return;
    if (report.status === MissingTypeStatus.REJECTED) {
      await this.candRepo.update({ id: report.candidateId }, { status: CandidateStatus.REJECTED });
      await this.notifyReporter(report, 'REJECTED', 'Báo cáo biển báo mới bị từ chối', 'Báo cáo "' + (report.proposedName || 'biển báo mới') + '" của bạn đã bị nhân viên từ chối.');
    } else if (report.status === MissingTypeStatus.MERGED && report.mergedIntoSignTypeId != null) {
      await this.releaseCandidate(report.candidateId, report.mergedIntoSignTypeId);
      await this.notifyReporter(report, 'MERGED', 'Báo cáo biển báo mới đã được gộp', 'Báo cáo "' + (report.proposedName || 'biển báo mới') + '" của bạn đã được gộp vào loại biển báo hiện có #' + report.mergedIntoSignTypeId + '.');
    } else if (report.status === MissingTypeStatus.APPROVED && previousStatus !== MissingTypeStatus.APPROVED && report.mergedIntoSignTypeId != null) {
      await this.releaseCandidate(report.candidateId, report.mergedIntoSignTypeId);
    } else if (report.status === MissingTypeStatus.INCOMPLETE || report.status === MissingTypeStatus.ESCALATED_ADMIN) {
      // candidate stays on hold; staff asked for more info
      const statusText = report.status === MissingTypeStatus.INCOMPLETE ? 'chưa đầy đủ' : 'được chuyển đến quản trị viên';
      await this.notifyReporter(report, report.status, 'Báo cáo biển báo mới cần được bổ sung', 'Báo cáo "' + (report.proposedName || 'biển báo mới') + '" của bạn đang ở trạng thái ' + statusText + '.');
    }
  }

  private async enrichWithCandidates(reports: MissingSignTypeReport[]): Promise<(MissingSignTypeReport & { candidate?: CandidateEnriched | null })[]> {
    if (reports.length === 0) return reports as any;
    const ids = reports.filter(r => r.candidateId).map(r => r.candidateId as string);
    const byId = new Map<string, CandidateEnriched>();
    if (ids.length > 0) {
      const rows: any[] = await this.dataSource.query(
        `SELECT c.id, c.predicted_sign_type_id, c.confidence_score, c.best_frame_url, c.sign_crop_url, c.status,
                ST_X(ge.sign_location::geometry) AS longitude,
                ST_Y(ge.sign_location::geometry) AS latitude
         FROM unverified_sign_candidates c
         LEFT JOIN candidate_geo_estimations ge ON ge.candidate_id = c.id
         WHERE c.id = ANY($1)`,
        [ids],
      );
      for (const row of rows) {
        byId.set(row.id, {
          id: row.id,
          predictedSignTypeId: Number(row.predicted_sign_type_id),
          confidenceScore: Number(row.confidence_score),
          bestFrameUrl: row.best_frame_url,
          signCropUrl: row.sign_crop_url,
          status: row.status,
          longitude: row.longitude == null ? null : Number(row.longitude),
          latitude: row.latitude == null ? null : Number(row.latitude),
        });
      }
    }
    return reports.map(r => ({
      ...r,
      candidate: r.candidateId ? (byId.get(r.candidateId) ?? null) : null,
      status: r.status === MissingTypeStatus.ESCALATED_ADMIN ? 'IN_REVIEW' : r.status,
      rawStatus: r.status,
    })) as any;
  }

  private async reportSyncedBackend(signTypeId: number): Promise<void> {
    try { await this.catalogSyncService.syncLabels(); }
    catch (e) { this.logger.warn('catalog sync failed for sign type #' + signTypeId + ': ' + (e as any)?.message); }
  }

  private async notifyReporter(
    report: Pick<MissingSignTypeReport, 'id' | 'reporterId' | 'proposedName'>,
    type: string,
    title: string,
    message: string,
  ): Promise<void> {
    try {
      if (report.reporterId) await this.notificationsService.create(report.reporterId, 'MISSING_TYPE_' + type, title, message, 'missing_sign_type_report', report.id);
    } catch (e) { this.logger.warn('reporter notification failed: ' + (e as any)?.message); }
  }
}
