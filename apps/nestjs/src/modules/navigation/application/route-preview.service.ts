import { Injectable } from '@nestjs/common';
import { RouteSignQueryService } from '../../sign-map/application/route-sign-query.service';
import { RouteDirectionsRequest, RoutePreviewResponse } from '../domain/routing.types';
import { RoutingService } from './routing.service';

@Injectable()
export class RoutePreviewService {
  constructor(
    private readonly routing: RoutingService,
    private readonly routeSigns: RouteSignQueryService,
  ) {}

  async previewRoute(request: RouteDirectionsRequest): Promise<RoutePreviewResponse> {
    const directions = await this.routing.findDirections(request);
    const upcomingSigns = await this.routeSigns.findAlongRoute({
      geometry: directions.shortestPath.geometry,
    });
    return { directions, upcomingSigns };
  }
}
