import { Controller, Get, Post, Body, Param, Query, ParseUUIDPipe, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RevalidationService } from './revalidation.service';
import { SubmitEvidenceDto, EvidenceVoteDto } from './dto/revalidation.dto';
@Controller()
export class RevalidationController {
  constructor(private readonly svc: RevalidationService) {}
  @Get('revalidation/tasks/map')
  listTasksInBbox(
    @Query('min_lat') minLat?: string, @Query('min_lon') minLon?: string,
    @Query('max_lat') maxLat?: string, @Query('max_lon') maxLon?: string,
    @Query('status') status?: string, @Query('priority') priority?: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
  ) {
    const min_lat = minLat != null ? parseFloat(minLat) : NaN;
    const min_lon = minLon != null ? parseFloat(minLon) : NaN;
    const max_lat = maxLat != null ? parseFloat(maxLat) : NaN;
    const max_lon = maxLon != null ? parseFloat(maxLon) : NaN;
    if ([min_lat, min_lon, max_lat, max_lon].some(v => Number.isNaN(v))) throw new BadRequestException('min_lat, min_lon, max_lat, max_lon are required and must be numbers');
    if (min_lat < -90 || max_lat > 90 || min_lon < -180 || max_lon > 180) throw new BadRequestException('bbox out of range');
    const p = page ? parseInt(page, 10) : 1, ps = pageSize ? parseInt(pageSize, 10) : 20;
    return this.svc.listTasksInBbox({ minLat: min_lat, minLon: min_lon, maxLat: max_lat, maxLon: max_lon, status, priority, page: Number.isNaN(p) ? 1 : p, pageSize: Number.isNaN(ps) ? 20 : ps });
  }
  @Get('revalidation/tasks')
  listTasks(@Query('page') page?: string, @Query('pageSize') ps?: string, @Query('status') status?: string, @Query('sort') sort?: string) {
    const p = page ? parseInt(page, 10) : 1, n = ps ? parseInt(ps, 10) : 20;
    return this.svc.listTasks(Number.isNaN(p) ? 1 : p, Number.isNaN(n) ? 20 : n, status, sort);
  }
  @Get('revalidation/tasks/:taskId')
  getTask(@Param('taskId', ParseUUIDPipe) taskId: string) { return this.svc.getTask(taskId); }
  @Get('revalidation/tasks/:taskId/evidences')
  listEvidences(@Param('taskId', ParseUUIDPipe) taskId: string) { return this.svc.listEvidencesForTask(taskId); }
  @Post('revalidation/tasks/:taskId/evidence')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  @Roles('SURVEYOR', 'ADMIN')
  submitEvidence(@Param('taskId', ParseUUIDPipe) taskId: string, @CurrentUser() user: any, @Body() dto: SubmitEvidenceDto, @UploadedFile() file?: Express.Multer.File) { return this.svc.submitEvidence(taskId, user.id, dto, file); }
  @Post('revalidation/tasks/:taskId/finalize')
  @Roles('STAFF', 'ADMIN')
  finalizeTask(@Param('taskId', ParseUUIDPipe) taskId: string, @CurrentUser() user: any) { return this.svc.finalizeTask(taskId, user.id); }
  @Post('revalidation/evidence/:evidenceId/vote')
  @Roles('REVIEWER', 'ADMIN')
  vote(@Param('evidenceId', ParseUUIDPipe) evidenceId: string, @CurrentUser() user: any, @Body() dto: EvidenceVoteDto) { return this.svc.voteOnEvidence(evidenceId, user.id, dto); }
  @Get('revalidation/evidence/:evidenceId/decisions')
  listDecisions(@Param('evidenceId', ParseUUIDPipe) evidenceId: string) { return this.svc.listDecisions(evidenceId); }
}