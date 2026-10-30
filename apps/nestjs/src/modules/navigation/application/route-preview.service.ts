import { Injectable, Logger } from '@nestjs/common';
import { RouteSignQueryService } from '../../sign-map/application/route-sign-query.service';
import { UpcomingSign, RouteSignsResponse } from '../../sign-map/domain/verified-sign';
import { encodePolyline } from '../domain/encoded-polyline';
import { RouteDirectionsRequest, RoutePreviewResponse } from '../domain/routing.types';
import { RoutingService } from './routing.service';

@Injectable()
export class RoutePreviewService {
  private readonly logger = new Logger(RoutePreviewService.name);

  constructor(
    private readonly routing: RoutingService,
    private readonly routeSigns: RouteSignQueryService,
  ) {}

  async previewRoute(request: RouteDirectionsRequest): Promise<RoutePreviewResponse> {
    const directions = await this.routing.findDirections(request);
    let upcomingSigns: RouteSignsResponse = {
      routeDistanceMeters: directions.shortestPath.distanceMeters,
      corridorWidthMeters: 30,
      signCount: 0,
      signs: [],
    };
    try {
      upcomingSigns = await this.routeSigns.findAlongRoute({
        geometry: directions.shortestPath.geometry,
        vehicleType: request.vehicleType,
        enabledCategoryCodes: request.enabledCategoryCodes,
      });
    } catch (error: any) {
      this.logger.warn(`Could not query route signs: ${error?.message || error}`);
    }
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
      actualCropUrl: sign.signCropUrl ?? undefined,
      scenePhotoUrl: sign.scenePhotoUrl ?? undefined,
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
