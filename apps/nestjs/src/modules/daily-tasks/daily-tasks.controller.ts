import { Controller, Get, Post, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DailyTasksService } from './daily-tasks.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Daily Tasks')
@Controller('daily-tasks')
export class DailyTasksController {
  constructor(private readonly dailyTasksService: DailyTasksService) {}

  /** GET /api/v1/daily-tasks – list active tasks */
  @ApiOperation({ summary: 'List active daily tasks', description: 'Retrieve all available daily contributor tasks, quotas, and credit rewards' })
  @Get()
  async list() {
    return this.dailyTasksService.listActive();
  }

  /** GET /api/v1/daily-tasks/completions/me?date=YYYY-MM-DD */
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get my task completions', description: 'Check task completion progress and claimable status for a given date' })
  @Get('completions/me')
  async myCompletions(@CurrentUser() user: any, @Query('date') date?: string) {
    return this.dailyTasksService.listCompletions(user.id, date);
  }

  /** POST /api/v1/daily-tasks/:id/claim */
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Claim task reward', description: 'Claim credit rewards for an accomplished daily challenge' })
  @Post(':id/claim')
  async claim(@CurrentUser() user: any, @Param('id', ParseIntPipe) id: number) {
    return this.dailyTasksService.claim(user.id, id);
  }
}
