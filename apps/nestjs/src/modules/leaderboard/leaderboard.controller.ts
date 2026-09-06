import { Controller, Get, Post, Query } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { LeaderboardService } from './leaderboard.service';

@Controller('leaderboard')
export class LeaderboardController {
  constructor(private readonly svc: LeaderboardService) {}

  @Get()
  getLeaderboard(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const p = page ? parseInt(page, 10) : 1;
    const ps = pageSize ? parseInt(pageSize, 10) : 20;
    return this.svc.getLeaderboard(Number.isNaN(p) ? 1 : p, Number.isNaN(ps) ? 20 : ps);
  }

  @Roles('ADMIN')
  @Post('refresh')
  refresh() {
    return this.svc.refreshMaterializedView();
  }
}
