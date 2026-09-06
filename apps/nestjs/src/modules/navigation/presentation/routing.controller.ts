import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../../common/decorators/public.decorator';
import { RouteDirectionsRequestDto } from './dto/routing.dto';
import { RoutingService } from '../application/routing.service';

@ApiTags('routing')
@Public()
@Controller('routing')
export class RoutingController {
  constructor(private readonly routing: RoutingService) {}

  @Post('directions')
  directions(@Body() request: RouteDirectionsRequestDto) {
    return this.routing.findDirections(request);
  }
}
