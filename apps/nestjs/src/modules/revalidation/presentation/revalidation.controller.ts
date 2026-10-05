import { Controller, Get, Post, Body, Param, Query, ParseUUIDPipe, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RevalidationService } from '../application/revalidation.service';
import { SubmitEvidenceDto, EvidenceVoteDto } from './dto/revalidation.dto';

@ApiTags('Revalidation')
@Controller()
export class RevalidationController {
  constructor(private readonly svc: RevalidationService) {}

  @ApiOperation({ summary: 'List revalidation tasks in bounding box', description: 'Retrieve active on-site verification tasks inside a map bounding box' })
  @Get('revalidation/tasks/map')
  listTasksInBbox(
    @Query('min_lat') minLat?: string, @Query('min_lon') minLon?: string,
    @Query('max_lat') maxLat?: string, @Query('max_lon') maxLon?: string,
    @Query('status') status?: string, @Query('priority') priority?: string,
    @Query('page') page?: string, @Query('pageSize') pageSize?: string,
  ) {
    const anyBbox = minLat != null || minLon != null || maxLat != null || maxLon != null;
    let min_lat: number | undefined;
    let min_lon: number | undefined;
    let max_lat: number | undefined;
    let max_lon: number | undefined;

    if (anyBbox) {
      if (minLat == null || minLon == null || maxLat == null || maxLon == null) {
        throw new BadRequestException('min_lat, min_lon, max_lat, max_lon are required and must be numbers');
      }
      min_lat = parseFloat(minLat);
      min_lon = parseFloat(minLon);
      max_lat = parseFloat(maxLat);
      max_lon = parseFloat(maxLon);
      if ([min_lat, min_lon, max_lat, max_lon].some(v => Number.isNaN(v))) throw new BadRequestException('min_lat, min_lon, max_lat, max_lon must be numbers');
      if (min_lat < -90 || max_lat > 90 || min_lon < -180 || max_lon > 180) throw new BadRequestException('bbox out of range');
    }

    const p = page ? parseInt(page, 10) : 1, ps = pageSize ? parseInt(pageSize, 10) : 20;
    return this.svc.listTasksInBbox({
      minLat: min_lat,
      minLon: min_lon,
      maxLat: max_lat,
      maxLon: max_lon,
      status,
      priority,
      page: Number.isNaN(p) ? 1 : p,
      pageSize: Number.isNaN(ps) ? 20 : ps,
    });
  }

  @ApiOperation({ summary: 'List revalidation tasks', description: 'Paginated list of verification tasks filterable by status, priority, or spatial radius' })
  @Get('revalidation/tasks')
  listTasks(
    @Query('page') page?: string,
    @Query('pageSize') ps?: string,
    @Query('status') status?: string,
    @Query('sort') sort?: string,
    @Query('lat') lat?: string,
    @Query('lon') lon?: string,
    @Query('radiusMeters') radiusMeters?: string,
  ) {
    const p = page ? parseInt(page, 10) : 1, n = ps ? parseInt(ps, 10) : 20;
    const parsedLat = lat != null ? parseFloat(lat) : undefined;
    const parsedLon = lon != null ? parseFloat(lon) : undefined;
    const parsedRadius = radiusMeters != null ? parseFloat(radiusMeters) : 5000;
    const spatial =
      parsedLat != null && parsedLon != null && !Number.isNaN(parsedLat) && !Number.isNaN(parsedLon)
        ? { lat: parsedLat, lon: parsedLon, radiusMeters: Number.isNaN(parsedRadius) ? 5000 : parsedRadius }
        : undefined;

    return this.svc.listTasks(Number.isNaN(p) ? 1 : p, Number.isNaN(n) ? 20 : n, status, sort, spatial);
  }

  @ApiOperation({ summary: 'Get revalidation task detail', description: 'Fetch task coordinates, target sign, and current verification progress' })
  @Get('revalidation/tasks/:taskId')
  getTask(@Param('taskId', ParseUUIDPipe) taskId: string) { return this.svc.getTask(taskId); }

  @ApiOperation({ summary: 'List evidences for task', description: 'Retrieve surveyor evidence submissions and photos for a task' })
  @Get('revalidation/tasks/:taskId/evidences')
  listEvidences(@Param('taskId', ParseUUIDPipe) taskId: string) { return this.svc.listEvidencesForTask(taskId); }

  @ApiBearerAuth()
  @Roles('SURVEYOR', 'ADMIN')
  @ApiOperation({ summary: 'Submit task evidence', description: 'Upload photo evidence and location verification from on-site inspection' })
  @ApiConsumes('multipart/form-data')
  @Post('revalidation/tasks/:taskId/evidence')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  @Roles('SURVEYOR', 'ADMIN')
  submitEvidence(@Param('taskId', ParseUUIDPipe) taskId: string, @CurrentUser() user: any, @Body() dto: SubmitEvidenceDto, @UploadedFile() file?: Express.Multer.File) { return this.svc.submitEvidence(taskId, user.id, dto, file); }

  @ApiBearerAuth()
  @Roles('STAFF', 'ADMIN')
  @ApiOperation({ summary: 'Finalize revalidation task', description: 'Staff/Admin manually finalizes task status and awards bounty credits' })
  @Post('revalidation/tasks/:taskId/finalize')
  @Roles('STAFF', 'ADMIN')
  finalizeTask(@Param('taskId', ParseUUIDPipe) taskId: string, @CurrentUser() user: any) { return this.svc.finalizeTask(taskId, user.id); }

  @ApiBearerAuth()
  @Roles('REVIEWER', 'ADMIN')
  @ApiOperation({ summary: 'Vote on evidence', description: 'Reviewers validate or reject submitted on-site evidence' })
  @Post('revalidation/evidence/:evidenceId/vote')
  @Roles('REVIEWER', 'ADMIN')
  vote(@Param('evidenceId', ParseUUIDPipe) evidenceId: string, @CurrentUser() user: any, @Body() dto: EvidenceVoteDto) { return this.svc.voteOnEvidence(evidenceId, user.id, dto); }

  @ApiBearerAuth()
  @Roles('REVIEWER', 'ADMIN')
  @ApiOperation({ summary: 'Reviewer evidence queue', description: 'Paginated queue of evidence awaiting decision, excluding items the reviewer has already judged' })
  @Get('revalidation/evidence/queue')
  @Roles('REVIEWER', 'ADMIN')
  evidenceQueue(@CurrentUser() user: any, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const p = page ? parseInt(page, 10) : 1, n = pageSize ? parseInt(pageSize, 10) : 20;
    return this.svc.listEvidenceQueue(user.id, Number.isNaN(p) ? 1 : p, Number.isNaN(n) ? 20 : n);
  }

  @ApiOperation({ summary: 'List evidence decisions', description: 'Retrieve history of consensus decisions for a specific evidence item' })
  @Get('revalidation/evidence/:evidenceId/decisions')
  listDecisions(@Param('evidenceId', ParseUUIDPipe) evidenceId: string) { return this.svc.listDecisions(evidenceId); }
}
