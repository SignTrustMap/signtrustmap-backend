import { Body, Controller, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../common/decorators/public.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RouteSignQueryService } from '../application/route-sign-query.service';
import { RouteSignsRequestDto } from './dto/route-signs.dto';
import { VerifiedSignService } from '../application/verified-sign.service';
import { CreateVerifiedSignDto, UpdateVerifiedSignDto } from './dto/verified-sign.dto';

@ApiTags('sign map')
@Controller('signs')
export class VerifiedSignController {
  constructor(
    private readonly routeSigns: RouteSignQueryService,
    private readonly verifiedSigns: VerifiedSignService,
  ) {}

  @Public()
  @Post('along-route')
  findAlongRoute(@Body() request: RouteSignsRequestDto) {
    return this.routeSigns.findAlongRoute(request);
  }

  @ApiBearerAuth()
  @Roles('STAFF', 'ADMIN')
  @Post()
  create(@Body() request: CreateVerifiedSignDto) {
    return this.verifiedSigns.create(request);
  }

  @ApiBearerAuth()
  @Roles('STAFF', 'ADMIN')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() request: UpdateVerifiedSignDto,
  ) {
    return this.verifiedSigns.update(id, request);
  }
}
