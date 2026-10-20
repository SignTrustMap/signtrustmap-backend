import { Injectable, NotFoundException, BadRequestException, ConflictException, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import { randomUUID } from 'crypto';
import { MissingSignTypeReport, MissingTypeStatus } from '../infrastructure/persistence/missing-sign-type-report.entity';
import { ModerationAction } from '../infrastructure/persistence/moderation-action.entity';
import { ModerationCase, ModerationStatus, ModerationType } from '../infrastructure/persistence/moderation-case.entity';
import { SignCategory } from '../../catalog/sign-category.entity';
import { TrafficSignType } from '../../catalog/traffic-sign-type.entity';
import { UnverifiedSignCandidate, CandidateStatus } from '../../survey/infrastructure/persistence/unverified-sign-candidate.entity';
import { CreateMissingTypeReportDto, ResolveCaseDto, ApproveAndCreateTypeDto } from '../presentation/dto/moderation.dto';
import { NotificationsService } from '../../notifications/notifications.service';
import { CatalogService } from '../../catalog/catalog.service';
import { CatalogSyncService } from '../../../integrations/catalog-sync/catalog-sync.service';
import { MinioStorageService } from '../../../integrations/minio/minio-storage.service';

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
   * Scenario #4 — reviewer reports a sign that is not in the catalog yet.
   * The linked candidate is atomically parked in MISSING_TYPE_HOLD so the
   * review/consensus queue stops offering it until staff resolve the report.
   */
  async reportMissingType(reporterId: string, dto: CreateMissingTypeReportDto) {
    return this.dataSource.transaction(async (manager) => {
      if (dto.candidateId) {
        const c = await this.candRepo.findOne({ where: { id: dto.candidateId } });
        if (!c) throw new BadRequestException('Candidate ' + dto.candidateId + ' not found');
        if (c.status === CandidateStatus.MISSING_TYPE_HOLD) throw new BadRequestException('Candidate ' + dto.candidateId + ' already under a missing-type review');
        const active = await this.missing.findOne({ where: { candidateId: dto.candidateId, status: MissingTypeStatus.PENDING } as any });
        if (active) throw new BadRequestException('A pending missing-type report already exists for candidate ' + dto.candidateId);
      }
      if (dto.proposedCategoryId != null) {
        const cat = await this.catRepo.findOne({ where: { id: dto.proposedCategoryId } });
        if (!cat) throw new BadRequestException('SignCategory #' + dto.proposedCategoryId + ' not found');
      }
      const r = manager.create(MissingSignTypeReport, {
        reporterId,
        candidateId: dto.candidateId ?? null,
        proposedCategoryId: dto.proposedCategoryId ?? null,
        proposedName: dto.proposedName,
        description: dto.description ?? null,
        suggestedShape: dto.suggestedShape ?? null,
        suggestedColorScheme: dto.suggestedColorScheme ?? null,
      } as any);
      const saved = (await manager.save(r)) as unknown as MissingSignTypeReport;
      if (dto.candidateId) {
        await manager.update(UnverifiedSignCandidate, { id: dto.candidateId }, { status: CandidateStatus.MISSING_TYPE_HOLD });
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

  async updateMissingReport(reportId: string, reviewerId: string, dto: any) {
    const report: any = await this.missing.findOne({ where: { id: reportId } as any });
    if (!report) throw new NotFoundException('MissingSignTypeReport ' + reportId + ' not found');
    let requestedStatus = dto.status;
    if (requestedStatus === 'IN_REVIEW' || requestedStatus === 'ESCALATED') requestedStatus = MissingTypeStatus.ESCALATED_ADMIN;
    else if (requestedStatus === 'OPEN') requestedStatus = MissingTypeStatus.PENDING;
    const allowed = Object.values(MissingTypeStatus);
    if (requestedStatus && !allowed.includes(requestedStatus)) throw new BadRequestException('status must be one of ' + allowed.join(', '));
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
    if (report.status === MissingTypeStatus.APPROVED || report.status === MissingTypeStatus.MERGED) throw new BadRequestException('Report already ' + report.status);
    if (report.status === MissingTypeStatus.REJECTED) throw new BadRequestException('Report was rejected; re-open it before approving');

    const categoryId = dto.proposedCategoryId ?? report.proposedCategoryId;
    const category = categoryId != null ? await this.catRepo.findOne({ where: { id: categoryId } }) : null;
    const resolvedCategoryId = category?.id ?? (await this.requireFallbackCategory());

    const nameVi = dto.nameVi?.trim() || report.proposedName.trim();
    const nameEn = dto.nameEn?.trim() || report.proposedName.trim();

    let created: any;
    const requestedCode = dto.signCode?.trim()?.toUpperCase();
    const existingType = requestedCode
      ? await this.signTypeRepo.findOne({ where: { signCode: requestedCode } })
      : null;

    let signCode: string;
    if (existingType) {
      created = existingType;
      signCode = existingType.signCode;
      this.logger.log(`Found existing TrafficSignType #${created.id} (${signCode}), reusing for report ${reportId}`);
    } else {
      signCode = await this.buildSignCode(dto.signCode?.trim() || nameEn, nameEn);
      const description = dto.description?.trim() || report.description || undefined;
      const aiLabelPrompt =
        dto.aiLabelPrompt?.trim() ||
        `Sign "${nameEn}" - road traffic sign (${nameVi || nameEn}). shape=${report.suggestedShape || 'unknown'}, color_scheme=${report.suggestedColorScheme || 'unknown'}`;

      let representativeImageKey = dto.representativeImageKey?.trim();
      if (file && this.minioStorageService) {
        const cleanCode = signCode.toUpperCase().replace(/[^A-Z0-9._-]/g, '');
        const key = `catalog/representative/${cleanCode}-${randomUUID()}-${(file.originalname || 'image.png').replace(/[^a-zA-Z0-9._-]/g, '')}`;
        await this.minioStorageService.putObject('stm-sign-crops', key, file.buffer, file.mimetype);
        representativeImageKey = this.minioStorageService.getPublicUrl('stm-sign-crops', key);
      }
      if (!representativeImageKey && report.candidateId) {
        try {
          const candRows: any[] = await this.dataSource.query(
            'SELECT sign_crop_url, best_frame_url FROM unverified_sign_candidates WHERE id = $1',
            [report.candidateId],
          );
          if (candRows.length > 0) {
            representativeImageKey = candRows[0].sign_crop_url || candRows[0].best_frame_url || undefined;
          }
        } catch (err: any) {
          this.logger.warn('Failed to fetch candidate image: ' + (err as any)?.message);
        }
        if (!representativeImageKey) {
          representativeImageKey = `https://s3.signmap.site/stm-sign-crops/candidates/${report.candidateId}/crop.jpg`;
        }
      }
      if (!representativeImageKey) {
        representativeImageKey = `https://s3.signmap.site/stm-sign-crops/representative/${signCode}.png`;
      }

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
        isActive: true,
      });
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
    await this.notifyReporter(report, 'APPROVED', 'Missing-type report approved', 'Sign type "' + report.proposedName + '" was approved and added to the catalog as "' + signCode + '".');

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
        if (rep?.reporterId) await this.notificationsService.create(rep.reporterId, 'MODERATION_RESOLVED', 'Missing-type report ' + actionType, 'Your report "' + rep.proposedName + '" was ' + actionType.toLowerCase() + '.', 'moderation_case', mc.id);
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
        `SELECT c.id, c.status, s.surveyor_id
         FROM unverified_sign_candidates c
         JOIN survey_submissions s ON s.id = c.submission_id
         WHERE c.id = $1
         FOR UPDATE OF c`,
        [moderationCase.target_entity_id],
      );
      const candidate = candidateRows[0];
      if (!candidate) throw new NotFoundException('Candidate ' + moderationCase.target_entity_id + ' not found');
      if ([CandidateStatus.VERIFIED, CandidateStatus.REJECTED, CandidateStatus.RECAPTURE_REQUESTED].includes(candidate.status)) {
        throw new BadRequestException(`Cannot request recapture for candidate ${candidate.id} with status ${candidate.status}`);
      }
      surveyorId = candidate.surveyor_id ?? null;

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
          'YÃªu cáº§u chá»¥p láº¡i áº£nh biá»ƒn bÃ¡o',
          `Quáº£n trá»‹ viÃªn yÃªu cáº§u chá»¥p láº¡i áº£nh biá»ƒn bÃ¡o: ${dto.resolutionNote ?? ''}`,
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
    const baseCode = (report.proposedName || 'NEW').toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 20) || 'NEW_SIGN';
    let signCode = baseCode;
    let suffix = 0;
    while (await this.signTypeRepo.findOne({ where: { signCode } })) { suffix++; signCode = baseCode + '_' + suffix; }
    const created = this.signTypeRepo.create({ categoryId, signCode, nameVi: report.proposedName, nameEn: report.proposedName, description: report.description ?? dto.resolutionNote ?? null, isActive: true, createdAt: new Date(), updatedAt: new Date() } as any);
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

  private async buildSignCode(preferred: string, nameEn: string): Promise<string> {
    const base = (preferred || nameEn || 'NEW')
      .toUpperCase()
      .replace(/\s+/g, '_')
      .replace(/[^A-Z0-9._-]+/g, '')
      .slice(0, 50) || 'NEW_SIGN';
    let candidate = base;
    let suffix = 0;
    while (await this.signTypeRepo.findOne({ where: { signCode: candidate } })) { suffix++; candidate = base + '_' + suffix; }
    return candidate;
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
      await this.notifyReporter(report, 'REJECTED', 'Missing-type report rejected', 'Your report "' + report.proposedName + '" was rejected by staff.');
    } else if (report.status === MissingTypeStatus.MERGED && report.mergedIntoSignTypeId != null) {
      await this.releaseCandidate(report.candidateId, report.mergedIntoSignTypeId);
      await this.notifyReporter(report, 'MERGED', 'Missing-type report merged', 'Your report "' + report.proposedName + '" was mapped to existing sign type #' + report.mergedIntoSignTypeId + '.');
    } else if (report.status === MissingTypeStatus.APPROVED && previousStatus !== MissingTypeStatus.APPROVED && report.mergedIntoSignTypeId != null) {
      await this.releaseCandidate(report.candidateId, report.mergedIntoSignTypeId);
    } else if (report.status === MissingTypeStatus.INCOMPLETE || report.status === MissingTypeStatus.ESCALATED_ADMIN) {
      // candidate stays on hold; staff asked for more info
      await this.notifyReporter(report, report.status, 'Missing-type report needs attention', 'Your report "' + report.proposedName + '" status: ' + report.status + '.');
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

  private async notifyReporter(report: MissingSignTypeReport, type: string, title: string, message: string): Promise<void> {
    try {
      if (report.reporterId) await this.notificationsService.create(report.reporterId, 'MISSING_TYPE_' + type, title, message, 'missing_sign_type_report', report.id);
    } catch (e) { this.logger.warn('reporter notification failed: ' + (e as any)?.message); }
  }
}
