import { Injectable } from '@nestjs/common';
import { RouteDirectionsRequest } from '../domain/routing.types';
import { OsrmRoutingClient } from '../infrastructure/osrm-routing.client';

@Injectable()
export class RoutingService {
  private static readonly DEFAULT_ALTERNATIVE_THRESHOLD_PERCENT = 15;
  private static readonly DEFAULT_MAX_ALTERNATIVES = 3;

  constructor(private readonly osrm: OsrmRoutingClient) {}

  findDirections(request: RouteDirectionsRequest) {
    this.normalizeVehicle(request);
    return this.osrm.findDirections(
      request,
      request.alternativeThresholdPercent ??
        RoutingService.DEFAULT_ALTERNATIVE_THRESHOLD_PERCENT,
      request.maxAlternatives ?? RoutingService.DEFAULT_MAX_ALTERNATIVES,
    );
  }

  normalizeVehicle(request: RouteDirectionsRequest): void {
    const rawMode = (request.vehicleMode ?? request._vehicleMode ?? '').toString().toUpperCase();
    if (!request.vehicleMode && rawMode) {
      if (['DRIVING', 'CYCLING', 'WALKING', 'BIKE', 'MOTORCYCLE'].includes(rawMode)) {
        request.vehicleMode = rawMode as any;
      }
    }
    if (!request.vehicleType && rawMode) {
      if (rawMode === 'BIKE' || rawMode === 'MOTORCYCLE') {
        request.vehicleType = 'MOTORCYCLE';
      } else if (rawMode === 'DRIVING' || rawMode === 'CAR') {
        request.vehicleType = 'CAR';
      } else if (rawMode === 'CYCLING' || rawMode === 'BICYCLE') {
        request.vehicleType = 'BICYCLE';
      } else if (rawMode === 'WALKING' || rawMode === 'PEDESTRIAN') {
        request.vehicleType = 'PEDESTRIAN';
      }
    }
  }
}
