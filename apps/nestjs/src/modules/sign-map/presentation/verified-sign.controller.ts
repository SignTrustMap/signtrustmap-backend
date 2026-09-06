import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../../common/decorators/public.decorator';
import { RouteSignQueryService } from '../application/route-sign-query.service';
import { RouteSignsRequestDto } from './dto/route-signs.dto';

@ApiTags('sign map')
@Public()
@Controller('signs')
export class VerifiedSignController {
  constructor(private readonly routeSigns: RouteSignQueryService) {}

  @Post('along-route')
  findAlongRoute(@Body() request: RouteSignsRequestDto) {
    return this.routeSigns.findAlongRoute(request);
  }
}
