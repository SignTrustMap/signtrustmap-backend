import { Controller, Get, Post, Put, Patch, Body, Param, Query, ParseUUIDPipe, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ModerationService } from '../application/moderation.service';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import {
  AdminMissingTypeActionDto,
  AdminNewSignTypeActionDto,
  ApproveAndCreateTypeDto,
  CreateMissingTypeReportDto,
  CreateNewSignTypeReportDto,
  ResolveCaseDto,
  UpdateMissingTypeReportDto,
  UpdateNewSignTypeReportDto,
} from './dto/moderation.dto';

@ApiTags('Moderation')
@ApiBearerAuth()
@Controller()
export class ModerationController {
  constructor(private readonly svc: ModerationService) {}

  @Roles('REVIEWER', 'ADMIN')
  @ApiOperation({ summary: 'Report a new sign', description: 'Reviewer sends a candidate and its existing photo/location evidence to the staff queue without entering sign details' })
  @Post('reviews/new-sign')
  reportNewSign(@CurrentUser() user: any, @Body() dto: CreateNewSignTypeReportDto) { return this.svc.reportNewSign(user.id, dto); }

  @Roles('REVIEWER', 'ADMIN')
  @ApiOperation({ summary: 'Report a new sign (legacy route)', description: 'Backward-compatible alias for POST /reviews/new-sign' })
  @Post('reviews/missing-type')
  reportMissing(@CurrentUser() user: any, @Body() dto: CreateMissingTypeReportDto) { return this.svc.reportMissingType(user.id, dto); }

  @Roles('STAFF', 'ADMIN')
  @ApiOperation({ summary: 'List new-sign reports', description: 'Paginated list of new-sign reports submitted by community reviewers, filterable by status' })
  @Get('moderation/new-signs')
  listNewSigns(@Query('status') status?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) { const p = page ? parseInt(page, 10) : 1; const ps = pageSize ? parseInt(pageSize, 10) : 20; return this.svc.listNewSignReports(status, Number.isNaN(p) ? 1 : p, Number.isNaN(ps) ? 20 : ps); }

  @Roles('STAFF', 'ADMIN')
  @ApiOperation({ summary: 'List new-sign reports (legacy route)', description: 'Backward-compatible alias for GET /moderation/new-signs' })
  @Get('moderation/missing-type-reports')
  listMissing(@Query('status') status?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) { const p = page ? parseInt(page, 10) : 1; const ps = pageSize ? parseInt(pageSize, 10) : 20; return this.svc.listMissingReports(status, Number.isNaN(p) ? 1 : p, Number.isNaN(ps) ? 20 : ps); }

  @Roles('STAFF', 'ADMIN')
  @ApiOperation({ summary: 'Get new-sign report detail', description: 'Retrieve image evidence and details for a new-sign report' })
  @Get('moderation/new-signs/:id')
  getNewSign(@Param('id', ParseUUIDPipe) id: string) { return this.svc.getNewSignReport(id); }

  @Roles('STAFF', 'ADMIN')
  @ApiOperation({ summary: 'Get new-sign report detail (legacy route)', description: 'Backward-compatible alias for GET /moderation/new-signs/:id' })
  @Get('moderation/missing-type-reports/:id')
  getMissing(@Param('id', ParseUUIDPipe) id: string) { return this.svc.getMissingReport(id); }

  @Roles('STAFF', 'ADMIN')
  @ApiOperation({ summary: 'Update new-sign report', description: 'Staff/Admin approves, rejects, or adds notes to a new-sign report' })
  @Patch('moderation/new-signs/:id')
  updateNewSign(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any, @Body() dto: UpdateNewSignTypeReportDto) { return this.svc.updateNewSignReport(id, user.id, dto); }

  @Roles('STAFF', 'ADMIN')
  @ApiOperation({ summary: 'Update new-sign report (legacy route)', description: 'Backward-compatible alias for PATCH /moderation/new-signs/:id' })
  @Patch('moderation/missing-type-reports/:id')
  updateMissing(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any, @Body() dto: UpdateMissingTypeReportDto) { return this.svc.updateMissingReport(id, user.id, dto); }

  @Roles('ADMIN')
  @ApiOperation({ summary: 'Apply an admin decision to a new-sign report', description: 'Reject the report, request a recapture, or ban an involved non-admin user.' })
  @Patch('moderation/new-signs/:id/admin-action')
  adminNewSignAction(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @Body() dto: AdminNewSignTypeActionDto,
  ) {
    return this.svc.applyAdminNewSignReportAction(id, user.id, dto);
  }

  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Apply an admin decision to a new-sign report (legacy route)',
    description: 'Backward-compatible alias for PATCH /moderation/new-signs/:id/admin-action',
  })
  @Patch('moderation/missing-type-reports/:id/admin-action')
  adminMissingAction(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @Body() dto: AdminMissingTypeActionDto,
  ) {
    return this.svc.applyAdminMissingReportAction(id, user.id, dto);
  }

  @Roles('ADMIN')
  @ApiOperation({ summary: 'Approve and create new sign type', description: 'Creates the TrafficSignType from a new-sign report with a validated representative image upload, publishes a catalog version, releases held candidates, and triggers AI label sync' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  @Post('moderation/new-signs/:id/approve-and-create-type')
  approveAndCreateNewSignType(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @Body() dto: ApproveAndCreateTypeDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.svc.approveAndCreateType(id, user.id, dto, file);
  }

  @Roles('ADMIN')
  @ApiOperation({ summary: 'Approve and create new sign type (legacy route)', description: 'Backward-compatible alias for POST /moderation/new-signs/:id/approve-and-create-type' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  @Post('moderation/missing-type-reports/:id/approve-and-create-type')
  approveAndCreateType(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @Body() dto: ApproveAndCreateTypeDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.svc.approveAndCreateType(id, user.id, dto, file);
  }

  @Roles('STAFF', 'ADMIN')
  @ApiOperation({ summary: 'List moderation cases', description: 'Staff/Admin queue of reported signs, suspected spam, or fraud investigations' })
  @Get('moderation/cases')
  listCases(@Query('status') status?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) { const p = page ? parseInt(page, 10) : 1; const ps = pageSize ? parseInt(pageSize, 10) : 20; return this.svc.listCases(status, Number.isNaN(p) ? 1 : p, Number.isNaN(ps) ? 20 : ps); }

  @Roles('STAFF', 'ADMIN')
  @ApiOperation({ summary: 'Get moderation case detail', description: 'Retrieve full case investigation context, audit history, and evidence' })
  @Get('moderation/cases/:id')
  getCase(@Param('id', ParseUUIDPipe) id: string) { return this.svc.getCase(id); }

  @Roles('STAFF', 'ADMIN')
  @ApiOperation({ summary: 'Resolve moderation case', description: 'Staff/Admin reaches resolution verdict (Dismiss, Ban User, Remove Sign)' })
  @Put('moderation/cases/:id/resolve')
  resolveCase(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any, @Body() dto: ResolveCaseDto) { return this.svc.resolveCase(id, user.id, dto, user?.role); }
}
