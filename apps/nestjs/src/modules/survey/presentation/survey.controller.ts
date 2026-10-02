import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Patch, UseGuards } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { SurveyService } from '../application/survey.service';
import { InitializeUploadDto } from './dto/initialize-upload.dto';
import { UploadChunkBodyDto } from './dto/upload-chunk.dto';
import { InternalTokenGuard } from '../../../common/guards/internal-token.guard';
import { UseInterceptors, UploadedFile } from '@nestjs/common';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CreateSubmissionDto } from './dto/create-submission.dto';
import { UpdateSubmissionDto } from './dto/update-submission.dto';
import { UpdateSubmissionStatusDto } from './dto/update-submission-status.dto';
import { CreateFrameBatchSessionDto } from './dto/create-frame-batch.dto';
import { CreateBatchSurveyDto } from './dto/create-batch-survey.dto';
import { CreatePresignedUrlDto } from './dto/create-presigned-url.dto';
import { BatchSurveyService } from '../application/batch-survey.service';

@ApiTags('Survey Submissions')
@Roles('SURVEYOR', 'ADMIN')
@Controller('submissions')
export class SurveyController {
  constructor(
    private readonly surveyService: SurveyService,
    private readonly batchService: BatchSurveyService,
  ) {}

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create multi-image batch survey', description: 'Submit an asynchronous batch of multiple geo-tagged images for candidate extraction' })
  @Post('batch')
  async createBatch(@CurrentUser() user: any, @Body() dto: CreateBatchSurveyDto) {
    return this.batchService.createBatch(user.id, dto);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get batch survey status', description: 'Retrieve processing progress and candidate-gated reward status of a batch submission' })
  @Get('batch/:batchId')
  async getBatch(@CurrentUser() user: any, @Param('batchId', ParseUUIDPipe) batchId: string) {
    return this.batchService.getBatch(user.id, batchId);
  }

  @Public()
  @UseGuards(InternalTokenGuard)
  @ApiOperation({ summary: 'Internal complete batch survey processing', description: 'Worker callback to report batch candidate extraction and trigger reward settlement' })
  @Post('internal/batch/:batchId/complete')
  async completeBatch(
    @Param('batchId', ParseUUIDPipe) batchId: string,
    @Body() body: { extractedCandidates: number; totalProcessed?: number; note?: string },
  ) {
    return this.batchService.completeBatch(batchId, body);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create frame batch survey session', description: 'Submit reduced FPS sampled frames with GPS telemetry and camera calibration metadata in a single session' })
  @Post('sessions')
  async createFrameBatchSession(@CurrentUser() user: any, @Body() dto: CreateFrameBatchSessionDto) {
    return this.surveyService.createFrameBatchSession(user.id, dto);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create submission draft', description: 'Define submission metadata and required media before starting uploads' })
  @Post()
  async createSubmission(@CurrentUser() user: any, @Body() dto: CreateSubmissionDto) {
    return this.surveyService.createSubmission(user.id, dto);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update submission draft', description: 'Correct capture time, coordinate source, or note before resubmitting' })
  @Patch(':submissionId')
  async updateSubmission(@CurrentUser() user: any, @Param('submissionId', ParseUUIDPipe) submissionId: string, @Body() dto: UpdateSubmissionDto) {
    return this.surveyService.updateSubmission(user.id, submissionId, dto);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Initialize media upload', description: 'Attach a chunked media upload session to an existing submission draft' })
  @Post(':submissionId/uploads')
  async initialize(@CurrentUser() user: any, @Param('submissionId', ParseUUIDPipe) submissionId: string, @Body() dto: InitializeUploadDto) {
    return this.surveyService.initialize(user.id, submissionId, dto);
  }

  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Generate S3 direct presigned PUT URL',
    description: 'Generates a signed direct-to-S3 upload URL for high-bandwidth dashcam videos or GPX traces',
  })
  @Post(':submissionId/uploads/presigned-url')
  async getPresignedUploadUrl(
    @CurrentUser() user: any,
    @Param('submissionId', ParseUUIDPipe) submissionId: string,
    @Body() dto: CreatePresignedUrlDto,
  ) {
    return this.surveyService.generatePresignedUploadUrl(user.id, submissionId, dto);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Upload video chunk', description: 'Upload a binary dashcam video chunk file for an active survey session' })
  @ApiConsumes('multipart/form-data')
  @Post('uploads/:sessionId/chunks')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  async uploadChunk(@CurrentUser() user: any, @Param('sessionId', ParseUUIDPipe) sessionId: string, @Body() body: UploadChunkBodyDto, @UploadedFile() file: Express.Multer.File) { return this.surveyService.uploadChunk(user.id, sessionId, body, file); }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Complete media upload', description: 'Assemble uploaded chunks and attach the resulting media file to its submission' })
  @Post('uploads/:sessionId/complete')
  async completeUpload(@CurrentUser() user: any, @Param('sessionId', ParseUUIDPipe) sessionId: string) { return this.surveyService.completeUpload(user.id, sessionId); }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Submit draft for processing', description: 'Validate required media and metadata, then queue or request correction' })
  @Post(':submissionId/submit')
  @HttpCode(200)
  async submitSubmission(@CurrentUser() user: any, @Param('submissionId', ParseUUIDPipe) submissionId: string) {
    return this.surveyService.submitSubmission(user.id, submissionId);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'List my submissions', description: 'Paginated list of historical video submissions uploaded by current surveyor' })
  @Get('me')
  async listMySubmissions(@CurrentUser() user: any, @Query('page') page?: string, @Query('pageSize') ps?: string) {
    const p = page ? parseInt(page, 10) : 1; const n = ps ? parseInt(ps, 10) : 20;
    return this.surveyService.getMySubmissions(user.id, Number.isNaN(p) ? 1 : p, Number.isNaN(n) ? 20 : n);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get count of pending submissions', description: 'Number of user submissions currently in processing or awaiting review' })
  @Get('me/pending')
  async myPending(@CurrentUser() user: any) {
    return this.surveyService.getMyPendingCount(user.id);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get surveyor statistics', description: 'Contributor stats including total videos, approved signs, and earned credits' })
  @Get('me/stats')
  async myStats(@CurrentUser() user: any) {
    return this.surveyService.getMyStats(user.id);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get submission pipeline status', description: 'Live status and stage progress of video AI processing pipeline' })
  @Get('status/:submissionId')
  async getSubmissionStatus(@CurrentUser() user: any, @Param('submissionId', ParseUUIDPipe) submissionId: string) {
    return this.surveyService.getSubmissionStatus(user.id, submissionId);
  }

  @Public()
  @UseGuards(InternalTokenGuard)
  @ApiOperation({ summary: 'Internal mark submission completed', description: 'AI worker callback to mark pipeline processing as complete' })
  @Post('internal/:submissionId/complete')
  async markCompleted(@Param('submissionId', ParseUUIDPipe) submissionId: string, @Body() body?: { note?: string }) { return this.surveyService.markCompleted(submissionId, body?.note); }

  @Public()
  @UseGuards(InternalTokenGuard)
  @ApiOperation({ summary: 'Internal advance submission status', description: 'AI pipeline step transition (SYNCHRONIZING, DETECTING, TRACKING, etc.)' })
  @Patch('internal/:submissionId/status')
  async advanceStatus(@Param('submissionId', ParseUUIDPipe) submissionId: string, @Body() body: UpdateSubmissionStatusDto) {
    return this.surveyService.advanceSubmissionStatus(
      submissionId,
      body.status,
      body.note,
      body.validationErrors,
      body.correctionRequirements,
    );
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get survey upload session details', description: 'Retrieve metadata and chunk progress for an active upload session' })
  @Get('uploads/:sessionId')
  async getSession(@CurrentUser() user: any, @Param('sessionId', ParseUUIDPipe) sessionId: string) { return this.surveyService.getSession(user.id, sessionId); }
}
