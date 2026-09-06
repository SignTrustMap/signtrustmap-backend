import { Injectable } from '@nestjs/common';
import { RouteDirectionsRequestDto } from './dto/routing.dto';
import { OsrmRoutingClient } from './osrm-routing.client';

@Injectable()
export class RoutingService {
  private static readonly DEFAULT_ALTERNATIVE_THRESHOLD_PERCENT = 15;
  private static readonly DEFAULT_MAX_ALTERNATIVES = 3;

  constructor(private readonly osrm: OsrmRoutingClient) {}

  findDirections(request: RouteDirectionsRequestDto) {
    return this.osrm.findDirections(
      request,
      request.alternativeThresholdPercent ??
        RoutingService.DEFAULT_ALTERNATIVE_THRESHOLD_PERCENT,
      request.maxAlternatives ?? RoutingService.DEFAULT_MAX_ALTERNATIVES,
    );
  }
}
