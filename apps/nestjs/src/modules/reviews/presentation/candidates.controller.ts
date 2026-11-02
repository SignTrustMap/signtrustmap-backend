import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ReviewsService } from '../application/reviews.service';
import { ReviewerCandidatesQueryDto } from './dto/vote.dto';

@ApiTags('Candidates')
@Controller('candidates')
export class CandidatesController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get candidates for reviewers / staff',
    description:
      'Paginated list of candidates reviewed by the reviewer, filterable and sortable by the 4 status tags: all, unprocessed (Chưa xử lý), in_review (Đang xem xét), reviewed (Đã giải quyết)',
  })
  @Get()
  async getCandidates(
    @CurrentUser() user: any,
    @Query() query?: ReviewerCandidatesQueryDto,
  ) {
    const targetReviewerId =
      (user?.role === 'ADMIN' || user?.role === 'STAFF') && query?.reviewerId
        ? query.reviewerId
        : user?.id;

    const p = query?.page ? parseInt(String(query.page), 10) : 1;
    const ps = query?.pageSize ? parseInt(String(query.pageSize), 10) : 20;
    const status = query?.status || query?.tag;
    const sortBy = query?.sortBy || 'reviewedAt';
    const sortOrder = (query?.sortOrder?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC') as 'ASC' | 'DESC';

    return this.reviewsService.getReviewedCandidates(
      targetReviewerId,
      Number.isNaN(p) ? 1 : p,
      Number.isNaN(ps) ? 20 : ps,
      status,
      query?.search,
      query?.surveyorId,
      sortBy,
      sortOrder,
    );
  }
}

