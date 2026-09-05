import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Patch, UseGuards, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { SurveyService } from './survey.service';
import { InitializeUploadDto } from './dto/initialize-upload.dto';
import { UploadChunkBodyDto } from './dto/upload-chunk.dto';
import { InternalTokenGuard } from '../../common/guards/internal-token.guard';
import { UseInterceptors, UploadedFile } from '@nestjs/common';
import { SubmissionStatus } from '../../entities/survey-submission.entity';

@Controller('submissions')
export class SurveyController {
  constructor(private readonly surveyService: SurveyService) {}
  @Post('initialize')
  async initialize(@CurrentUser() user: any, @Body() dto: InitializeUploadDto) { return this.surveyService.initialize(user.id, dto); }
  @Post(':sessionId/chunks')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  async uploadChunk(@CurrentUser() user: any, @Param('sessionId', ParseUUIDPipe) sessionId: string, @Body() body: UploadChunkBodyDto, @UploadedFile() file: Express.Multer.File) { return this.surveyService.uploadChunk(user.id, sessionId, body, file); }
  @Get('me')
  async listMySubmissions(@CurrentUser() user: any, @Query('page') page?: string, @Query('pageSize') ps?: string) {
    const p = page ? parseInt(page, 10) : 1; const n = ps ? parseInt(ps, 10) : 20;
    return this.surveyService.getMySubmissions(user.id, Number.isNaN(p) ? 1 : p, Number.isNaN(n) ? 20 : n);
  }
  @Get('me/pending')
  async myPending(@CurrentUser() user: any) {
    return this.surveyService.getMyPendingCount(user.id);
  }
  @Get('me/stats')
  async myStats(@CurrentUser() user: any) {
    return this.surveyService.getMyStats(user.id);
  }
  @Get('status/:submissionId')
  async getSubmissionStatus(@CurrentUser() user: any, @Param('submissionId', ParseUUIDPipe) submissionId: string) {
    return this.surveyService.getSubmissionStatus(user.id, submissionId);
  }
  @Public()
  @UseGuards(InternalTokenGuard)
  @Post('internal/:submissionId/complete')
  async markCompleted(@Param('submissionId', ParseUUIDPipe) submissionId: string, @Body() body?: { note?: string }) { return this.surveyService.markCompleted(submissionId, body?.note); }
  @Public()
  @UseGuards(InternalTokenGuard)
  @Patch('internal/:submissionId/status')
  async advanceStatus(@Param('submissionId', ParseUUIDPipe) submissionId: string, @Body() body: { status: string; note?: string }) {
    const allowed: string[] = ['QUEUED', 'SYNCHRONIZING', 'DETECTING', 'TRACKING', 'ESTIMATING', 'CLASSIFYING', 'COMPLETED', 'PARTIALLY_PROCESSED', 'FAILED', 'PENDING_CORRECTION', 'NO_SIGN_DETECTED'];
    if (!allowed.includes(String(body.status))) throw new BadRequestException('status must be one of ' + allowed.join(', '));
    return this.surveyService.advanceSubmissionStatus(submissionId, body.status as SubmissionStatus, body.note);
  }
  @Get(':sessionId')
  async getSession(@CurrentUser() user: any, @Param('sessionId', ParseUUIDPipe) sessionId: string) { return this.surveyService.getSession(user.id, sessionId); }
}
