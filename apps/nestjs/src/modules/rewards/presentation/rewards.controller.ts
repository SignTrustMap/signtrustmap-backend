import { Controller, Get, Post, Put, Patch, Body, Param, ParseIntPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RewardEngineService } from '../application/reward-engine.service';
import { CreateRewardRuleDto, UpdateRewardRuleDto } from './dto/reward-rule.dto';

@ApiTags('Admin Rewards')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin/rewards')
export class RewardsController {
  constructor(private readonly rewardEngine: RewardEngineService) {}

  @ApiOperation({ summary: 'List dynamic reward rules', description: 'Retrieve all configured reward rules with payout amounts and daily contribution limits' })
  @Get('rules')
  async listRules() {
    return this.rewardEngine.listRules();
  }

  @ApiOperation({ summary: 'Get reward rule by ID', description: 'Retrieve specific reward rule details' })
  @Get('rules/:id')
  async getRule(@Param('id', ParseIntPipe) id: number) {
    return this.rewardEngine.getRule(id);
  }

  @ApiOperation({ summary: 'Create reward rule', description: 'Configure a new dynamic reward rule for a gamification activity' })
  @Post('rules')
  async createRule(@Body() dto: CreateRewardRuleDto) {
    return this.rewardEngine.createRule(dto);
  }

  @ApiOperation({ summary: 'Update reward rule', description: 'Modify payout amount, daily caps, or multipliers for an existing rule' })
  @Put('rules/:id')
  async updateRule(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRewardRuleDto) {
    return this.rewardEngine.updateRule(id, dto);
  }

  @ApiOperation({ summary: 'Toggle reward rule active state', description: 'Enable or disable a reward rule at runtime' })
  @Patch('rules/:id/toggle')
  async toggleRule(@Param('id', ParseIntPipe) id: number) {
    return this.rewardEngine.toggleRule(id);
  }
}
