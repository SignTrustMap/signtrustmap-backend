import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { BountyBoardService } from '../application/bounty-board.service';
import {
  ClaimQuestDto,
  QueryAvailableQuestsDto,
  AbandonQuestDto,
} from './dto/bounty-board.dto';

@ApiTags('Reviewer Bounty Board')
@ApiBearerAuth()
@Controller('reviews/bounty-board')
export class BountyBoardController {
  constructor(private readonly bountyService: BountyBoardService) {}

  @ApiOperation({
    summary: 'List available on-site verification bounty quests',
    description: 'Returns pending traffic sign candidates and open revalidation tasks within spatial proximity eligible for claiming.',
  })
  @ApiResponse({ status: 200, description: 'Available quests list' })
  @Get('available')
  async getAvailableQuests(
    @CurrentUser() user: any,
    @Query() query: QueryAvailableQuestsDto,
  ) {
    return this.bountyService.getAvailableQuests(user.id, query);
  }

  @ApiOperation({
    summary: 'List current user quest claims',
    description: 'Returns active and past bounty quest claims for the authenticated reviewer.',
  })
  @ApiResponse({ status: 200, description: 'User quest claims' })
  @Get('my-claims')
  async getMyClaims(@CurrentUser() user: any) {
    return this.bountyService.getMyClaims(user.id);
  }

  @ApiOperation({
    summary: 'Claim an on-site verification quest',
    description: 'Reserves an unverified sign candidate or revalidation task for physical verification with a deadline timer.',
  })
  @ApiResponse({ status: 201, description: 'Quest claimed successfully' })
  @ApiResponse({ status: 400, description: 'Claim limit reached or invalid target' })
  @ApiResponse({ status: 403, description: 'User review privileges suspended' })
  @ApiResponse({ status: 409, description: 'Target already claimed by another reviewer' })
  @Post('claim')
  async claimQuest(
    @CurrentUser() user: any,
    @Body() dto: ClaimQuestDto,
  ) {
    return this.bountyService.claimQuest(user.id, dto);
  }

  @ApiOperation({
    summary: 'Abandon an active quest claim',
    description: 'Releases a claimed quest back to the available pool without immediate reputation penalty.',
  })
  @ApiParam({ name: 'claimId', description: 'Quest claim UUID', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Quest abandoned' })
  @Post(':claimId/abandon')
  async abandonQuest(
    @CurrentUser() user: any,
    @Param('claimId') claimId: string,
    @Body() dto: AbandonQuestDto,
  ) {
    return this.bountyService.abandonQuest(user.id, claimId, dto.reason);
  }

  @ApiOperation({
    summary: 'Expire stale uncompleted claims and apply penalties',
    description: 'Scans for expired claimed quests, marks them EXPIRED, and applies reputation deduction to the claiming reviewer.',
  })
  @ApiResponse({ status: 200, description: 'Expired claims count' })
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  @Post('expire-stale-claims')
  async expireStaleClaims() {
    return this.bountyService.expireStaleClaims();
  }
}
