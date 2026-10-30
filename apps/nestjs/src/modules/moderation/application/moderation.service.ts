import { Injectable, NotFoundException, BadRequestException, ConflictException, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In, ILike } from 'typeorm';
import { randomUUID } from 'crypto';
import { NewSignTypeReport, MissingSignTypeReport, MissingTypeStatus } from '../infrastructure/persistence/missing-sign-type-report.entity';
import { ModerationAction } from '../infrastructure/persistence/moderation-action.entity';
import { ModerationCase, ModerationStatus, ModerationType } from '../infrastructure/persistence/moderation-case.entity';
import { SignCategory } from '../../catalog/sign-category.entity';
import { TrafficSignType } from '../../catalog/traffic-sign-type.entity';
import { UnverifiedSignCandidate, CandidateStatus } from '../../survey/infrastructure/persistence/unverified-sign-candidate.entity';
import { CandidateRecaptureRequest } from '../../reviews/infrastructure/persistence/candidate-recapture-request.entity';
import { User, UserStatus } from '../../auth/infrastructure/persistence/user.entity';
import { UserRole } from '../../auth/infrastructure/persistence/user-role.entity';
import { Role } from '../../auth/infrastructure/persistence/role.entity';
import { SignTypeImage } from '../../catalog/sign-type-image.entity';
import { UserStatusHistory } from '../../admin/user-status-history.entity';
import { AuditLog } from '../../admin/audit-log.entity';
import { CandidateGeoEstimation } from '../../survey/infrastructure/persistence/candidate-geo-estimation.entity';
import { CreateNewSignTypeReportDto, ResolveCaseDto, UpdateNewSignTypeReportDto, ApproveAndCreateTypeDto, AdminNewSignTypeActionDto } from '../presentation/dto/moderation.dto';
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
    @InjectRepository(NewSignTypeReport) private missing: Repository<NewSignTypeReport>,
    @InjectRepository(SignCategory) private catRepo: Repository<SignCategory>,
    @InjectRepository(TrafficSignType) private signTypeRepo: Repository<TrafficSignType>,
    @InjectRepository(UnverifiedSignCandidate) private candRepo: Repository<UnverifiedSignCandidate>,
    private readonly dataSource: DataSource,
    private readonly notificationsService: NotificationsService,
    private readonly catalogService: CatalogService,
    private readonly catalogSyncService: CatalogSyncService,
    @Optional() private readonly minioStorageService?: MinioStorageService,
    @Optional() @InjectRepository(CandidateRecaptureRequest) private readonly recaptureRepo?: Repository<CandidateRecaptureRequest>,
    @Optional() @InjectRepository(User) private readonly userRepo?: Repository<User>,
    @Optional() @InjectRepository(SignTypeImage) private readonly signTypeImageRepo?: Repository<SignTypeImage>,
    @Optional() @InjectRepository(UserStatusHistory) private readonly userStatusHistoryRepo?: Repository<UserStatusHistory>,
    @Optional() @InjectRepository(AuditLog) private readonly auditLogRepo?: Repository<AuditLog>,
  ) {}

  /**
   * Reviewer reports a sign that is not in the catalog yet.
   * The linked candidate is atomically parked in MISSING_TYPE_HOLD so the
   * review/consensus queue stops offering it until staff resolve the report.
   */
  async reportNewSign(reporterId: string, dto: CreateNewSignTypeReportDto) {
    if (!dto.candidateId) throw new BadRequestException('candidateId is required');
    const proposedName = dto.proposedName?.trim() || null;

    return this.dataSource.transaction(async (manager) => {
      if (dto.candidateId) {
        let candidate: { id: string; status: CandidateStatus } | null = null;
        if (typeof manager.getRepository === 'function') {
          candidate = await manager.getRepository(UnverifiedSignCandidate)
            .createQueryBuilder('c')
            .setLock('pessimistic_write')
            .where('c.id = :id', { id: dto.candidateId })
            .getOne();
        } else if (typeof manager.query === 'function') {
          const candidates: Array<{ id: string; status: CandidateStatus }> = await manager.query(
            `SELECT id, status
             FROM unverified_sign_candidates
             WHERE id = $1
             FOR UPDATE`,
            [dto.candidateId],
          );
          candidate = candidates[0] ?? null;
        }
        if (!candidate) throw new NotFoundException('Candidate ' + dto.candidateId + ' not found');
        if (![CandidateStatus.PENDING_REVIEW, CandidateStatus.IN_CONSENSUS].includes(candidate.status)) {
          throw new BadRequestException('Candidate ' + dto.candidateId + ' is not available for a new-sign report');
        }

        let activeReportsCount = 0;
        if (typeof manager.getRepository === 'function') {
          activeReportsCount = await manager.getRepository(MissingSignTypeReport)
            .createQueryBuilder('r')
            .where('r.candidateId = :candidateId', { candidateId: dto.candidateId })
            .andWhere('r.status NOT IN (:...terminalStatuses)', {
              terminalStatuses: [MissingTypeStatus.MERGED, MissingTypeStatus.APPROVED, MissingTypeStatus.REJECTED],
            })
            .getCount();
        } else if (typeof manager.query === 'function') {
          const activeReports: Array<{ id: string }> = await manager.query(
            `SELECT id
             FROM missing_sign_type_reports
             WHERE candidate_id = $1 AND status NOT IN ('MERGED', 'APPROVED', 'REJECTED')
             LIMIT 1`,
            [dto.candidateId],
          );
          activeReportsCount = activeReports.length;
        }
        if (activeReportsCount > 0) {
          throw new ConflictException('An active new-sign report already exists for candidate ' + dto.candidateId);
        }
      }
      if (dto.proposedCategoryId != null) {
        const cat = await this.catRepo.findOne({ where: { id: dto.proposedCategoryId } });
        if (!cat) throw new BadRequestException('SignCategory #' + dto.proposedCategoryId + ' not found');
      }
      const reportPayload = {
        reporterId,
        originalReporterId: reporterId,
        candidateId: dto.candidateId ?? null,
        proposedCategoryId: dto.proposedCategoryId ?? null,
        proposedName,
        description: dto.description ?? null,
        suggestedShape: dto.suggestedShape ?? null,
        suggestedColorScheme: dto.suggestedColorScheme ?? null,
        status: MissingTypeStatus.PENDING,
      };
      const r = typeof manager.getRepository === 'function'
        ? manager.getRepository(MissingSignTypeReport).create(reportPayload as any)
        : manager.create(MissingSignTypeReport, reportPayload as any);
      const saved = (typeof manager.getRepository === 'function'
        ? await manager.getRepository(MissingSignTypeReport).save(r as MissingSignTypeReport)
        : await manager.save(r)) as unknown as MissingSignTypeReport;
      if (dto.candidateId) {
        let affected = 0;
        if (typeof manager.getRepository === 'function') {
          const updateRes = await manager.getRepository(UnverifiedSignCandidate)
            .createQueryBuilder()
            .update(UnverifiedSignCandidate)
            .set({ status: CandidateStatus.MISSING_TYPE_HOLD })
            .where('id = :id AND status IN (:...statuses)', {
              id: dto.candidateId,
              statuses: [CandidateStatus.PENDING_REVIEW, CandidateStatus.IN_CONSENSUS],
            })
            .execute();
          affected = updateRes.affected ?? 0;
        } else if (typeof manager.query === 'function') {
          const updatedCandidates: Array<{ id: string }> = await manager.query(
            `UPDATE unverified_sign_candidates
             SET status = $2
             WHERE id = $1 AND status IN ('PENDING_REVIEW', 'IN_CONSENSUS')
             RETURNING id`,
            [dto.candidateId, CandidateStatus.MISSING_TYPE_HOLD],
          );
          affected = getAffectedRowCount(updatedCandidates);
        }
        if (affected !== 1) {
          throw new ConflictException('Candidate ' + dto.candidateId + ' changed state while reporting a new sign');
        }
        this.logger.log('Parked candidate ' + dto.candidateId + ' on MISSING_TYPE_HOLD (report ' + saved.id + ')');
      }
      return saved;
    });
  }

  reportMissingType(reporterId: string, dto: CreateNewSignTypeReportDto) {
    return this.reportNewSign(reporterId, dto);
  }

  async listNewSignReports(status?: string, page = 1, pageSize = 20) {
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

  listMissingReports(status?: string, page = 1, pageSize = 20) {
    return this.listNewSignReports(status, page, pageSize);
  }

  async updateNewSignReport(reportId: string, reviewerId: string, dto: UpdateNewSignTypeReportDto) {
    if (dto.actionType) {
      const report = await this.missing.findOne({ where: { id: reportId } as any });
      if (!report) throw new NotFoundException('NewSignTypeReport ' + reportId + ' not found');
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
    if (!report) throw new NotFoundException('NewSignTypeReport ' + reportId + ' not found');
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

    await this.applyCandidateSideEffect(report as NewSignTypeReport, previousStatus);
    return (await this.enrichWithCandidates([report as NewSignTypeReport]))[0];
  }

  updateMissingReport(reportId: string, reviewerId: string, dto: UpdateNewSignTypeReportDto) {
    return this.updateNewSignReport(reportId, reviewerId, dto);
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
      let report: { id: string; candidateId?: string | null; reporterId?: string | null; proposedName?: string | null; status: MissingTypeStatus } | null = null;
      if (typeof manager.getRepository === 'function') {
        const found = await manager.getRepository(MissingSignTypeReport)
          .createQueryBuilder('r')
          .setLock('pessimistic_write')
          .where('r.id = :id', { id: reportId })
          .getOne();
        if (found) {
          report = {
            id: found.id,
            candidateId: found.candidateId,
            reporterId: found.reporterId,
            proposedName: found.proposedName,
            status: found.status,
          };
        }
      } else if (typeof manager.query === 'function') {
        const reportRows: any[] = await manager.query(
          `SELECT id, candidate_id, reporter_id, proposed_name, status
           FROM missing_sign_type_reports
           WHERE id = $1
           FOR UPDATE`,
          [reportId],
        );
        if (reportRows[0]) {
          report = {
            id: reportRows[0].id,
            candidateId: reportRows[0].candidate_id,
            reporterId: reportRows[0].reporter_id,
            proposedName: reportRows[0].proposed_name,
            status: reportRows[0].status,
          };
        }
      }
      if (!report) throw new NotFoundException('MissingSignTypeReport ' + reportId + ' not found');
      if (![MissingTypeStatus.PENDING, MissingTypeStatus.INCOMPLETE].includes(report.status)) {
        throw new BadRequestException('Report must be PENDING or INCOMPLETE to perform a staff action');
      }

      if (report.candidateId) {
        let candidate: { id: string; status: CandidateStatus } | null = null;
        if (typeof manager.getRepository === 'function') {
          candidate = await manager.getRepository(UnverifiedSignCandidate)
            .createQueryBuilder('c')
            .setLock('pessimistic_write')
            .where('c.id = :id', { id: report.candidateId })
            .getOne();
        } else if (typeof manager.query === 'function') {
          const candidates: any[] = await manager.query(
            `SELECT id, status FROM unverified_sign_candidates WHERE id = $1 FOR UPDATE`,
            [report.candidateId],
          );
          candidate = candidates[0] ?? null;
        }
        if (!candidate) throw new NotFoundException('Candidate ' + report.candidateId + ' not found');
        if (candidate.status !== CandidateStatus.MISSING_TYPE_HOLD) {
          throw new ConflictException('Candidate must be on MISSING_TYPE_HOLD to resolve this report');
        }
      }

      const nextStatus = decision === 'MERGE' ? MissingTypeStatus.MERGED : MissingTypeStatus.REJECTED;
      let updateReportAffected = 0;
      if (typeof manager.getRepository === 'function') {
        const res = await manager.getRepository(MissingSignTypeReport)
          .createQueryBuilder()
          .update(MissingSignTypeReport)
          .set({
            status: nextStatus,
            mergedIntoSignTypeId: signTypeId ?? undefined,
            ...(note != null ? { staffNotes: note } : {}),
            reviewedBy: staffId,
            updatedAt: new Date(),
          })
          .where('id = :id AND status IN (:...statuses)', {
            id: reportId,
            statuses: [MissingTypeStatus.PENDING, MissingTypeStatus.INCOMPLETE],
          })
          .execute();
        updateReportAffected = res.affected ?? 0;
      } else if (typeof manager.query === 'function') {
        const updatedReports: any[] = await manager.query(
          `UPDATE missing_sign_type_reports
           SET status = $2, merged_into_sign_type_id = $3,
               staff_notes = COALESCE($4, staff_notes), reviewed_by = $5, updated_at = NOW()
           WHERE id = $1 AND status IN ($6, $7)
           RETURNING id`,
          [reportId, nextStatus, signTypeId, note, staffId, MissingTypeStatus.PENDING, MissingTypeStatus.INCOMPLETE],
        );
        updateReportAffected = getAffectedRowCount(updatedReports);
      }
      if (updateReportAffected !== 1) throw new ConflictException('Report state changed before applying staff decision');

      if (report.candidateId) {
        const candidateStatus = decision === 'MERGE' ? CandidateStatus.PENDING_REVIEW : CandidateStatus.REJECTED;
        let updateCandAffected = 0;
        if (typeof manager.getRepository === 'function') {
          const res = await manager.getRepository(UnverifiedSignCandidate)
            .createQueryBuilder()
            .update(UnverifiedSignCandidate)
            .set({
              status: candidateStatus,
              ...(signTypeId != null ? { predictedSignTypeId: signTypeId } : {}),
            })
            .where('id = :id AND status = :status', {
              id: report.candidateId,
              status: CandidateStatus.MISSING_TYPE_HOLD,
            })
            .execute();
          updateCandAffected = res.affected ?? 0;
        } else if (typeof manager.query === 'function') {
          const candidateUpdate: any[] = await manager.query(
            `UPDATE unverified_sign_candidates
             SET status = $2, predicted_sign_type_id = COALESCE($3, predicted_sign_type_id)
             WHERE id = $1 AND status = $4
             RETURNING id`,
            [report.candidateId, candidateStatus, signTypeId, CandidateStatus.MISSING_TYPE_HOLD],
          );
          updateCandAffected = getAffectedRowCount(candidateUpdate);
        }
        if (updateCandAffected !== 1) throw new ConflictException('Candidate state changed before applying staff decision');
      }

      let caseId: string | undefined;
      if (typeof manager.getRepository === 'function') {
        const caseRepo = manager.getRepository(ModerationCase);
        const actionRepo = manager.getRepository(ModerationAction);
        const savedCase = await caseRepo.save(caseRepo.create({
          caseType: ModerationType.CATALOG_PROPOSAL,
          targetEntityType: 'missing_sign_type_report',
          targetEntityId: reportId,
          assignedStaffId: staffId,
          status: ModerationStatus.RESOLVED,
          resolutionNote: note,
          resolvedAt: new Date(),
        }));
        caseId = savedCase.id;
        await actionRepo.save(actionRepo.create({
          caseId,
          actionType: decision,
          performedBy: staffId,
          note,
        }));
      } else if (typeof manager.query === 'function') {
        const caseRows: any[] = await manager.query(
          `INSERT INTO moderation_cases
             (case_type, target_entity_type, target_entity_id, assigned_staff_id, status, resolution_note, resolved_at)
           VALUES ($1, 'missing_sign_type_report', $2, $3, $4, $5, NOW())
           RETURNING id`,
          [ModerationType.CATALOG_PROPOSAL, reportId, staffId, ModerationStatus.RESOLVED, note],
        );
        caseId = caseRows[0]?.id;
        if (!caseId) throw new Error('Failed to create report decision moderation case');
        await manager.query(
          `INSERT INTO moderation_actions (case_id, action_type, performed_by, note)
           VALUES ($1, $2, $3, $4)`,
          [caseId, decision, staffId, note],
        );
      }
      return { reporterId: report.reporterId, proposedName: report.proposedName };
    });

    if (result.reporterId) {
      const isMerge = decision === 'MERGE';
      await this.notifyReporter(
        { id: reportId, reporterId: result.reporterId, proposedName: result.proposedName },
        decision === 'MERGE' ? 'MERGED' : 'REJECTED',
        isMerge ? 'BÃ¡o cÃ¡o biá»ƒn bÃ¡o má»›i Ä‘Ã£ Ä‘Æ°á»£c gá»™p' : 'BÃ¡o cÃ¡o biá»ƒn bÃ¡o má»›i bá»‹ tá»« chá»‘i',
        isMerge
          ? 'BÃ¡o cÃ¡o "' + (result.proposedName || 'biá»ƒn bÃ¡o má»›i') + '" cá»§a báº¡n Ä‘Ã£ Ä‘Æ°á»£c gá»™p vÃ o loáº¡i biá»ƒn bÃ¡o hiá»‡n cÃ³ #' + signTypeId + '.'
          : 'BÃ¡o cÃ¡o "' + (result.proposedName || 'biá»ƒn bÃ¡o má»›i') + '" cá»§a báº¡n Ä‘Ã£ bá»‹ nhÃ¢n viÃªn tá»« chá»‘i.',
      );
    }
    return this.getMissingReport(reportId);
  }

  private async escalateMissingReportToAdmin(reportId: string, staffId: string, note: string) {
    await this.dataSource.transaction(async (manager) => {
      let report: { id: string; status: MissingTypeStatus } | null = null;
      if (typeof manager.getRepository === 'function') {
        const found = await manager.getRepository(MissingSignTypeReport)
          .createQueryBuilder('r')
          .setLock('pessimistic_write')
          .where('r.id = :id', { id: reportId })
          .getOne();
        if (found) report = { id: found.id, status: found.status };
      } else if (typeof manager.query === 'function') {
        const reportRows: any[] = await manager.query(
          `SELECT id, status FROM missing_sign_type_reports WHERE id = $1 FOR UPDATE`,
          [reportId],
        );
        if (reportRows[0]) report = { id: reportRows[0].id, status: reportRows[0].status };
      }
      if (!report) throw new NotFoundException('MissingSignTypeReport ' + reportId + ' not found');
      if (report.status !== MissingTypeStatus.PENDING) {
        throw new BadRequestException('Only PENDING reports can be escalated to Admin');
      }

      let updateReportAffected = 0;
      if (typeof manager.getRepository === 'function') {
        const res = await manager.getRepository(MissingSignTypeReport)
          .createQueryBuilder()
          .update(MissingSignTypeReport)
          .set({
            status: MissingTypeStatus.ESCALATED_ADMIN,
            staffNotes: note,
            reviewedBy: staffId,
            updatedAt: new Date(),
          })
          .where('id = :id AND status = :status', { id: reportId, status: MissingTypeStatus.PENDING })
          .execute();
        updateReportAffected = res.affected ?? 0;
      } else if (typeof manager.query === 'function') {
        const updatedReports: any[] = await manager.query(
          `UPDATE missing_sign_type_reports
           SET status = $2, staff_notes = $3, reviewed_by = $4, updated_at = NOW()
           WHERE id = $1 AND status = $5
           RETURNING id`,
          [reportId, MissingTypeStatus.ESCALATED_ADMIN, note, staffId, MissingTypeStatus.PENDING],
        );
        updateReportAffected = getAffectedRowCount(updatedReports);
      }
      if (updateReportAffected !== 1) throw new ConflictException('Report state changed before escalation');

      let caseId: string | undefined;
      if (typeof manager.getRepository === 'function') {
        const caseRepo = manager.getRepository(ModerationCase);
        const actionRepo = manager.getRepository(ModerationAction);
        const existingCase = await caseRepo
          .createQueryBuilder('c')
          .setLock('pessimistic_write')
          .where('c.targetEntityType = :targetEntityType AND c.targetEntityId = :targetEntityId', {
            targetEntityType: 'missing_sign_type_report',
            targetEntityId: reportId,
          })
          .orderBy('c.createdAt', 'DESC')
          .getOne();
        if (existingCase) {
          caseId = existingCase.id;
          await caseRepo.update(caseId, {
            status: ModerationStatus.PENDING,
            assignedStaffId: staffId,
            resolutionNote: note,
            resolvedAt: null as any,
          });
        } else {
          const newCase = caseRepo.create({
            caseType: ModerationType.CATALOG_PROPOSAL,
            targetEntityType: 'missing_sign_type_report',
            targetEntityId: reportId,
            assignedStaffId: staffId,
            status: ModerationStatus.PENDING,
            resolutionNote: note,
          });
          const savedCase = await caseRepo.save(newCase);
          caseId = savedCase.id;
        }
        if (!caseId) throw new Error('Failed to create admin escalation moderation case');
        await actionRepo.save(actionRepo.create({
          caseId,
          actionType: 'ESCALATE_ADMIN',
          performedBy: staffId,
          note,
        }));
      } else if (typeof manager.query === 'function') {
        const existingCases: any[] = await manager.query(
          `SELECT id, status FROM moderation_cases
           WHERE target_entity_type = 'missing_sign_type_report' AND target_entity_id = $1
           ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
          [reportId],
        );
        caseId = existingCases[0]?.id;
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
      }
    });

    const escalated = await this.getMissingReport(reportId);
    await this.notifyReporter(
      escalated,
      'ESCALATED_ADMIN',
      'BÃ¡o cÃ¡o biá»ƒn bÃ¡o má»›i Ä‘Æ°á»£c chuyá»ƒn lÃªn quáº£n trá»‹ viÃªn',
      'BÃ¡o cÃ¡o "' + (escalated.proposedName || 'biá»ƒn bÃ¡o má»›i') + '" Ä‘Ã£ Ä‘Æ°á»£c chuyá»ƒn lÃªn quáº£n trá»‹ viÃªn Ä‘á»ƒ xem xÃ©t.',
    );
    return escalated;
  }

  async applyAdminNewSignReportAction(reportId: string, adminId: string, dto: AdminNewSignTypeActionDto) {
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
    if (dto.actionType === 'REJECT' || dto.actionType === 'DISMISS') {
      return this.rejectEscalatedReport(reportId, adminId, reason);
    }
    if (dto.actionType === 'BAN_USER') {
      if (!dto.banTarget) throw new BadRequestException('banTarget is required for BAN_USER');
      const targetRole = dto.banTarget === 'LATEST_SURVEYOR' ? 'SURVEYOR' : dto.banTarget;
      return this.banInvolvedReportUser(reportId, adminId, targetRole, reason);
    }
    throw new BadRequestException('Unsupported admin action');
  }

  applyAdminMissingReportAction(reportId: string, adminId: string, dto: AdminNewSignTypeActionDto) {
    return this.applyAdminNewSignReportAction(reportId, adminId, dto);
  }

  private async rejectEscalatedReport(reportId: string, adminId: string, reason: string) {
    const result = await this.dataSource.transaction(async (manager) => {
      let report: { id: string; candidateId?: string | null; reporterId?: string | null; proposedName?: string | null; status: MissingTypeStatus } | null = null;
      if (typeof manager.getRepository === 'function') {
        const found = await manager.getRepository(MissingSignTypeReport)
          .createQueryBuilder('r')
          .setLock('pessimistic_write')
          .where('r.id = :id', { id: reportId })
          .getOne();
        if (found) {
          report = {
            id: found.id,
            candidateId: found.candidateId,
            reporterId: found.reporterId,
            proposedName: found.proposedName,
            status: found.status,
          };
        }
      } else if (typeof manager.query === 'function') {
        const reportRows: any[] = await manager.query(
          `SELECT id, candidate_id, reporter_id, proposed_name, status
           FROM missing_sign_type_reports
           WHERE id = $1
           FOR UPDATE`,
          [reportId],
        );
        if (reportRows[0]) {
          report = {
            id: reportRows[0].id,
            candidateId: reportRows[0].candidate_id,
            reporterId: reportRows[0].reporter_id,
            proposedName: reportRows[0].proposed_name,
            status: reportRows[0].status,
          };
        }
      }
      if (!report) throw new NotFoundException('MissingSignTypeReport ' + reportId + ' not found');
      if (report.status !== MissingTypeStatus.ESCALATED_ADMIN) {
        throw new BadRequestException('Only ESCALATED_ADMIN reports can receive admin decisions');
      }

      if (report.candidateId) {
        let candidate: { id: string; status: CandidateStatus } | null = null;
        if (typeof manager.getRepository === 'function') {
          candidate = await manager.getRepository(UnverifiedSignCandidate)
            .createQueryBuilder('c')
            .setLock('pessimistic_write')
            .where('c.id = :id', { id: report.candidateId })
            .getOne();
        } else if (typeof manager.query === 'function') {
          const candidates: any[] = await manager.query(
            `SELECT id, status FROM unverified_sign_candidates WHERE id = $1 FOR UPDATE`,
            [report.candidateId],
          );
          candidate = candidates[0] ?? null;
        }
        if (!candidate) throw new NotFoundException('Candidate ' + report.candidateId + ' not found');
        if (![CandidateStatus.MISSING_TYPE_HOLD, CandidateStatus.RECAPTURE_REQUESTED].includes(candidate.status)) {
          throw new ConflictException('Candidate is not in a state that can be rejected with this report');
        }

        let updateCandAffected = 0;
        if (typeof manager.getRepository === 'function') {
          const res = await manager.getRepository(UnverifiedSignCandidate)
            .createQueryBuilder()
            .update(UnverifiedSignCandidate)
            .set({ status: CandidateStatus.REJECTED })
            .where('id = :id AND status = :status', { id: candidate.id, status: candidate.status })
            .execute();
          updateCandAffected = res.affected ?? 0;
          await manager.getRepository(CandidateRecaptureRequest)
            .createQueryBuilder()
            .update(CandidateRecaptureRequest)
            .set({ completedAt: new Date() })
            .where('candidateId = :candidateId AND completedAt IS NULL', { candidateId: candidate.id })
            .execute();
        } else if (typeof manager.query === 'function') {
          const updatedCandidates: any[] = await manager.query(
            `UPDATE unverified_sign_candidates SET status = $2
             WHERE id = $1 AND status = $3
             RETURNING id`,
            [candidate.id, CandidateStatus.REJECTED, candidate.status],
          );
          updateCandAffected = getAffectedRowCount(updatedCandidates);
          await manager.query(
            `UPDATE candidate_recapture_requests
             SET completed_at = NOW()
             WHERE candidate_id = $1 AND completed_at IS NULL`,
            [candidate.id],
          );
        }
        if (updateCandAffected !== 1) throw new ConflictException('Candidate state changed while rejecting report');
      }

      let updateReportAffected = 0;
      if (typeof manager.getRepository === 'function') {
        const res = await manager.getRepository(MissingSignTypeReport)
          .createQueryBuilder()
          .update(MissingSignTypeReport)
          .set({
            status: MissingTypeStatus.REJECTED,
            staffNotes: reason,
            reviewedBy: adminId,
            updatedAt: new Date(),
          })
          .where('id = :id AND status = :status', { id: reportId, status: MissingTypeStatus.ESCALATED_ADMIN })
          .execute();
        updateReportAffected = res.affected ?? 0;
      } else if (typeof manager.query === 'function') {
        const updatedReports: any[] = await manager.query(
          `UPDATE missing_sign_type_reports
           SET status = $2, staff_notes = $3, reviewed_by = $4, updated_at = NOW()
           WHERE id = $1 AND status = $5
           RETURNING id`,
          [reportId, MissingTypeStatus.REJECTED, reason, adminId, MissingTypeStatus.ESCALATED_ADMIN],
        );
        updateReportAffected = getAffectedRowCount(updatedReports);
      }
      if (updateReportAffected !== 1) throw new ConflictException('Report state changed while applying admin rejection');
      await this.resolveAdminReportCase(manager, reportId, adminId, 'REJECT', reason);
      return { reporterId: report.reporterId, proposedName: report.proposedName };
    });

    await this.notifyReporter(
      { id: reportId, reporterId: result.reporterId, proposedName: result.proposedName },
      'REJECTED',
      'BÃ¡o cÃ¡o biá»ƒn bÃ¡o má»›i bá»‹ tá»« chá»‘i',
      'BÃ¡o cÃ¡o "' + (result.proposedName || 'biá»ƒn bÃ¡o má»›i') + '" Ä‘Ã£ bá»‹ quáº£n trá»‹ viÃªn tá»« chá»‘i.',
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
      let report: { id: string; candidateId?: string | null; reporterId?: string | null; originalReporterId?: string | null; proposedName?: string | null; status: MissingTypeStatus; reviewedBy?: string | null } | null = null;
      if (typeof manager.getRepository === 'function') {
        const found = await manager.getRepository(MissingSignTypeReport)
          .createQueryBuilder('r')
          .setLock('pessimistic_write')
          .where('r.id = :id', { id: reportId })
          .getOne();
        if (found) {
          report = {
            id: found.id,
            candidateId: found.candidateId,
            reporterId: found.reporterId,
            originalReporterId: found.originalReporterId,
            proposedName: found.proposedName,
            status: found.status,
            reviewedBy: found.reviewedBy,
          };
        }
      } else if (typeof manager.query === 'function') {
        const reportRows: any[] = await manager.query(
          `SELECT id, candidate_id, reporter_id, original_reporter_id, proposed_name, status, reviewed_by
           FROM missing_sign_type_reports
           WHERE id = $1
           FOR UPDATE`,
          [reportId],
        );
        if (reportRows[0]) {
          report = {
            id: reportRows[0].id,
            candidateId: reportRows[0].candidate_id,
            reporterId: reportRows[0].reporter_id,
            originalReporterId: reportRows[0].original_reporter_id,
            proposedName: reportRows[0].proposed_name,
            status: reportRows[0].status,
            reviewedBy: reportRows[0].reviewed_by,
          };
        }
      }
      if (!report) throw new NotFoundException('MissingSignTypeReport ' + reportId + ' not found');
      if (report.status !== MissingTypeStatus.ESCALATED_ADMIN) {
        throw new BadRequestException('Only ESCALATED_ADMIN reports can receive admin decisions');
      }

      let targetRows: any[];
      if (targetRole === 'REVIEWER') {
        const reviewerId = report.originalReporterId ?? report.reporterId;
        targetRows = reviewerId ? [{ id: reviewerId }] : [];
      } else if (targetRole === 'SURVEYOR') {
        if (!report.candidateId) {
          targetRows = [];
        } else if (typeof manager.getRepository === 'function') {
          const rec = await manager.getRepository(CandidateRecaptureRequest)
            .createQueryBuilder('r')
            .where('r.candidateId = :candidateId AND r.surveyorId IS NOT NULL', { candidateId: report.candidateId })
            .orderBy('r.createdAt', 'DESC')
            .getOne();
          if (rec?.surveyorId) {
            targetRows = [{ id: rec.surveyorId }];
          } else {
            const cand = await manager.getRepository(UnverifiedSignCandidate)
              .createQueryBuilder('c')
              .leftJoinAndSelect('c.submission', 's')
              .where('c.id = :id', { id: report.candidateId })
              .getOne();
            targetRows = cand?.submission?.surveyorId ? [{ id: cand.submission.surveyorId }] : [];
          }
        } else {
          targetRows = await manager.query(
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
            [report.candidateId],
          );
        }
      } else {
        if (typeof manager.getRepository === 'function') {
          const staffAction = await manager.getRepository(ModerationAction)
            .createQueryBuilder('a')
            .innerJoin('a.case', 'c')
            .innerJoin(UserRole, 'ur', 'ur.userId = a.performedBy AND ur.isActive = true')
            .innerJoin(Role, 'role', 'role.id = ur.roleId AND role.code = :code', { code: 'STAFF' })
            .where('c.targetEntityType = :entityType AND c.targetEntityId = :entityId', {
              entityType: 'missing_sign_type_report',
              entityId: reportId,
            })
            .andWhere('a.actionType IN (:...types)', {
              types: ['ESCALATE_ADMIN', 'REQUEST_RECAPTURE', 'REJECT', 'MERGE'],
            })
            .orderBy('a.performedAt', 'DESC')
            .getOne();
          let staffUserId = staffAction?.performedBy;
          if (!staffUserId && report.reviewedBy) {
            const hasRole = await manager.getRepository(UserRole)
              .createQueryBuilder('ur')
              .innerJoin('ur.role', 'role')
              .where('ur.userId = :userId AND ur.isActive = true AND role.code = :code', {
                userId: report.reviewedBy,
                code: 'STAFF',
              })
              .getCount();
            if (hasRole > 0) staffUserId = report.reviewedBy;
          }
          targetRows = staffUserId ? [{ id: staffUserId }] : [];
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
            [reportId, report.reviewedBy],
          );
        }
      }

      const targetId = targetRows[0]?.id;
      if (!targetId) throw new BadRequestException('No involved ' + targetRole.toLowerCase() + ' is associated with this report');
      let target: { id: string; status: string } | null = null;
      if (typeof manager.getRepository === 'function') {
        const u = await manager.getRepository(User)
          .createQueryBuilder('u')
          .setLock('pessimistic_write')
          .innerJoin('u.userRoles', 'ur')
          .innerJoin('ur.role', 'role')
          .where('u.id = :id AND ur.isActive = true AND role.code = :targetRole', { id: targetId, targetRole })
          .andWhere((qb) => {
            const subQuery = qb.subQuery()
              .select('1')
              .from(UserRole, 'adminUr')
              .innerJoin('adminUr.role', 'adminRole')
              .where('adminUr.userId = u.id AND adminUr.isActive = true AND adminRole.code = :adminCode')
              .getQuery();
            return 'NOT EXISTS ' + subQuery;
          })
          .setParameter('adminCode', 'ADMIN')
          .getOne();
        if (u) target = { id: u.id, status: u.status };
      } else if (typeof manager.query === 'function') {
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
        target = eligibleUsers[0] ?? null;
      }
      if (!target) throw new BadRequestException('Selected involved user is not eligible for this ban action');
      if (target.status === 'BANNED') throw new BadRequestException('Selected user is already BANNED');

      if (report.candidateId) {
        let candidate: { id: string; status: CandidateStatus } | null = null;
        if (typeof manager.getRepository === 'function') {
          candidate = await manager.getRepository(UnverifiedSignCandidate)
            .createQueryBuilder('c')
            .setLock('pessimistic_write')
            .where('c.id = :id', { id: report.candidateId })
            .getOne();
        } else if (typeof manager.query === 'function') {
          const candidates: any[] = await manager.query(
            `SELECT id, status FROM unverified_sign_candidates WHERE id = $1 FOR UPDATE`,
            [report.candidateId],
          );
          candidate = candidates[0] ?? null;
        }
        if (!candidate) throw new NotFoundException('Candidate ' + report.candidateId + ' not found');
        if (![CandidateStatus.MISSING_TYPE_HOLD, CandidateStatus.RECAPTURE_REQUESTED].includes(candidate.status)) {
          throw new ConflictException('Candidate is not in a state that can be rejected with this report');
        }

        let updateCandAffected = 0;
        if (typeof manager.getRepository === 'function') {
          const res = await manager.getRepository(UnverifiedSignCandidate)
            .createQueryBuilder()
            .update(UnverifiedSignCandidate)
            .set({ status: CandidateStatus.REJECTED })
            .where('id = :id AND status = :status', { id: candidate.id, status: candidate.status })
            .execute();
          updateCandAffected = res.affected ?? 0;
          await manager.getRepository(CandidateRecaptureRequest)
            .createQueryBuilder()
            .update(CandidateRecaptureRequest)
            .set({ completedAt: new Date() })
            .where('candidateId = :candidateId AND completedAt IS NULL', { candidateId: candidate.id })
            .execute();
        } else if (typeof manager.query === 'function') {
          const updatedCandidates: any[] = await manager.query(
            `UPDATE unverified_sign_candidates SET status = $2
             WHERE id = $1 AND status = $3
             RETURNING id`,
            [candidate.id, CandidateStatus.REJECTED, candidate.status],
          );
          updateCandAffected = getAffectedRowCount(updatedCandidates);
          await manager.query(
            `UPDATE candidate_recapture_requests
             SET completed_at = NOW()
             WHERE candidate_id = $1 AND completed_at IS NULL`,
            [candidate.id],
          );
        }
        if (updateCandAffected !== 1) throw new ConflictException('Candidate state changed while banning involved user');
      }

      let updateReportAffected = 0;
      if (typeof manager.getRepository === 'function') {
        const res = await manager.getRepository(MissingSignTypeReport)
          .createQueryBuilder()
          .update(MissingSignTypeReport)
          .set({
            status: MissingTypeStatus.REJECTED,
            staffNotes: reason,
            reviewedBy: adminId,
            updatedAt: new Date(),
          })
          .where('id = :id AND status = :status', { id: reportId, status: MissingTypeStatus.ESCALATED_ADMIN })
          .execute();
        updateReportAffected = res.affected ?? 0;
      } else if (typeof manager.query === 'function') {
        const updatedReports: any[] = await manager.query(
          `UPDATE missing_sign_type_reports
           SET status = $2, staff_notes = $3, reviewed_by = $4, updated_at = NOW()
           WHERE id = $1 AND status = $5
           RETURNING id`,
          [reportId, MissingTypeStatus.REJECTED, reason, adminId, MissingTypeStatus.ESCALATED_ADMIN],
        );
        updateReportAffected = getAffectedRowCount(updatedReports);
      }
      if (updateReportAffected !== 1) throw new ConflictException('Report state changed while banning involved user');

      if (typeof manager.getRepository === 'function') {
        await manager.getRepository(User).update(target.id, {
          status: UserStatus.BANNED,
          updatedAt: new Date(),
        });
        const statRepo = manager.getRepository(UserStatusHistory);
        await statRepo.save(statRepo.create({
          userId: target.id,
          oldStatus: target.status,
          newStatus: 'BANNED',
          reason,
          changedBy: adminId,
        }));
        const audRepo = manager.getRepository(AuditLog);
        await audRepo.save(audRepo.create({
          userId: adminId,
          action: 'ADMIN_NEW_SIGN_USER_BAN',
          resourceName: 'users',
          resourceId: target.id,
          oldValues: { status: target.status },
          newValues: { status: 'BANNED', reason, reportId, targetRole },
        }));
      } else if (typeof manager.query === 'function') {
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
      }
      await this.resolveAdminReportCase(
        manager,
        reportId,
        adminId,
        'BAN_USER',
        `${targetRole} user ${target.id} banned: ${reason}`,
      );
      return {
        reporterId: report.reporterId,
        proposedName: report.proposedName,
        targetUserId: target.id,
        previousStatus: target.status,
      };
    });

    await this.notifyReporter(
      { id: reportId, reporterId: result.reporterId, proposedName: result.proposedName },
      'REJECTED',
      'BÃ¡o cÃ¡o biá»ƒn bÃ¡o má»›i Ä‘Ã£ Ä‘Æ°á»£c xá»­ lÃ½',
      'BÃ¡o cÃ¡o "' + (result.proposedName || 'biá»ƒn bÃ¡o má»›i') + '" Ä‘Ã£ Ä‘Æ°á»£c quáº£n trá»‹ viÃªn xá»­ lÃ½.',
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
    let caseId: string | undefined;
    if (typeof manager.getRepository === 'function') {
      const caseRepo = manager.getRepository(ModerationCase);
      const actionRepo = manager.getRepository(ModerationAction);
      const existingCase = await caseRepo
        .createQueryBuilder('c')
        .setLock('pessimistic_write')
        .where('c.targetEntityType = :targetEntityType AND c.targetEntityId = :targetEntityId', {
          targetEntityType: 'missing_sign_type_report',
          targetEntityId: reportId,
        })
        .orderBy('c.createdAt', 'DESC')
        .getOne();
      if (existingCase) {
        caseId = existingCase.id;
        await caseRepo.update(caseId, {
          status: ModerationStatus.RESOLVED,
          resolutionNote: reason,
          resolvedAt: new Date(),
        });
      } else {
        const newCase = caseRepo.create({
          caseType: ModerationType.CATALOG_PROPOSAL,
          targetEntityType: 'missing_sign_type_report',
          targetEntityId: reportId,
          assignedStaffId: adminId,
          status: ModerationStatus.RESOLVED,
          resolutionNote: reason,
          resolvedAt: new Date(),
        });
        const savedCase = await caseRepo.save(newCase);
        caseId = savedCase.id;
      }
      if (!caseId) throw new Error('Failed to resolve admin report moderation case');
      await actionRepo.save(actionRepo.create({
        caseId,
        actionType,
        performedBy: adminId,
        note: reason,
      }));
      return caseId;
    }
    const caseRows: any[] = await manager.query(
      `SELECT id FROM moderation_cases
       WHERE target_entity_type = 'missing_sign_type_report' AND target_entity_id = $1
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [reportId],
    );
    caseId = caseRows[0]?.id;
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
    const result = await this.dataSource.transaction(async (manager) => {
      let report: { id: string; candidateId?: string | null; reporterId?: string | null; proposedName?: string | null; status: MissingTypeStatus } | null = null;
      if (typeof manager.getRepository === 'function') {
        const found = await manager.getRepository(MissingSignTypeReport)
          .createQueryBuilder('r')
          .setLock('pessimistic_write')
          .where('r.id = :id', { id: reportId })
          .getOne();
        if (found) {
          report = {
            id: found.id,
            candidateId: found.candidateId,
            reporterId: found.reporterId,
            proposedName: found.proposedName,
            status: found.status,
          };
        }
      } else if (typeof manager.query === 'function') {
        const reportRows: any[] = await manager.query(
          `SELECT id, candidate_id, reporter_id, proposed_name, status
           FROM missing_sign_type_reports
           WHERE id = $1
           FOR UPDATE`,
          [reportId],
        );
        if (reportRows[0]) {
          report = {
            id: reportRows[0].id,
            candidateId: reportRows[0].candidate_id,
            reporterId: reportRows[0].reporter_id,
            proposedName: reportRows[0].proposed_name,
            status: reportRows[0].status,
          };
        }
      }
      if (!report) throw new NotFoundException('MissingSignTypeReport ' + reportId + ' not found');
      if (report.status !== expectedStatus) {
        throw new BadRequestException('Report status must be ' + expectedStatus + ' to request recapture');
      }
      if (!report.candidateId) {
        throw new BadRequestException('A candidate-linked report is required to request recapture');
      }

      let candidate: { id: string; status: CandidateStatus } | null = null;
      if (typeof manager.getRepository === 'function') {
        candidate = await manager.getRepository(UnverifiedSignCandidate)
          .createQueryBuilder('c')
          .setLock('pessimistic_write')
          .where('c.id = :id', { id: report.candidateId })
          .getOne();
      } else if (typeof manager.query === 'function') {
        const candidateRows: any[] = await manager.query(
          `SELECT id, status
           FROM unverified_sign_candidates
           WHERE id = $1
           FOR UPDATE`,
          [report.candidateId],
        );
        candidate = candidateRows[0] ?? null;
      }
      if (!candidate) throw new NotFoundException('Candidate ' + report.candidateId + ' not found');
      if (candidate.status !== CandidateStatus.MISSING_TYPE_HOLD) {
        throw new BadRequestException('Candidate must be on MISSING_TYPE_HOLD to request recapture');
      }

      let activeRequestsCount = 0;
      if (typeof manager.getRepository === 'function') {
        activeRequestsCount = await manager.getRepository(CandidateRecaptureRequest)
          .createQueryBuilder('r')
          .setLock('pessimistic_write')
          .where('r.candidateId = :candidateId AND r.completedAt IS NULL', { candidateId: candidate.id })
          .getCount();
      } else if (typeof manager.query === 'function') {
        const activeRequests: any[] = await manager.query(
          `SELECT id FROM candidate_recapture_requests
           WHERE candidate_id = $1 AND completed_at IS NULL
           FOR UPDATE`,
          [candidate.id],
        );
        activeRequestsCount = activeRequests.length;
      }
      if (activeRequestsCount > 0) {
        throw new ConflictException('An active recapture request already exists for candidate ' + candidate.id);
      }
      // Open quest; eligible Surveyors discover nearby requests through GET /reviews/me/recaptures.

      let updateReportAffected = 0;
      if (typeof manager.getRepository === 'function') {
        const res = await manager.getRepository(MissingSignTypeReport)
          .createQueryBuilder()
          .update(MissingSignTypeReport)
          .set({
            status: MissingTypeStatus.INCOMPLETE,
            ...(note != null ? { staffNotes: note } : {}),
            reviewedBy: staffId,
            updatedAt: new Date(),
          })
          .where('id = :id AND status = :status', { id: reportId, status: expectedStatus })
          .execute();
        updateReportAffected = res.affected ?? 0;
      } else if (typeof manager.query === 'function') {
        const updatedReports: any[] = await manager.query(
          `UPDATE missing_sign_type_reports
           SET status = $2, staff_notes = COALESCE($3, staff_notes), reviewed_by = $4, updated_at = NOW()
           WHERE id = $1 AND status = $5
           RETURNING id`,
          [reportId, MissingTypeStatus.INCOMPLETE, note, staffId, expectedStatus],
        );
        updateReportAffected = getAffectedRowCount(updatedReports);
      }
      if (updateReportAffected !== 1) throw new ConflictException('Report state changed before recapture request creation');

      let updateCandAffected = 0;
      if (typeof manager.getRepository === 'function') {
        const res = await manager.getRepository(UnverifiedSignCandidate)
          .createQueryBuilder()
          .update(UnverifiedSignCandidate)
          .set({ status: CandidateStatus.RECAPTURE_REQUESTED })
          .where('id = :id AND status = :status', { id: candidate.id, status: CandidateStatus.MISSING_TYPE_HOLD })
          .execute();
        updateCandAffected = res.affected ?? 0;
      } else if (typeof manager.query === 'function') {
        const updatedCandidates: any[] = await manager.query(
          `UPDATE unverified_sign_candidates
           SET status = $2
           WHERE id = $1 AND status = $3
           RETURNING id`,
          [candidate.id, CandidateStatus.RECAPTURE_REQUESTED, CandidateStatus.MISSING_TYPE_HOLD],
        );
        updateCandAffected = getAffectedRowCount(updatedCandidates);
      }
      if (updateCandAffected !== 1) {
        throw new ConflictException('Candidate state changed before recapture request creation');
      }

      try {
        if (typeof manager.getRepository === 'function') {
          const recRepo = manager.getRepository(CandidateRecaptureRequest);
          await recRepo.save(recRepo.create({
            candidateId: candidate.id,
            reviewerId: staffId,
            missingTypeReportId: reportId,
            reason: 'MISSING_TYPE_RECAPTURE_REQUESTED',
            note,
          }));
        } else if (typeof manager.query === 'function') {
          await manager.query(
            `INSERT INTO candidate_recapture_requests
               (candidate_id, reviewer_id, missing_type_report_id, reason, note)
             VALUES ($1, $2, $3, 'MISSING_TYPE_RECAPTURE_REQUESTED', $4)`,
            [candidate.id, staffId, reportId, note],
          );
        }
      } catch (error: any) {
        if (error?.code === '23505' || String(error?.detail ?? '').includes('uq_candidate_recapture_requests_one_active')) {
          throw new ConflictException('An active recapture request already exists for candidate ' + candidate.id);
        }
        throw error;
      }

      let moderationCaseId: string | undefined;
      if (typeof manager.getRepository === 'function') {
        const caseRepo = manager.getRepository(ModerationCase);
        const actionRepo = manager.getRepository(ModerationAction);
        const reportCase = await caseRepo
          .createQueryBuilder('c')
          .setLock('pessimistic_write')
          .where('c.targetEntityType = :targetEntityType AND c.targetEntityId = :targetEntityId', {
            targetEntityType: 'missing_sign_type_report',
            targetEntityId: reportId,
          })
          .orderBy('c.createdAt', 'DESC')
          .getOne();
        if (reportCase) {
          moderationCaseId = reportCase.id;
          await caseRepo.update(moderationCaseId, {
            status: ModerationStatus.RESOLVED,
            resolutionNote: note,
            resolvedAt: new Date(),
          });
        } else {
          const newCase = caseRepo.create({
            caseType: ModerationType.CATALOG_PROPOSAL,
            targetEntityType: 'candidate',
            targetEntityId: candidate.id,
            assignedStaffId: staffId,
            status: ModerationStatus.RESOLVED,
            resolutionNote: note,
            resolvedAt: new Date(),
          });
          const savedCase = await caseRepo.save(newCase);
          moderationCaseId = savedCase.id;
        }
        if (!moderationCaseId) throw new Error('Failed to create recapture moderation case');
        await actionRepo.save(actionRepo.create({
          caseId: moderationCaseId,
          actionType: 'REQUEST_RECAPTURE',
          performedBy: staffId,
          note,
        }));
      } else if (typeof manager.query === 'function') {
        const reportCaseRows: any[] = await manager.query(
          `SELECT id FROM moderation_cases
           WHERE target_entity_type = 'missing_sign_type_report' AND target_entity_id = $1
           ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
          [reportId],
        );
        moderationCaseId = reportCaseRows[0]?.id;
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
      }
      return { reporterId: report.reporterId, proposedName: report.proposedName, candidateId: candidate.id };
    });

    if (result.reporterId) {
      try {
        await this.notificationsService.create(
          result.reporterId,
          'MISSING_TYPE_INCOMPLETE',
          'BÃ¡o cÃ¡o biá»ƒn bÃ¡o cáº§n Ä‘Æ°á»£c chá»¥p láº¡i',
          'BÃ¡o cÃ¡o "' + (result.proposedName || 'biá»ƒn bÃ¡o má»›i') + '" cáº§n Ä‘Æ°á»£c Surveyor chá»¥p láº¡i áº£nh táº¡i vá»‹ trÃ­ Ä‘Ã£ gá»­i.',
          'missing_sign_type_report',
          reportId,
        );
      } catch (error: any) {
        this.logger.warn('Report recapture notification failed: ' + error?.message);
      }
    }
    return this.getMissingReport(reportId);
  }

  async getNewSignReport(id: string) {
    const r = await this.missing.findOne({ where: { id } });
    if (!r) throw new NotFoundException('NewSignTypeReport ' + id + ' not found');
    const [enriched] = await this.enrichWithCandidates([r]);
    return enriched;
  }

  getMissingReport(id: string) {
    return this.getNewSignReport(id);
  }

  /**
   * Scenario #4 â€” admin approves the report, creates the TrafficSignType via
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

    const reportName = report.proposedName?.trim() || 'Biá»ƒn bÃ¡o má»›i';
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
    await this.notifyReporter(report, 'APPROVED', 'BÃ¡o cÃ¡o biá»ƒn bÃ¡o má»›i Ä‘Ã£ Ä‘Æ°á»£c cháº¥p thuáº­n', 'BÃ¡o cÃ¡o "' + (report.proposedName || 'biá»ƒn bÃ¡o má»›i') + '" Ä‘Ã£ Ä‘Æ°á»£c thÃªm vÃ o danh má»¥c vá»›i mÃ£ "' + signCode + '".');

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
    if (actionType === 'REQUEST_RECAPTURE' && mc.targetEntityType === 'missing_sign_type_report' && mc.targetEntityId) {
      return this.requestMissingReportRecapture(
        mc.targetEntityId,
        staffId,
        dto.actionNote?.trim() || dto.resolutionNote,
        MissingTypeStatus.ESCALATED_ADMIN,
      );
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
        const actionText: Record<string, string> = { APPROVED: 'Ä‘Ã£ Ä‘Æ°á»£c cháº¥p thuáº­n', MERGED: 'Ä‘Ã£ Ä‘Æ°á»£c gá»™p vÃ o loáº¡i biá»ƒn bÃ¡o hiá»‡n cÃ³', REJECTED: 'Ä‘Ã£ bá»‹ tá»« chá»‘i' };
        if (rep?.reporterId) await this.notificationsService.create(rep.reporterId, 'MODERATION_RESOLVED', 'Cáº­p nháº­t bÃ¡o cÃ¡o biá»ƒn bÃ¡o má»›i', 'BÃ¡o cÃ¡o "' + (rep.proposedName || 'biá»ƒn bÃ¡o má»›i') + '" cá»§a báº¡n ' + (actionText[actionType] ?? 'Ä‘Ã£ Ä‘Æ°á»£c xá»­ lÃ½') + '.', 'moderation_case', mc.id);
      }
    } catch {}
    return mc;
  }
  private async resolveRecaptureCase(caseId: string, staffId: string, dto: ResolveCaseDto) {
    const resolved = await this.dataSource.transaction(async (manager) => {
      let moderationCase: { id: string; targetEntityId: string; status: ModerationStatus; target_entity_id?: string } | null = null;
      if (typeof manager.getRepository === 'function') {
        const found = await manager.getRepository(ModerationCase)
          .createQueryBuilder('c')
          .setLock('pessimistic_write')
          .where('c.id = :id', { id: caseId })
          .getOne();
        if (found) moderationCase = { id: found.id, targetEntityId: found.targetEntityId, status: found.status };
      } else if (typeof manager.query === 'function') {
        const caseRows: any[] = await manager.query(
          `SELECT * FROM moderation_cases WHERE id = $1 FOR UPDATE`,
          [caseId],
        );
        if (caseRows[0]) moderationCase = { id: caseRows[0].id, targetEntityId: caseRows[0].target_entity_id, status: caseRows[0].status, target_entity_id: caseRows[0].target_entity_id };
      }
      if (!moderationCase) throw new NotFoundException('ModerationCase ' + caseId + ' not found');
      if (moderationCase.status === ModerationStatus.RESOLVED) throw new BadRequestException('Case is already resolved');

      const targetEntityId = moderationCase.targetEntityId || moderationCase.target_entity_id!;
      let candidate: { id: string; status: CandidateStatus } | null = null;
      if (typeof manager.getRepository === 'function') {
        const found = await manager.getRepository(UnverifiedSignCandidate)
          .createQueryBuilder('c')
          .setLock('pessimistic_write')
          .where('c.id = :id', { id: targetEntityId })
          .getOne();
        if (found) candidate = { id: found.id, status: found.status };
      } else if (typeof manager.query === 'function') {
        const candidateRows: any[] = await manager.query(
          `SELECT c.id, c.status
           FROM unverified_sign_candidates c
           WHERE c.id = $1
           FOR UPDATE OF c`,
          [targetEntityId],
        );
        candidate = candidateRows[0] ?? null;
      }
      if (!candidate) throw new NotFoundException('Candidate ' + targetEntityId + ' not found');
      if ([CandidateStatus.VERIFIED, CandidateStatus.REJECTED, CandidateStatus.RECAPTURE_REQUESTED].includes(candidate.status)) {
        throw new BadRequestException(`Cannot request recapture for candidate ${candidate.id} with status ${candidate.status}`);
      }

      let activeRequestsCount = 0;
      if (typeof manager.getRepository === 'function') {
        activeRequestsCount = await manager.getRepository(CandidateRecaptureRequest)
          .createQueryBuilder('r')
          .setLock('pessimistic_write')
          .where('r.candidateId = :candidateId AND r.completedAt IS NULL', { candidateId: candidate.id })
          .getCount();
      } else if (typeof manager.query === 'function') {
        const activeRows: any[] = await manager.query(
          `SELECT id FROM candidate_recapture_requests
           WHERE candidate_id = $1 AND completed_at IS NULL
           FOR UPDATE`,
          [candidate.id],
        );
        activeRequestsCount = activeRows.length;
      }
      if (activeRequestsCount > 0) throw new ConflictException(`An active recapture request already exists for candidate ${candidate.id}`);

      let reportRows: Array<{ id: string }> = [];
      if (typeof manager.getRepository === 'function') {
        const reports = await manager.getRepository(MissingSignTypeReport)
          .createQueryBuilder('r')
          .setLock('pessimistic_write')
          .where('r.candidateId = :candidateId AND r.status = :status', { candidateId: candidate.id, status: MissingTypeStatus.INCOMPLETE })
          .getMany();
        reportRows = reports.map((r) => ({ id: r.id }));
      } else if (typeof manager.query === 'function') {
        reportRows = await manager.query(
          `SELECT id FROM missing_sign_type_reports
           WHERE candidate_id = $1 AND status = 'INCOMPLETE'
           FOR UPDATE`,
          [candidate.id],
        );
      }
      if (reportRows.length !== 1) {
        throw new BadRequestException(
          `Cannot request recapture for candidate ${candidate.id}: expected exactly one INCOMPLETE Missing Type Report, found ${reportRows.length}`,
        );
      }
      // Open quest; the first eligible nearby Surveyor claims it on submission.

      let updateCandAffected = 0;
      if (typeof manager.getRepository === 'function') {
        const res = await manager.getRepository(UnverifiedSignCandidate)
          .createQueryBuilder()
          .update(UnverifiedSignCandidate)
          .set({ status: CandidateStatus.RECAPTURE_REQUESTED })
          .where('id = :id AND status NOT IN (:...excludeStatuses)', {
            id: candidate.id,
            excludeStatuses: [CandidateStatus.VERIFIED, CandidateStatus.REJECTED, CandidateStatus.RECAPTURE_REQUESTED],
          })
          .execute();
        updateCandAffected = res.affected ?? 0;
      } else if (typeof manager.query === 'function') {
        const candidateUpdate = await manager.query(
          `UPDATE unverified_sign_candidates
           SET status = 'RECAPTURE_REQUESTED'
           WHERE id = $1 AND status NOT IN ('VERIFIED', 'REJECTED', 'RECAPTURE_REQUESTED')`,
          [candidate.id],
        );
        updateCandAffected = getAffectedRowCount(candidateUpdate);
      }
      if (updateCandAffected !== 1) throw new BadRequestException('Candidate state changed before recapture request creation');

      try {
        if (typeof manager.getRepository === 'function') {
          const recRepo = manager.getRepository(CandidateRecaptureRequest);
          await recRepo.save(recRepo.create({
            candidateId: candidate.id,
            reviewerId: staffId,
            missingTypeReportId: reportRows[0].id,
            reason: 'MODERATION_RECAPTURE_REQUESTED',
            note: dto.resolutionNote ?? null,
          }));
        } else if (typeof manager.query === 'function') {
          await manager.query(
            `INSERT INTO candidate_recapture_requests
               (candidate_id, reviewer_id, missing_type_report_id, reason, note)
             VALUES ($1, $2, $3, 'MODERATION_RECAPTURE_REQUESTED', $4)`,
            [candidate.id, staffId, reportRows[0].id, dto.resolutionNote ?? null],
          );
        }
      } catch (error: any) {
        if (error?.code === '23505' || String(error?.detail ?? '').includes('uq_candidate_recapture_requests_one_active')) {
          throw new ConflictException(`An active recapture request already exists for candidate ${candidate.id}`);
        }
        throw error;
      }

      let updatedCaseResult: any;
      if (typeof manager.getRepository === 'function') {
        const caseRepo = manager.getRepository(ModerationCase);
        const actionRepo = manager.getRepository(ModerationAction);
        await caseRepo.update(caseId, {
          status: ModerationStatus.RESOLVED,
          resolutionNote: dto.resolutionNote ?? null as any,
          resolvedAt: new Date(),
          assignedStaffId: staffId,
        });
        updatedCaseResult = await caseRepo.findOne({ where: { id: caseId } });
        await actionRepo.save(actionRepo.create({
          caseId,
          actionType: 'REQUEST_RECAPTURE',
          performedBy: staffId,
          note: dto.actionNote ?? dto.resolutionNote ?? null,
        }));
      } else if (typeof manager.query === 'function') {
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
        updatedCaseResult = updatedCases[0];
      }
      return updatedCaseResult;
    });

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
    const reportName = report.proposedName?.trim() || 'Biá»ƒn bÃ¡o má»›i';
    const baseCode = (report.proposedName || 'NEW').toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 20) || 'NEW_SIGN';
    let signCode = baseCode;
    let suffix = 0;
    while (await this.signTypeRepo.findOne({ where: { signCode } })) { suffix++; signCode = baseCode + '_' + suffix; }
    const created = this.signTypeRepo.create({ categoryId, signCode, nameVi: reportName, nameEn: reportName, description: report.description ?? dto.resolutionNote ?? null, isActive: true, createdAt: new Date(), updatedAt: new Date() } as any);
    const saved = await this.signTypeRepo.save(created) as unknown as TrafficSignType;

    let repUrl: string | null = null;
    if (report.candidateId) {
      if (this.candRepo && typeof this.candRepo.findOne === 'function') {
        const cand = await this.candRepo.findOne({ where: { id: report.candidateId } });
        repUrl = cand?.signCropUrl || cand?.bestFrameUrl || null;
      }
      if (!repUrl && typeof this.dataSource?.query === 'function') {
        const candRows: any[] = await this.dataSource.query(
          'SELECT sign_crop_url, best_frame_url FROM unverified_sign_candidates WHERE id = $1',
          [report.candidateId],
        );
        repUrl = candRows[0]?.sign_crop_url || candRows[0]?.best_frame_url || null;
      }
    }
    if (!repUrl) {
      repUrl = `https://s3.signmap.site/stm-sign-crops/representative/${signCode}.png`;
    }
    if (this.signTypeImageRepo && typeof this.signTypeImageRepo.save === 'function') {
      await this.signTypeImageRepo.save(this.signTypeImageRepo.create({
        signTypeId: saved.id,
        imageUrl: repUrl,
        imageType: 'REPRESENTATIVE',
        isPrimary: true,
      }));
    } else if (typeof this.dataSource?.query === 'function') {
      await this.dataSource.query(
        `INSERT INTO sign_type_images (sign_type_id, image_url, image_type, is_primary, uploaded_at)
         VALUES ($1, $2, 'REPRESENTATIVE', true, now())`,
        [saved.id, repUrl],
      );
    }

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
    const trimmed = input.trim();
    const match = trimmed.match(/^([A-Za-z]+)\.\s*(\d+)([A-Za-z0-9]*)$/);
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
    const allowedPrefixes = new Set(['P', 'W', 'R', 'I', 'E', 'IE', 'S']);
    const validPrefixes = existingPrefixes.map((row) => row.prefix).filter((prefix) => allowedPrefixes.has(prefix));
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
      if (this.candRepo && typeof this.candRepo.update === 'function') {
        await this.candRepo.update(
          { id: candidateId, status: CandidateStatus.MISSING_TYPE_HOLD },
          { predictedSignTypeId: signTypeId, status: CandidateStatus.PENDING_REVIEW },
        );
      } else {
        await this.dataSource.query(
          `UPDATE unverified_sign_candidates
           SET predicted_sign_type_id = $1, status = 'PENDING_REVIEW'
           WHERE id = $2::uuid AND status = 'MISSING_TYPE_HOLD'`,
          [signTypeId, candidateId],
        );
      }
      this.logger.log('Released candidate ' + candidateId + ' to PENDING_REVIEW (type #' + signTypeId + ')');
    } catch (e: any) {
      this.logger.warn('Failed to release candidate ' + candidateId + ': ' + (e as any)?.message);
    }
  }

  /** MERGED/REJECTED/INCOMPLETE triage side-effects on the linked candidate. */
  private async applyCandidateSideEffect(report: NewSignTypeReport, previousStatus: MissingTypeStatus) {
    if (!report.candidateId) return;
    const candidate = await this.candRepo.findOne({ where: { id: report.candidateId } });
    if (!candidate) return;
    if (report.status === MissingTypeStatus.REJECTED) {
      await this.candRepo.update({ id: report.candidateId }, { status: CandidateStatus.REJECTED });
      await this.notifyReporter(report, 'REJECTED', 'BÃ¡o cÃ¡o biá»ƒn bÃ¡o má»›i bá»‹ tá»« chá»‘i', 'BÃ¡o cÃ¡o "' + (report.proposedName || 'biá»ƒn bÃ¡o má»›i') + '" cá»§a báº¡n Ä‘Ã£ bá»‹ nhÃ¢n viÃªn tá»« chá»‘i.');
    } else if (report.status === MissingTypeStatus.MERGED && report.mergedIntoSignTypeId != null) {
      await this.releaseCandidate(report.candidateId, report.mergedIntoSignTypeId);
      await this.notifyReporter(report, 'MERGED', 'BÃ¡o cÃ¡o biá»ƒn bÃ¡o má»›i Ä‘Ã£ Ä‘Æ°á»£c gá»™p', 'BÃ¡o cÃ¡o "' + (report.proposedName || 'biá»ƒn bÃ¡o má»›i') + '" cá»§a báº¡n Ä‘Ã£ Ä‘Æ°á»£c gá»™p vÃ o loáº¡i biá»ƒn bÃ¡o hiá»‡n cÃ³ #' + report.mergedIntoSignTypeId + '.');
    } else if (report.status === MissingTypeStatus.APPROVED && previousStatus !== MissingTypeStatus.APPROVED && report.mergedIntoSignTypeId != null) {
      await this.releaseCandidate(report.candidateId, report.mergedIntoSignTypeId);
    } else if (report.status === MissingTypeStatus.INCOMPLETE || report.status === MissingTypeStatus.ESCALATED_ADMIN) {
      // candidate stays on hold; staff asked for more info
      const statusText = report.status === MissingTypeStatus.INCOMPLETE ? 'chÆ°a Ä‘áº§y Ä‘á»§' : 'Ä‘Æ°á»£c chuyá»ƒn Ä‘áº¿n quáº£n trá»‹ viÃªn';
      await this.notifyReporter(report, report.status, 'BÃ¡o cÃ¡o biá»ƒn bÃ¡o má»›i cáº§n Ä‘Æ°á»£c bá»• sung', 'BÃ¡o cÃ¡o "' + (report.proposedName || 'biá»ƒn bÃ¡o má»›i') + '" cá»§a báº¡n Ä‘ang á»Ÿ tráº¡ng thÃ¡i ' + statusText + '.');
    }
  }

  private async enrichWithCandidates(reports: NewSignTypeReport[]): Promise<(NewSignTypeReport & { candidate?: CandidateEnriched | null })[]> {
    if (reports.length === 0) return reports as any;
    const ids = reports.filter(r => r.candidateId).map(r => r.candidateId as string);
    const byId = new Map<string, CandidateEnriched>();
    if (ids.length > 0) {
      let rows: any[] = [];
      if (this.candRepo && typeof this.candRepo.createQueryBuilder === 'function') {
        rows = await this.candRepo
          .createQueryBuilder('c')
          .leftJoin(CandidateGeoEstimation, 'ge', 'ge.candidateId = c.id')
          .select([
            'c.id AS id',
            'c.predictedSignTypeId AS predicted_sign_type_id',
            'c.confidenceScore AS confidence_score',
            'c.bestFrameUrl AS best_frame_url',
            'c.signCropUrl AS sign_crop_url',
            'c.status AS status',
            'ST_X(ge.signLocation::geometry) AS longitude',
            'ST_Y(ge.signLocation::geometry) AS latitude',
          ])
          .where('c.id IN (:...ids)', { ids })
          .getRawMany();
      }
      if (rows.length === 0 && typeof this.dataSource?.query === 'function') {
        rows = await this.dataSource.query(
          `SELECT c.id, c.predicted_sign_type_id, c.confidence_score, c.best_frame_url, c.sign_crop_url, c.status,
                  ST_X(ge.sign_location::geometry) AS longitude,
                  ST_Y(ge.sign_location::geometry) AS latitude
           FROM unverified_sign_candidates c
           LEFT JOIN candidate_geo_estimations ge ON ge.candidate_id = c.id
           WHERE c.id = ANY($1)`,
          [ids],
        );
      }
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
    report: Pick<NewSignTypeReport, 'id' | 'reporterId' | 'proposedName'>,
    type: string,
    title: string,
    message: string,
  ): Promise<void> {
    try {
      if (report.reporterId) await this.notificationsService.create(report.reporterId, 'MISSING_TYPE_' + type, title, message, 'missing_sign_type_report', report.id);
    } catch (e) { this.logger.warn('reporter notification failed: ' + (e as any)?.message); }
  }
}
