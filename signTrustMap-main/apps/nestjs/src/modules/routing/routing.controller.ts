import { Body, Controller, Post } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { RouteDirectionsRequestDto } from './dto/routing.dto';
import { RoutingService } from './routing.service';

@Public()
@Controller('routing')
export class RoutingController {
  constructor(private readonly routing: RoutingService) {}

  @Post('directions')
  directions(@Body() request: RouteDirectionsRequestDto) {
    return this.routing.findDirections(request);
  }
}
