import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  VERIFIED_SIGN_REPOSITORY,
  VerifiedSignRepository,
} from '../domain/verified-sign.repository';
import {
  RoutePoint,
  RouteSignsRequest,
  RouteSignsResponse,
  UpcomingSign,
  VerifiedSign,
} from '../domain/verified-sign';
import { appliesToTrafficHeading } from '../domain/traffic-direction';

interface RouteSegment {
  start: RoutePoint;
  end: RoutePoint;
  distanceFromRouteStartMeters: number;
  distanceMeters: number;
  headingDegrees: number;
}

interface RouteAnalysis {
  wkt: string;
  segments: RouteSegment[];
  distanceMeters: number;
}

interface RouteProjection {
  distanceAlongRouteMeters: number;
  distanceFromRouteMeters: number;
  routeHeadingDegrees: number;
}

interface UpcomingSignMatch {
  response: UpcomingSign;
  routeHeadingDegrees: number;
}

@Injectable()
export class RouteSignQueryService {
  private static readonly EARTH_RADIUS_METERS = 6_371_000;
  private static readonly MINIMUM_ROUTE_LENGTH_METERS = 0.01;
  private static readonly MAXIMUM_ROUTE_POINTS = 5_000;

  private readonly corridorWidthMeters: number;
  private readonly headingToleranceDegrees: number;

  constructor(
    @Inject(VERIFIED_SIGN_REPOSITORY)
    private readonly repository: VerifiedSignRepository,
    config: ConfigService,
  ) {
    this.corridorWidthMeters =
      config.get<number>('routing.routeSigns.corridorWidthMeters') ?? 30;
    this.headingToleranceDegrees =
      config.get<number>('routing.routeSigns.headingToleranceDegrees') ?? 45;
  }

  async findAlongRoute(request: RouteSignsRequest): Promise<RouteSignsResponse> {
    const route = this.analyzeRoute(request?.geometry);
    const candidates = await this.repository.findActiveAlongRoute(
      route.wkt,
      this.corridorWidthMeters,
    );
    const signs = candidates
      .map((sign) => this.upcomingSign(sign, route))
      .filter((match) =>
        appliesToTrafficHeading(
          match.response.sign.trafficDirection,
          match.routeHeadingDegrees,
          this.headingToleranceDegrees,
        ),
      )
      .sort(
        (left, right) =>
          left.response.distanceAlongRouteMeters - right.response.distanceAlongRouteMeters,
      )
      .map((match) => match.response);

    return {
      routeDistanceMeters: route.distanceMeters,
      corridorWidthMeters: this.corridorWidthMeters,
      signCount: signs.length,
      signs,
    };
  }

  private analyzeRoute(points: RoutePoint[] | undefined): RouteAnalysis {
    if (!Array.isArray(points) || points.length < 2) {
      throw new BadRequestException('Route geometry must contain at least two points');
    }
    if (points.length > RouteSignQueryService.MAXIMUM_ROUTE_POINTS) {
      throw new BadRequestException('Route geometry cannot contain more than 5000 points');
    }
    if (points.some((point) => !this.validPoint(point))) {
      throw new BadRequestException('Route geometry contains invalid coordinates');
    }

    const segments: RouteSegment[] = [];
    let routeDistanceMeters = 0;
    for (let index = 1; index < points.length; index += 1) {
      const start = points[index - 1];
      const end = points[index];
      const segmentDistanceMeters = this.distanceMeters(start, end);
      if (segmentDistanceMeters <= RouteSignQueryService.MINIMUM_ROUTE_LENGTH_METERS) continue;
      segments.push({
        start,
        end,
        distanceFromRouteStartMeters: routeDistanceMeters,
        distanceMeters: segmentDistanceMeters,
        headingDegrees: this.bearingDegrees(start, end),
      });
      routeDistanceMeters += segmentDistanceMeters;
    }
    if (segments.length === 0) {
      throw new BadRequestException('Route geometry must contain at least two distinct points');
    }

    return {
      wkt: `LINESTRING (${points.map((point) => `${point.longitude} ${point.latitude}`).join(', ')})`,
      segments,
      distanceMeters: routeDistanceMeters,
    };
  }

