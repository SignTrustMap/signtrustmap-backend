import { Injectable } from '@nestjs/common';
import { RouteSignQueryService } from '../../sign-map/application/route-sign-query.service';
import { UpcomingSign } from '../../sign-map/domain/verified-sign';
import { encodePolyline } from '../domain/encoded-polyline';
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
    const route = directions.shortestPath;

    return {
      route: {
        geometry: encodePolyline(route.geometry),
        distanceMeters: Math.round(route.distanceMeters),
        durationSeconds: Math.round(route.durationSeconds),
      },
      steps: route.steps.map((step) => ({
        type: step.type,
        instruction: step.instruction,
        distanceMeters: Math.round(step.distanceMeters),
      })),
      trafficSigns: upcomingSigns.signs.map((upcoming) => this.trafficSign(upcoming)),
    };
  }

  private trafficSign(upcoming: UpcomingSign): RoutePreviewResponse['trafficSigns'][number] {
    const { sign } = upcoming;
    const signIdentity = this.signIdentity(sign.signType.signCode, sign.signType.value);
    return {
      id: sign.id,
      type: signIdentity.type,
      ...(signIdentity.value === undefined ? {} : { value: signIdentity.value }),
      lat: sign.latitude,
      lon: sign.longitude,
      routeOffsetMeters: Math.round(upcoming.distanceAlongRouteMeters),
    };
  }

  private signIdentity(
    signCode: string,
    catalogValue: number | null | undefined,
  ): { type: string; value?: number } {
    const semanticCode = signCode.match(
      /^(.*(?:SPEED|LIMIT|HEIGHT|WIDTH|WEIGHT|AXLE).*?)[_-](\d{1,3})$/i,
    );
    if (semanticCode) {
      return {
        type: semanticCode[1],
        value: catalogValue ?? Number(semanticCode[2]),
      };
    }

    return catalogValue != null
      ? { type: signCode, value: catalogValue }
      : { type: signCode };
  }
}
