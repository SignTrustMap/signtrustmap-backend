import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { MissingSignTypeReport, MissingTypeStatus } from '../infrastructure/persistence/missing-sign-type-report.entity';
import { ModerationAction } from '../infrastructure/persistence/moderation-action.entity';
import { ModerationCase, ModerationStatus } from '../infrastructure/persistence/moderation-case.entity';
import { SignCategory } from '../../catalog/sign-category.entity';
import { TrafficSignType } from '../../catalog/traffic-sign-type.entity';
import { UnverifiedSignCandidate } from '../../survey/infrastructure/persistence/unverified-sign-candidate.entity';
import { CreateMissingTypeReportDto, ResolveCaseDto } from '../presentation/dto/moderation.dto';
import { NotificationsService } from '../../notifications/notifications.service';
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
  ) {}
  async reportMissingType(reporterId: string, dto: CreateMissingTypeReportDto) {
    if (dto.candidateId) { const c = await this.candRepo.findOne({ where: { id: dto.candidateId } }); if (!c) throw new BadRequestException('Candidate ' + dto.candidateId + ' not found'); }
    if (dto.proposedCategoryId != null) { const cat = await this.catRepo.findOne({ where: { id: dto.proposedCategoryId } }); if (!cat) throw new BadRequestException('SignCategory #' + dto.proposedCategoryId + ' not found'); }
    const r = this.missing.create({ reporterId, candidateId: dto.candidateId ?? null, proposedCategoryId: dto.proposedCategoryId ?? null, proposedName: dto.proposedName, description: dto.description ?? null } as any);
    return this.missing.save(r);
  }
  async listMissingReports(page = 1, pageSize = 20) {
    const p = Math.max(1, page), ps = Math.min(Math.max(1, pageSize), 100);
    const [items, total] = await this.missing.findAndCount({ order: { createdAt: 'DESC' }, skip: (p - 1) * ps, take: ps });
    return { items, total, page: p, pageSize: ps, totalPages: Math.ceil(total / ps) };
  }
  async updateMissingReport(reportId: string, reviewerId: string, dto: any) {
    const report: any = await this.missing.findOne({ where: { id: reportId } as any });
    if (!report) throw new NotFoundException('MissingSignTypeReport ' + reportId + ' not found');
    const allowed = ['PENDING','MERGED','ESCALATED_ADMIN','APPROVED','REJECTED','INCOMPLETE'];
    if (dto.status && !allowed.includes(dto.status)) throw new BadRequestException('status must be one of ' + allowed.join(', '));
    const mergedId = dto.mergedSignTypeId ?? dto.mergedIntoSignTypeId;
    if (mergedId != null) {
      const t = await this.signTypeRepo.findOne({ where: { id: Number(mergedId) } });
      if (!t) throw new BadRequestException('TrafficSignType #' + mergedId + ' not found');
      report.mergedIntoSignTypeId = Number(mergedId);
    }
    if (dto.status) report.status = dto.status;
    if (dto.staffNotes != null) report.staffNotes = dto.staffNotes;
    else if (dto.actionNote != null) report.staffNotes = dto.actionNote;
    report.reviewedBy = reviewerId;
    await this.missing.save(report);
    return report;
  }
  async getMissingReport(id: string) {
    const r = await this.missing.findOne({ where: { id } });
    if (!r) throw new NotFoundException('MissingSignTypeReport ' + id + ' not found');
    return r;
  }
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
        if (rep?.reporterId) await this.notificationsService.create(rep.reporterId, 'MODERATION_RESOLVED', 'Missing-type report ' + actionType, 'Your report \"' + rep.proposedName + '\" was ' + actionType.toLowerCase() + '.', 'moderation_case', mc.id);
      }
    } catch {}
    return mc;
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
    this.logger.log('Merged report ' + reportId + ' -> existing TrafficSignType #' + targetSignTypeId);
  }
}