  private upcomingSign(sign: VerifiedSign, route: RouteAnalysis): UpcomingSignMatch {
    let nearest: RouteProjection | null = null;
    for (const segment of route.segments) {
      const candidate = this.project(sign, segment);
      if (!nearest || candidate.distanceFromRouteMeters < nearest.distanceFromRouteMeters) {
        nearest = candidate;
      }
    }
    if (!nearest) throw new Error('A valid route must contain at least one segment');
    return {
      response: {
        sign,
        distanceAlongRouteMeters: nearest.distanceAlongRouteMeters,
        distanceFromRouteMeters: nearest.distanceFromRouteMeters,
      },
      routeHeadingDegrees: nearest.routeHeadingDegrees,
    };
  }

  private project(sign: VerifiedSign, segment: RouteSegment): RouteProjection {
    const referenceLatitudeRadians = this.radians(
      (segment.start.latitude + segment.end.latitude + sign.latitude) / 3,
    );
    const segmentX =
      this.radians(this.normalizeLongitudeDelta(segment.end.longitude - segment.start.longitude)) *
      RouteSignQueryService.EARTH_RADIUS_METERS *
      Math.cos(referenceLatitudeRadians);
    const segmentY =
      this.radians(segment.end.latitude - segment.start.latitude) *
      RouteSignQueryService.EARTH_RADIUS_METERS;
    const pointX =
      this.radians(this.normalizeLongitudeDelta(sign.longitude - segment.start.longitude)) *
      RouteSignQueryService.EARTH_RADIUS_METERS *
      Math.cos(referenceLatitudeRadians);
    const pointY =
      this.radians(sign.latitude - segment.start.latitude) *
      RouteSignQueryService.EARTH_RADIUS_METERS;
    const segmentLengthSquared = segmentX ** 2 + segmentY ** 2;
    const fraction = Math.max(
      0,
      Math.min(1, (pointX * segmentX + pointY * segmentY) / segmentLengthSquared),
    );

    return {
      distanceAlongRouteMeters:
        segment.distanceFromRouteStartMeters + fraction * segment.distanceMeters,
      distanceFromRouteMeters: Math.hypot(
        pointX - fraction * segmentX,
        pointY - fraction * segmentY,
      ),
      routeHeadingDegrees: segment.headingDegrees,
    };
  }

  private distanceMeters(start: RoutePoint, end: RoutePoint): number {
    const lat1 = this.radians(start.latitude);
    const lat2 = this.radians(end.latitude);
    const deltaLatitude = this.radians(end.latitude - start.latitude);
    const deltaLongitude = this.radians(
      this.normalizeLongitudeDelta(end.longitude - start.longitude),
    );
    const haversine =
      Math.sin(deltaLatitude / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLongitude / 2) ** 2;
    return (
      2 *
      RouteSignQueryService.EARTH_RADIUS_METERS *
      Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
    );
  }

  private bearingDegrees(start: RoutePoint, end: RoutePoint): number {
    const lat1 = this.radians(start.latitude);
    const lat2 = this.radians(end.latitude);
    const deltaLongitude = this.radians(
      this.normalizeLongitudeDelta(end.longitude - start.longitude),
    );
    const y = Math.sin(deltaLongitude) * Math.cos(lat2);
    const x =
      Math.cos(lat1) * Math.sin(lat2) -
      Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLongitude);
    return this.normalizeHeading((Math.atan2(y, x) * 180) / Math.PI);
  }

  private validPoint(point: RoutePoint): boolean {
    return (
      point != null &&
      Number.isFinite(point.latitude) &&
      point.latitude >= -90 &&
      point.latitude <= 90 &&
      Number.isFinite(point.longitude) &&
      point.longitude >= -180 &&
      point.longitude <= 180
    );
  }

  private radians(degrees: number): number {
    return (degrees * Math.PI) / 180;
  }

  private normalizeHeading(heading: number): number {
    return ((heading % 360) + 360) % 360;
  }

  private normalizeLongitudeDelta(delta: number): number {
    return ((delta % 360) + 540) % 360 - 180;
  }
}
