import { Controller, Get, Post, Put, Patch, Body, Param, Query, ParseUUIDPipe } from '@nestjs/common';
import { ModerationService } from './moderation.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateMissingTypeReportDto, ResolveCaseDto, UpdateMissingTypeReportDto } from './dto/moderation.dto';
@Controller()
export class ModerationController {
  constructor(private readonly svc: ModerationService) {}
  @Roles('REVIEWER', 'ADMIN', 'STAFF')
  @Post('reviews/missing-type')
  reportMissing(@CurrentUser() user: any, @Body() dto: CreateMissingTypeReportDto) { return this.svc.reportMissingType(user.id, dto); }
  @Roles('ADMIN', 'STAFF', 'REVIEWER')
  @Get('moderation/missing-type-reports')
  listMissing(@Query('page') page?: string, @Query('pageSize') pageSize?: string) { const p = page ? parseInt(page, 10) : 1; const ps = pageSize ? parseInt(pageSize, 10) : 20; return this.svc.listMissingReports(Number.isNaN(p) ? 1 : p, Number.isNaN(ps) ? 20 : ps); }
  @Roles('ADMIN', 'STAFF', 'REVIEWER')
  @Get('moderation/missing-type-reports/:id')
  getMissing(@Param('id', ParseUUIDPipe) id: string) { return this.svc.getMissingReport(id); }
  @Roles('STAFF', 'ADMIN')
  @Patch('moderation/missing-type-reports/:id')
  updateMissing(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any, @Body() dto: UpdateMissingTypeReportDto) { return this.svc.updateMissingReport(id, user.id, dto); }
  @Roles('STAFF', 'ADMIN')
  @Get('moderation/cases')
  listCases(@Query('status') status?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) { const p = page ? parseInt(page, 10) : 1; const ps = pageSize ? parseInt(pageSize, 10) : 20; return this.svc.listCases(status, Number.isNaN(p) ? 1 : p, Number.isNaN(ps) ? 20 : ps); }
  @Roles('STAFF', 'ADMIN')
  @Get('moderation/cases/:id')
  getCase(@Param('id', ParseUUIDPipe) id: string) { return this.svc.getCase(id); }
  @Roles('STAFF', 'ADMIN')
  @Put('moderation/cases/:id/resolve')
  resolveCase(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any, @Body() dto: ResolveCaseDto) { return this.svc.resolveCase(id, user.id, dto); }
}