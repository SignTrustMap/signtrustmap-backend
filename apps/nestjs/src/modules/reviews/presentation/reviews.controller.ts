import { Controller, Body, Param, ParseUUIDPipe, Post, Query, Get, Patch, Delete, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { ReviewsService } from '../application/reviews.service';
import { VoteDto, ReportDto } from './dto/vote.dto';
import { InternalTokenGuard } from '../../../common/guards/internal-token.guard';

@ApiTags('Reviews')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

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
  @ApiOperation({ summary: 'Mark sign as unidentifiable', description: 'Skip candidate and mark as cannot identify when sign is obscured or ambiguous' })
  @Post('candidates/:candidateId/can-not-identify')
  async canNotIdentify(@CurrentUser() user: any, @Param('candidateId', ParseUUIDPipe) candidateId: string, @Body() body?: { note?: string }) {
    return this.reviewsService.canNotIdentify(user.id, candidateId, body?.note);
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
  ) {
    const p = page ? parseInt(page, 10) : 1;
    const ps = pageSize ? parseInt(pageSize, 10) : 20;
    return this.reviewsService.queue(user.id, Number.isNaN(p) ? 1 : p, Number.isNaN(ps) ? 20 : ps);
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
