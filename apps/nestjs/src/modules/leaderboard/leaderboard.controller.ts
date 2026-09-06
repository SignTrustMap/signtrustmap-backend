import { Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { LeaderboardService } from './leaderboard.service';

@ApiTags('Leaderboard')
@Controller('leaderboard')
export class LeaderboardController {
  constructor(private readonly svc: LeaderboardService) {}

  @ApiOperation({ summary: 'Get contributor leaderboard', description: 'Retrieve ranked list of top contributors sorted by verified signs and review accuracy' })
  @Get()
  getLeaderboard(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const p = page ? parseInt(page, 10) : 1;
    const ps = pageSize ? parseInt(pageSize, 10) : 20;
    return this.svc.getLeaderboard(Number.isNaN(p) ? 1 : p, Number.isNaN(ps) ? 20 : ps);
  }

  @ApiBearerAuth()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Refresh leaderboard cache', description: 'Admin operation to refresh materialized contributor rankings view' })
  @Post('refresh')
  refresh() {
    return this.svc.refreshMaterializedView();
  }
}
