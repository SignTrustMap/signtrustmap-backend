import { Controller, Get, Post, Param, ParseIntPipe, Query } from '@nestjs/common';
import { DailyTasksService } from './daily-tasks.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('daily-tasks')
export class DailyTasksController {
  constructor(private readonly dailyTasksService: DailyTasksService) {}

  /** GET /api/v1/daily-tasks – list active tasks */
  @Get()
  async list() {
    return this.dailyTasksService.listActive();
  }

  /** GET /api/v1/daily-tasks/completions/me?date=YYYY-MM-DD */
  @Get('completions/me')
  async myCompletions(@CurrentUser() user: any, @Query('date') date?: string) {
    return this.dailyTasksService.listCompletions(user.id, date);
  }

  /** POST /api/v1/daily-tasks/:id/claim */
  @Post(':id/claim')
  async claim(@CurrentUser() user: any, @Param('id', ParseIntPipe) id: number) {
    return this.dailyTasksService.claim(user.id, id);
  }
}
