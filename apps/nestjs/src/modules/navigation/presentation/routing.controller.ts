import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../common/decorators/public.decorator';
import { RouteDirectionsRequestDto } from './dto/routing.dto';
import { RoutingService } from '../application/routing.service';

@ApiTags('Routing')
@Public()
@Controller('routing')
export class RoutingController {
  constructor(private readonly routing: RoutingService) {}

  @ApiOperation({ summary: 'List supported vehicle modes', description: 'Retrieve supported transit and driving routing modes' })
  @Get('vehicle-modes')
  vehicleModes() {
    return {
      defaultMode: 'MOTORCYCLE',
      modes: [
        { id: 'MOTORCYCLE', label: 'Xe máy (Motorcycle)' },
        { id: 'DRIVING', label: 'Ô tô (Car)' },
        { id: 'CYCLING', label: 'Xe đạp (Bicycle)' },
        { id: 'WALKING', label: 'Đi bộ (Walking)' },
      ],
    };
  }

  @ApiOperation({ summary: 'Calculate route directions', description: 'Calculate shortest driving path, duration, and turn-by-turn navigation maneuvers between origin and destination' })
  @Post('directions')
  directions(@Body() request: RouteDirectionsRequestDto) {
    return this.routing.findDirections(request);
  }
}
