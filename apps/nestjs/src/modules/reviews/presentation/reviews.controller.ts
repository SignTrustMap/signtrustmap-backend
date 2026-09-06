import { Controller, Body, Param, ParseUUIDPipe, Post, Query, Get, Patch, Delete, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { ReviewsService } from '../application/reviews.service';
import { VoteDto, ReportDto } from './dto/vote.dto';
import { InternalTokenGuard } from '../../../common/guards/internal-token.guard';

@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

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

  @Get('me/stats')
  async myStats(@CurrentUser() user: any) {
    return this.reviewsService.getMyStats(user.id);
  }

  @Get('candidates/:candidateId')
  async getCandidate(@Param('candidateId', ParseUUIDPipe) candidateId: string) {
    return this.reviewsService.getCandidateDetail(candidateId);
  }

  @Post('candidates/:candidateId/report')
  async report(@CurrentUser() user: any, @Param('candidateId', ParseUUIDPipe) candidateId: string, @Body() dto: ReportDto) {
    return this.reviewsService.reportCandidate(user.id, candidateId, dto);
  }

  @Post('candidates/:candidateId/can-not-identify')
  async canNotIdentify(@CurrentUser() user: any, @Param('candidateId', ParseUUIDPipe) candidateId: string, @Body() body?: { note?: string }) {
    return this.reviewsService.canNotIdentify(user.id, candidateId, body?.note);
  }

  @Delete(':candidateId/vote')
  async undoVote(@CurrentUser() user: any, @Param('candidateId', ParseUUIDPipe) candidateId: string) {
    return this.reviewsService.undoVote(user.id, candidateId);
  }

  @Get('queue')
  async queue(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const p = page ? parseInt(page, 10) : 1;
    const ps = pageSize ? parseInt(pageSize, 10) : 20;
    return this.reviewsService.queue(Number.isNaN(p) ? 1 : p, Number.isNaN(ps) ? 20 : ps);
  }
  // -- Flow 14: Active Learning orchestration hooks (internal) --
  // Backend dev provides the shell; AI teammate calls these after scoring candidates.
  // Single-candidate: PATCH /reviews/internal/:candidateId/active-learning-priority
  // Bulk: POST /reviews/internal/active-learning-priorities  { items: [{candidateId, priority}, ...] }
  // List unscored: GET /reviews/internal/unscored-candidates?limit=50
  @Public()
  @UseGuards(InternalTokenGuard)
  @Get('internal/unscored-candidates')
  async getUnscored(@Query('limit') limit?: string) {
    const n = limit ? parseInt(limit, 10) : 50;
    return this.reviewsService.getUnscoredCandidates(Number.isNaN(n) ? 50 : n);
  }
  @Public()
  @UseGuards(InternalTokenGuard)
  @Patch('internal/:candidateId/active-learning-priority')
  async setPriority(@Param('candidateId', ParseUUIDPipe) candidateId: string, @Body() body: { priority: number }) {
    return this.reviewsService.setActiveLearningPriority(candidateId, body.priority);
  }
  @Public()
  @UseGuards(InternalTokenGuard)
  @Post('internal/active-learning-priorities')
  async setBulkPriorities(@Body() body: { items: Array<{ candidateId: string; priority: number }> }) {
    return this.reviewsService.setBulkActiveLearningPriorities(body.items);
  }
  @Post(':candidateId/vote')
  async vote(@CurrentUser() user: any, @Param('candidateId', ParseUUIDPipe) candidateId: string, @Body() dto: VoteDto) {
    return this.reviewsService.vote(user.id, candidateId, dto);
  }
}
