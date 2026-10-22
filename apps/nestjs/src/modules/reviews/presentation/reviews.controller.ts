import { Controller, Body, Param, ParseUUIDPipe, Post, Query, Get, Patch, Delete, UseGuards, UseInterceptors, UploadedFiles } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ReviewsService } from '../application/reviews.service';
import { VoteDto, ReportDto, TestReviewDto, TestAssignDto, RequestRecaptureDto, SubmitRecaptureDto, SelectSignRemedyDto } from './dto/vote.dto';
import { InternalTokenGuard } from '../../../common/guards/internal-token.guard';

@ApiTags('Reviews')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get AI sign replacement suggestions',
    description: 'Return up to five AI-ranked traffic sign types that may replace the candidate label',
  })
  @Get('candidates/:candidateId/sign-remedies')
  getSignRemedies(@Param('candidateId', ParseUUIDPipe) candidateId: string) {
    return this.reviewsService.getSignRemedies(candidateId);
  }

  @ApiBearerAuth()
  @Roles('REVIEWER', 'ADMIN', 'STAFF')
  @ApiOperation({ summary: 'Select an AI sign replacement suggestion', description: 'Persist the active AI top-five suggestion selected by the reviewer for this candidate' })
  @Post('candidates/:candidateId/sign-remedies/select')
  selectSignRemedy(
    @CurrentUser() user: any,
    @Param('candidateId', ParseUUIDPipe) candidateId: string,
    @Body() dto: SelectSignRemedyDto,
  ) {
    return this.reviewsService.selectSignRemedy(user.id, candidateId, dto);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get my review history', description: 'Paginated list of previous sign reviews and consensus verdicts submitted by current reviewer' })
  @Get('me/history')
  async myHistory(
    @CurrentUser() user: any,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('surveyorId') surveyorId?: string,
  ) {
    const p = page ? parseInt(page, 10) : 1;
    const ps = pageSize ? parseInt(pageSize, 10) : 20;
    return this.reviewsService.getMyHistory(user.id, Number.isNaN(p) ? 1 : p, Number.isNaN(ps) ? 20 : ps, status, search, surveyorId);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get reviewer statistics', description: 'Review accuracy rate, total votes cast, and consensus agreement score' })
  @Get('me/stats')
  async myStats(@CurrentUser() user: any) {
    return this.reviewsService.getMyStats(user.id);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get reviewer governance statistics', description: 'Reviewer reliability score, correct/false votes, provisional status, and suspension flag' })
  @Get('stats')
  async stats(@CurrentUser() user: any) {
    return this.reviewsService.getMyStats(user.id);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get candidate sign detail', description: 'Retrieve crop image, AI confidence, and sign classification for review' })
  @Get('candidates/:candidateId')
  async getCandidate(@Param('candidateId', ParseUUIDPipe) candidateId: string) {
    return this.reviewsService.getCandidateDetail(candidateId);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Report candidate sign', description: 'Flag a candidate sign for spam, inappropriate content, or poor image quality' })
  @Post('candidates/:candidateId/report')
  async report(@CurrentUser() user: any, @Param('candidateId', ParseUUIDPipe) candidateId: string, @Body() dto: ReportDto) {
    return this.reviewsService.reportCandidate(user.id, candidateId, dto);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Skip candidate sign', description: 'Skip a difficult or ambiguous candidate without voting, temporarily removing it from queue' })
  @Post('candidates/:candidateId/skip')
  async skipCandidate(@CurrentUser() user: any, @Param('candidateId', ParseUUIDPipe) candidateId: string) {
    return this.reviewsService.skipCandidate(user.id, candidateId);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mark sign as unidentifiable', description: 'Skip candidate and mark as cannot identify when sign is obscured or ambiguous' })
  @Post('candidates/:candidateId/can-not-identify')
  async canNotIdentify(@CurrentUser() user: any, @Param('candidateId', ParseUUIDPipe) candidateId: string, @Body() body?: { note?: string }) {
    return this.reviewsService.canNotIdentify(user.id, candidateId, body?.note);
  }

  @ApiBearerAuth()
  @Roles('REVIEWER', 'ADMIN', 'STAFF')
  @ApiOperation({
    summary: 'Request image recapture from surveyor',
    description: 'Reviewer or Admin requests original surveyor to capture a clearer image because the existing image is too hard to verify (e.g. blurry, poor lighting, obscured, bad angle)',
  })
  @Post('candidates/:candidateId/request-recapture')
  async requestRecapture(
    @CurrentUser() user: any,
    @Param('candidateId', ParseUUIDPipe) candidateId: string,
    @Body() dto: RequestRecaptureDto,
  ) {
    const allowSelf = user?.role === 'ADMIN';
    return this.reviewsService.requestRecapture(user.id, candidateId, dto, allowSelf);
  }

  @ApiBearerAuth()
  @Roles('SURVEYOR', 'ADMIN')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Submit surveyor recapture evidence', description: 'Upload replacement sign crop and best-frame evidence for an assigned recapture request' })
  @Post('candidates/:candidateId/recapture')
  @UseInterceptors(FileFieldsInterceptor([
    { name: 'signCrop', maxCount: 1 },
    { name: 'bestFrame', maxCount: 1 },
  ], { limits: { fileSize: 50 * 1024 * 1024 } }))
  async submitRecapture(
    @CurrentUser() user: any,
    @Param('candidateId', ParseUUIDPipe) candidateId: string,
    @Body() dto: SubmitRecaptureDto,
    @UploadedFiles() files: { signCrop?: Express.Multer.File[]; bestFrame?: Express.Multer.File[] },
  ) {
    return this.reviewsService.submitRecapture(user.id, candidateId, dto, files);
  }

  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get recapture requests for candidate',
    description: 'Retrieve history of recapture requests and reviewer feedback submitted for this candidate sign',
  })
  @Get('candidates/:candidateId/recaptures')
  async getCandidateRecaptures(
    @Param('candidateId', ParseUUIDPipe) candidateId: string,
  ) {
    return this.reviewsService.getRecapturesForCandidate(candidateId);
  }

  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get my pending recapture requests as surveyor',
    description: 'List sign candidates where reviewers or admins have requested the current user to recapture clearer images',
  })
  @Get('me/recaptures')
  async getMyRecaptures(
    @CurrentUser() user: any,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const p = page ? parseInt(page, 10) : 1;
    const ps = pageSize ? parseInt(pageSize, 10) : 20;
    return this.reviewsService.getMyRecaptures(user.id, Number.isNaN(p) ? 1 : p, Number.isNaN(ps) ? 20 : ps);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Undo vote on candidate', description: 'Retract a previously cast vote on an unresolved candidate sign' })
  @Delete(':candidateId/vote')
  async undoVote(@CurrentUser() user: any, @Param('candidateId', ParseUUIDPipe) candidateId: string) {
    return this.reviewsService.undoVote(user.id, candidateId);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get review queue', description: 'Fetch prioritized list of candidate traffic signs awaiting community peer review' })
  @Get('queue')
  async queue(
    @CurrentUser() user: any,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('includeOwnSubmissions') includeOwnSubmissions?: string,
  ) {
    const p = page ? parseInt(page, 10) : 1;
    const ps = pageSize ? parseInt(pageSize, 10) : 20;
    const allowSelf = includeOwnSubmissions === 'true' || includeOwnSubmissions === '1';
    return this.reviewsService.queue(user.id, Number.isNaN(p) ? 1 : p, Number.isNaN(ps) ? 20 : ps, allowSelf);
  }

  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Test review candidate sign (Testing/Development)',
    description: 'Submit review for a candidate with 1 specific reviewer and immediately evaluate consensus. Bypasses surveyor check.',
  })
  @Post('test-review')
  async testReview(@CurrentUser() user: any, @Body() dto: TestReviewDto) {
    const targetReviewerId = dto.reviewerId || user.id;
    return this.reviewsService.testReviewCandidate(dto.candidateId, targetReviewerId, {
      vote: dto.vote,
      suggestedSignTypeId: dto.suggestedSignTypeId,
      declineReason: dto.declineReason,
      declineNote: dto.declineNote,
    });
  }

  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Direct/Assign candidates to 1 specific reviewer for testing',
    description: 'Clear previous skipped/reviewed flags or prepare pending candidates for a specific reviewer queue',
  })
  @Post('test-assign')
  async testAssign(@CurrentUser() user: any, @Body() dto: TestAssignDto) {
    const targetReviewerId = dto.reviewerId || user.id;
    return this.reviewsService.directCandidatesToReviewer(targetReviewerId, dto.candidateIds);
  }

  // -- Flow 14: Active Learning orchestration hooks (internal) --
  // Backend dev provides the shell; AI teammate calls these after scoring candidates.
  // Single-candidate: PATCH /reviews/internal/:candidateId/active-learning-priority
  // Bulk: POST /reviews/internal/active-learning-priorities  { items: [{candidateId, priority}, ...] }
  // List unscored: GET /reviews/internal/unscored-candidates?limit=50

  @Public()
  @UseGuards(InternalTokenGuard)
  @ApiOperation({ summary: 'Internal list unscored candidates', description: 'Fetch candidates without active learning uncertainty scores' })
  @Get('internal/unscored-candidates')
  async getUnscored(@Query('limit') limit?: string) {
    const n = limit ? parseInt(limit, 10) : 50;
    return this.reviewsService.getUnscoredCandidates(Number.isNaN(n) ? 50 : n);
  }

  @Public()
  @UseGuards(InternalTokenGuard)
  @ApiOperation({ summary: 'Internal set active learning priority', description: 'Update review queue priority based on AI model uncertainty score' })
  @Patch('internal/:candidateId/active-learning-priority')
  async setPriority(@Param('candidateId', ParseUUIDPipe) candidateId: string, @Body() body: { priority: number }) {
    return this.reviewsService.setActiveLearningPriority(candidateId, body.priority);
  }

  @Public()
  @UseGuards(InternalTokenGuard)
  @ApiOperation({ summary: 'Internal set bulk active learning priorities', description: 'Batch update review queue priorities from AI service' })
  @Post('internal/active-learning-priorities')
  async setBulkPriorities(@Body() body: { items: Array<{ candidateId: string; priority: number }> }) {
    return this.reviewsService.setBulkActiveLearningPriorities(body.items);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cast vote on candidate sign', description: 'Submit confirmation or correction vote for a traffic sign candidate' })
  @Post(':candidateId/vote')
  async vote(@CurrentUser() user: any, @Param('candidateId', ParseUUIDPipe) candidateId: string, @Body() dto: VoteDto) {
    return this.reviewsService.vote(user.id, candidateId, dto);
  }
}
