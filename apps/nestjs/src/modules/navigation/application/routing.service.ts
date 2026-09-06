import { Injectable } from '@nestjs/common';
import { RouteDirectionsRequest } from '../domain/routing.types';
import { OsrmRoutingClient } from '../infrastructure/osrm-routing.client';

@Injectable()
export class RoutingService {
  private static readonly DEFAULT_ALTERNATIVE_THRESHOLD_PERCENT = 15;
  private static readonly DEFAULT_MAX_ALTERNATIVES = 3;

  constructor(private readonly osrm: OsrmRoutingClient) {}

  findDirections(request: RouteDirectionsRequest) {
    return this.osrm.findDirections(
      request,
      request.alternativeThresholdPercent ??
        RoutingService.DEFAULT_ALTERNATIVE_THRESHOLD_PERCENT,
      request.maxAlternatives ?? RoutingService.DEFAULT_MAX_ALTERNATIVES,
    );
  }
}
