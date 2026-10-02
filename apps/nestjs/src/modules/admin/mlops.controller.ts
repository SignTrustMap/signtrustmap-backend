import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminService } from './admin.service';
import { TriggerRetrainDto, ActiveLearningConfigDto } from './dto/admin.dto';

@ApiTags('MLOps Operations')
@ApiBearerAuth()
@Roles('ADMIN', 'STAFF')
@Controller('mlops')
export class MlopsController {
  constructor(private readonly adminService: AdminService) {}

  @ApiOperation({
    summary: 'Get ML Pipeline status',
    description: 'Returns health, active detector/classifier versions, and queue state',
  })
  @Get('pipeline/status')
  getPipelineStatus() {
    return this.adminService.getPipelineStatus();
  }

  @ApiOperation({
    summary: 'List model retraining runs',
    description: 'Returns historical retraining runs matching frontend ModelRetrainingRun schema',
  })
  @Get('retraining-runs')
  async listRetrainingRuns(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const p = page ? parseInt(page, 10) : 1;
    const ps = pageSize ? parseInt(pageSize, 10) : 20;
    const res = await this.adminService.listTrainingJobs({ page: p, pageSize: ps });
    return res.items;
  }

  @ApiOperation({
    summary: 'Trigger manual model retraining run',
    description: 'Queues a retraining run with active learning dataset samples',
  })
  @Post('retraining-runs/trigger')
  triggerRetrainingRun(
    @Body() dto: TriggerRetrainDto,
    @CurrentUser() user: any,
  ) {
    return this.adminService.triggerModelRetraining(dto, user.id);
  }

  @ApiOperation({
    summary: 'Get Active Learning configuration',
    description: 'Retrieves current active learning uncertainty margin and auto-retrain thresholds',
  })
  @Get('active-learning/config')
  getActiveLearningConfig() {
    return this.adminService.getActiveLearningConfig();
  }

  @ApiOperation({
    summary: 'Update Active Learning configuration',
    description: 'Updates active learning hyperparameters with audit logging',
  })
  @Put('active-learning/config')
  updateActiveLearningConfig(
    @Body() dto: ActiveLearningConfigDto,
    @CurrentUser() user: any,
    @Req() req: any,
  ) {
    const ip = req.ip || req.headers['x-forwarded-for'] || null;
    return this.adminService.updateActiveLearningConfig(dto, user.id, ip);
  }
}
