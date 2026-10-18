import { Controller, Get, Post, Put, Patch, Body, Param, Query, ParseUUIDPipe, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ModerationService } from '../application/moderation.service';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { CreateMissingTypeReportDto, ResolveCaseDto, UpdateMissingTypeReportDto, ApproveAndCreateTypeDto } from './dto/moderation.dto';

@ApiTags('Moderation')
@ApiBearerAuth()
@Controller()
export class ModerationController {
  constructor(private readonly svc: ModerationService) {}

  @Roles('REVIEWER', 'ADMIN')
  @ApiOperation({ summary: 'Report missing sign type', description: 'Reviewer reports a novel or uncataloged sign type found during peer review' })
  @Post('reviews/missing-type')
  reportMissing(@CurrentUser() user: any, @Body() dto: CreateMissingTypeReportDto) { return this.svc.reportMissingType(user.id, dto); }

  @Roles('STAFF', 'ADMIN')
  @ApiOperation({ summary: 'List missing sign type reports', description: 'Paginated list of missing sign type reports submitted by community reviewers, filterable by status' })
  @Get('moderation/missing-type-reports')
  listMissing(@Query('status') status?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) { const p = page ? parseInt(page, 10) : 1; const ps = pageSize ? parseInt(pageSize, 10) : 20; return this.svc.listMissingReports(status, Number.isNaN(p) ? 1 : p, Number.isNaN(ps) ? 20 : ps); }

  @Roles('STAFF', 'ADMIN')
  @ApiOperation({ summary: 'Get missing sign type report detail', description: 'Retrieve image evidence and details for a missing sign report' })
  @Get('moderation/missing-type-reports/:id')
  getMissing(@Param('id', ParseUUIDPipe) id: string) { return this.svc.getMissingReport(id); }

  @Roles('STAFF', 'ADMIN')
  @ApiOperation({ summary: 'Update missing sign report', description: 'Staff/Admin approves, rejects, or adds notes to a missing sign type report' })
  @Patch('moderation/missing-type-reports/:id')
  updateMissing(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any, @Body() dto: UpdateMissingTypeReportDto) { return this.svc.updateMissingReport(id, user.id, dto); }

  @Roles('ADMIN')
  @ApiOperation({ summary: 'Approve and create new sign type', description: 'Creates the TrafficSignType from a missing-type report, publishes a catalog version, releases held candidates, and triggers AI label sync' })
  @ApiConsumes('multipart/form-data', 'application/json')
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
  resolveCase(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any, @Body() dto: ResolveCaseDto) { return this.svc.resolveCase(id, user.id, dto); }
}
