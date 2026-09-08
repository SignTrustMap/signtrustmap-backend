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
import { CreateSubmissionDto } from './dto/create-submission.dto';
import { UpdateSubmissionDto } from './dto/update-submission.dto';
import { UpdateSubmissionStatusDto } from './dto/update-submission-status.dto';

@ApiTags('Survey Submissions')
@Controller('submissions')
export class SurveyController {
  constructor(private readonly surveyService: SurveyService) {}

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
