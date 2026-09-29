import {
  Controller,
  Get,
  Post,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
  Body,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DailyTasksService } from './daily-tasks.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { InternalTokenGuard } from '../../common/guards/internal-token.guard';

@ApiTags('Daily Tasks')
@Controller('daily-tasks')
export class DailyTasksController {
  constructor(private readonly dailyTasksService: DailyTasksService) {}

  /** GET /api/v1/daily-tasks – list active tasks with user progress */
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List daily tasks with progress',
    description: 'Retrieve daily contributor challenges with live progress and claimability indicators',
  })
  @Get()
  async list(@CurrentUser() user?: any) {
    if (user?.id) {
      return this.dailyTasksService.listTasksWithProgress(user.id);
    }
    return this.dailyTasksService.listActive();
  }

  /** GET /api/v1/daily-tasks/completions/me?date=YYYY-MM-DD */
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get my task completions',
    description: 'Check task completion progress and claimable status for a given date',
  })
  @Get('completions/me')
  async myCompletions(@CurrentUser() user: any, @Query('date') date?: string) {
    return this.dailyTasksService.listCompletions(user.id, date);
  }

  /** POST /api/v1/daily-tasks/:id/claim */
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Claim daily task reward',
    description: 'Claim credit rewards for an accomplished daily challenge with distributed mutex protection',
  })
  @Post(':id/claim')
  async claim(@CurrentUser() user: any, @Param('id', ParseIntPipe) id: number) {
    return this.dailyTasksService.claim(user.id, id);
  }

  /** POST /api/v1/daily-tasks/internal/rollover – worker callback at midnight UTC */
  @Public()
  @UseGuards(InternalTokenGuard)
  @ApiOperation({
    summary: 'Internal midnight UTC rollover',
    description: 'Worker trigger to archive or log unclaimed tasks from the previous UTC day',
  })
  @Post('internal/rollover')
  async rollover(@Body() body?: { date?: string }) {
    return this.dailyTasksService.rolloverUnclaimedTasks(body?.date);
  }
}
