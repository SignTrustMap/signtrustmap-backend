import { BadGatewayException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  RouteDirectionsRequestDto,
  RouteDirectionsResponse,
  RoutePathResponse,
  RoutePointResponse,
  RouteSnapResponse,
  RouteStepResponse,
} from './dto/routing.dto';
import { distanceMeters } from './geo-math';

interface ParsedRoute {
  distanceMeters: number;
  durationSeconds: number;
  geometry: RoutePointResponse[];
  steps: RouteStepResponse[];
}

type JsonObject = Record<string, unknown>;

@Injectable()
export class OsrmRoutingClient {
  private static readonly SAME_POINT_TOLERANCE_METERS = 0.01;

  private readonly baseUrl: string;
  private readonly profile: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>('routing.osrm.baseUrl') ?? 'https://router.project-osrm.org';
    this.profile = config.get<string>('routing.osrm.profile') ?? 'driving';
    this.timeoutMs = config.get<number>('routing.osrm.timeoutMs') ?? 5_000;
  }

  async findDirections(
    request: RouteDirectionsRequestDto,
    thresholdPercent: number,
    maxAlternatives: number,
  ): Promise<RouteDirectionsResponse> {
    const body = await this.fetchResponse(this.routeUrl(request, maxAlternatives));
    return this.parseResponse(request, thresholdPercent, maxAlternatives, body);
  }

  parseResponse(
    request: RouteDirectionsRequestDto,
    thresholdPercent: number,
    maxAlternatives: number,
    body: string,
  ): RouteDirectionsResponse {
    let root: unknown;
    try {
      root = JSON.parse(body);
    } catch {
      throw new BadGatewayException('OSRM routing service returned an invalid response');
    }
    if (!this.isObject(root)) {
      throw new BadGatewayException('OSRM routing service returned an invalid response');
    }

    const code = this.text(root.code) ?? '';
    if (code.toLowerCase() !== 'ok') {
      const message = this.text(root.message) ?? 'OSRM could not calculate a route';
      throw new NotFoundException(`OSRM routing failed: ${message}`);
    }
    if (!Array.isArray(root.routes) || root.routes.length === 0) {
      throw new NotFoundException('OSRM did not return any route');
    }

    const origin = {
      latitude: request.originLatitude,
      longitude: request.originLongitude,
    };
    const destination = {
      latitude: request.destinationLatitude,
      longitude: request.destinationLongitude,
    };
    const snappedOrigin = this.waypoint(root.waypoints, 0, origin);
    const snappedDestination = this.waypoint(root.waypoints, 1, destination);
    const parsedRoutes = root.routes
      .map((route) => this.parseRoute(route))
      .sort((left, right) => left.distanceMeters - right.distanceMeters);

    const shortestDistanceMeters = parsedRoutes[0].distanceMeters;
    const maxDistanceMeters = shortestDistanceMeters * (1 + thresholdPercent / 100);
    const acceptedRoutes: RoutePathResponse[] = [];
    for (const route of parsedRoutes) {
      if (route.distanceMeters > maxDistanceMeters) continue;
      acceptedRoutes.push(this.toResponse(route, acceptedRoutes.length, shortestDistanceMeters));
      if (acceptedRoutes.length >= maxAlternatives + 1) break;
    }

    if (acceptedRoutes.length === 0) {
      throw new NotFoundException('OSRM did not return any route within the requested threshold');
    }

    return {
      origin,
      destination,
      snappedOrigin,
      snappedDestination,
      shortestPath: acceptedRoutes[0],
      alternatives: acceptedRoutes.slice(1),
    };
  }

  private async fetchResponse(url: URL): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new BadGatewayException(`OSRM routing service returned HTTP ${response.status}`);
      }
      return await response.text();
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      if (controller.signal.aborted) {
        throw new BadGatewayException('OSRM routing request was interrupted');
      }
      throw new BadGatewayException('OSRM routing service is unavailable');
    } finally {
      clearTimeout(timeout);
    }
  }

  private routeUrl(request: RouteDirectionsRequestDto, maxAlternatives: number): URL {
    const coordinates = [
      `${request.originLongitude.toFixed(7)},${request.originLatitude.toFixed(7)}`,
      `${request.destinationLongitude.toFixed(7)},${request.destinationLatitude.toFixed(7)}`,
    ].join(';');
    const url = new URL(
      `${this.baseUrl.replace(/\/$/, '')}/route/v1/${this.profile}/${coordinates}`,
    );
    url.searchParams.set('alternatives', maxAlternatives <= 0 ? 'false' : String(maxAlternatives));
    url.searchParams.set('steps', 'true');
    url.searchParams.set('geometries', 'geojson');
    url.searchParams.set('overview', 'full');
    return url;
  }

  private parseRoute(value: unknown): ParsedRoute {
    const route = this.isObject(value) ? value : {};
    const geometryValue = this.isObject(route.geometry) ? route.geometry.coordinates : undefined;
    const geometry = this.coordinates(geometryValue);
    const steps: RouteStepResponse[] = [];
    if (Array.isArray(route.legs)) {
      for (const legValue of route.legs) {
        if (!this.isObject(legValue) || !Array.isArray(legValue.steps)) continue;
        for (const step of legValue.steps) steps.push(this.parseStep(step));
      }
    }
    if (geometry.length === 0) {
      for (const step of steps) {
        for (const point of step.geometry) this.appendCoordinate(geometry, point);
      }
    }
    return {
      distanceMeters: this.numberOrZero(route.distance),
      durationSeconds: Math.round(this.numberOrZero(route.duration)),
      geometry,
      steps,
    };
  }

  private parseStep(value: unknown): RouteStepResponse {
    const step = this.isObject(value) ? value : {};
    const geometryValue = this.isObject(step.geometry) ? step.geometry.coordinates : undefined;
    return {
      edgeId: null,
      fromNodeId: null,
      toNodeId: null,
      roadName: this.text(step.name),
      roadClass: this.text(step.mode),
      distanceMeters: this.numberOrZero(step.distance),
      durationSeconds: Math.round(this.numberOrZero(step.duration)),
      geometry: this.coordinates(geometryValue),
    };
  }

  private toResponse(route: ParsedRoute, index: number, shortestDistance: number): RoutePathResponse {
    const ratio = shortestDistance === 0 ? 1 : route.distanceMeters / shortestDistance;
    return {
      rank: index + 1,
      primary: index === 0,
      recommendation:
        index === 0
          ? 'Shortest route'
          : `Alternative ${Math.max(0, (ratio - 1) * 100).toFixed(1)}% longer than shortest route`,
      distanceMeters: route.distanceMeters,
      durationSeconds: route.durationSeconds,
      distanceRatioToShortest: ratio,
      nodeIds: [],
      edgeIds: [],
      geometry: route.geometry,
      steps: route.steps,
    };
  }

  private waypoint(value: unknown, index: number, fallback: RoutePointResponse): RouteSnapResponse {
    if (!Array.isArray(value) || !this.isObject(value[index])) {
      return { nodeId: null, ...fallback, distanceMeters: 0 };
    }
    const waypoint = value[index] as JsonObject;
    if (!Array.isArray(waypoint.location) || waypoint.location.length < 2) {
      return { nodeId: null, ...fallback, distanceMeters: 0 };
    }
    return {
      nodeId: null,
      latitude: this.numberOrZero(waypoint.location[1]),
      longitude: this.numberOrZero(waypoint.location[0]),
      distanceMeters: this.numberOrZero(waypoint.distance),
    };
  }

  private coordinates(value: unknown): RoutePointResponse[] {
    if (!Array.isArray(value)) return [];
    const coordinates: RoutePointResponse[] = [];
    for (const coordinate of value) {
      if (!Array.isArray(coordinate) || coordinate.length < 2) continue;
      this.appendCoordinate(coordinates, {
        latitude: this.numberOrZero(coordinate[1]),
        longitude: this.numberOrZero(coordinate[0]),
      });
    }
    return coordinates;
  }

  private appendCoordinate(coordinates: RoutePointResponse[], next: RoutePointResponse): void {
    const previous = coordinates[coordinates.length - 1];
    if (
      !previous ||
      distanceMeters(previous.latitude, previous.longitude, next.latitude, next.longitude) >
        OsrmRoutingClient.SAME_POINT_TOLERANCE_METERS
    ) {
      coordinates.push(next);
    }
  }

  private numberOrZero(value: unknown): number {
    if (
      value == null ||
      !['string', 'number'].includes(typeof value) ||
      (typeof value === 'string' && !value.trim())
    ) {
      return 0;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private text(value: unknown): string | null {
    if (value == null || !['string', 'number', 'boolean'].includes(typeof value)) return null;
    const text = String(value).trim();
    return text || null;
  }

  private isObject(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
