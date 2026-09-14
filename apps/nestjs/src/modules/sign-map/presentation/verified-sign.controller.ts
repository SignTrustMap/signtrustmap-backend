import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RouteSignQueryService } from '../application/route-sign-query.service';
import { RouteSignsRequestDto } from './dto/route-signs.dto';
import { VerifiedSignService } from '../application/verified-sign.service';
import { CreateVerifiedSignDto, UpdateVerifiedSignDto } from './dto/verified-sign.dto';
import { SignBoundsQueryDto } from './dto/sign-bounds.dto';
import { NearbyCandidatesQueryDto } from './dto/nearby-candidates.dto';
import { ConfirmSignDto } from './dto/confirm-sign.dto';

@ApiTags('Sign Map')
@Controller('signs')
export class VerifiedSignController {
  constructor(
    private readonly routeSigns: RouteSignQueryService,
    private readonly verifiedSigns: VerifiedSignService,
  ) {}

  @Public()
  @ApiOperation({ summary: 'Find signs in bounding box', description: 'Query verified traffic signs within specified map viewport coordinates' })
  @Get()
  findInBounds(@Query() query: SignBoundsQueryDto) {
    return this.verifiedSigns.findInBounds(
      query.minLat,
      query.minLon,
      query.maxLat,
      query.maxLon,
      query.limit,
    );
  }

  @Public()
  @ApiOperation({
    summary: 'Find nearby verified sign candidates',
    description: 'Query verified signs near GPS location with distance and optional heading filter',
  })
  @Get('nearby-candidates')
  findNearbyCandidates(@Query() query: NearbyCandidatesQueryDto) {
    return this.verifiedSigns.findNearbyCandidates(
      query.latitude,
      query.longitude,
      query.radiusMeters ?? 20,
      query.headingDegrees,
    );
  }

  @Public()
  @ApiOperation({ summary: 'Find signs along route', description: 'Find verified traffic signs along a planned route geometry with buffer distance' })
  @Post('along-route')
  findAlongRoute(@Body() request: RouteSignsRequestDto) {
    return this.routeSigns.findAlongRoute(request);
  }

  @ApiBearerAuth()
  @Roles('STAFF', 'ADMIN')
  @ApiOperation({ summary: 'Create verified sign', description: 'Staff/Admin manually creates a new verified traffic sign on the map' })
  @Post()
  create(@Body() request: CreateVerifiedSignDto) {
    return this.verifiedSigns.create(request);
  }

  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Confirm sign presence or dispute',
    description: 'Submit driver or surveyor verification confirming or reporting missing a verified sign',
  })
  @Post(':id/confirm')
  confirm(
    @CurrentUser() user: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ConfirmSignDto,
  ) {
    return this.verifiedSigns.confirmSign(user?.id ?? user?.sub, id, body);
  }

  @ApiBearerAuth()
  @Roles('STAFF', 'ADMIN')
  @ApiOperation({ summary: 'Update verified sign', description: 'Staff/Admin updates status, type, or coordinates of an existing verified sign' })
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() request: UpdateVerifiedSignDto,
  ) {
    return this.verifiedSigns.update(id, request);
  }
}
