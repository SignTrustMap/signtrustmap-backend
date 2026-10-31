import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VehicleType } from '../../../common/vehicle-types';
import {
  RouteDirectionsRequest,
  RouteDirectionsResponse,
  RoutePathResponse,
  RoutePointResponse,
  RouteSnapResponse,
  RouteStepResponse,
} from '../domain/routing.types';
import { distanceMeters } from '../domain/geo-math';

interface ParsedRoute {
  distanceMeters: number;
  durationSeconds: number;
  geometry: RoutePointResponse[];
  steps: RouteStepResponse[];
}

type JsonObject = Record<string, unknown>;

@Injectable()
export class OsrmRoutingClient {
  private readonly logger = new Logger(OsrmRoutingClient.name);
  private static readonly SAME_POINT_TOLERANCE_METERS = 0.01;
  /** Single bounded retry for transient connectivity failures only. */
  private static readonly TRANSIENT_RETRY_LIMIT = 1;

  // Typical speeds in m/s:
  // Walking: ~4.8 km/h = 1.33 m/s
  private static readonly PEDESTRIAN_SPEED_MPS = 1.33;
  // Cycling: ~15 km/h = 4.17 m/s
  private static readonly BICYCLE_SPEED_MPS = 4.17;
  // Commercial truck deceleration and turning factor vs standard driving
  private static readonly TRUCK_DURATION_FACTOR = 1.25;
  // Bus transit speed factor
  private static readonly BUS_DURATION_FACTOR = 1.15;
  // Motorcycle urban speed factor
  private static readonly MOTORCYCLE_DURATION_FACTOR = 0.95;

  private readonly baseUrl: string;
  private readonly profile: string;
  private readonly motorcycleProfile: string;
  private readonly timeoutMs: number;
  private readonly motorcycleDurationFactor: number;

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>('routing.osrm.baseUrl') ?? 'https://router.project-osrm.org';
    this.profile = config.get<string>('routing.osrm.profile') ?? 'driving';
    this.motorcycleProfile =
      config.get<string>('routing.osrm.motorcycleProfile') ?? 'motorcycle';
    this.timeoutMs = config.get<number>('routing.osrm.timeoutMs') ?? 5_000;
    this.motorcycleDurationFactor =
      config.get<number>('routing.osrm.motorcycleDurationFactor') ??
      OsrmRoutingClient.MOTORCYCLE_DURATION_FACTOR;
  }

  async findDirections(
    request: RouteDirectionsRequest,
    thresholdPercent: number,
    maxAlternatives: number,
  ): Promise<RouteDirectionsResponse> {
    const effectiveMode = request.vehicleMode ?? request._vehicleMode;
    const effectiveType = this.resolveVehicleType(request.vehicleType, effectiveMode);
    const profile = this.resolveProfile(effectiveType, effectiveMode);
    let body: string;
    try {
      body = await this.fetchResponse(this.routeUrl(request, maxAlternatives, profile));
    } catch (error) {
      // Do not silently turn a motorcycle request into a car request. A missing
      // motorcycle profile must be visible to the caller rather than returning
      // geometry calculated with the wrong vehicle model.
      if (profile !== this.profile && effectiveType !== 'MOTORCYCLE') {
        body = await this.fetchResponse(this.routeUrl(request, maxAlternatives, this.profile));
      } else {
        throw error;
      }
    }
    return this.parseResponse(request, thresholdPercent, maxAlternatives, body);
  }

  private resolveVehicleType(
    vehicleType?: VehicleType,
    vehicleMode?: string,
  ): VehicleType | undefined {
    if (vehicleType) return vehicleType;
    const mode = (vehicleMode ?? '').toString().toUpperCase();
    if (mode === 'BIKE' || mode === 'MOTORCYCLE') return 'MOTORCYCLE';
    if (mode === 'DRIVING' || mode === 'CAR') return 'CAR';
    if (mode === 'CYCLING' || mode === 'BICYCLE') return 'BICYCLE';
    if (mode === 'WALKING' || mode === 'PEDESTRIAN') return 'PEDESTRIAN';
    return undefined;
  }

  private resolveProfile(vehicleType?: VehicleType, vehicleMode?: string): string {
    const effectiveType = this.resolveVehicleType(vehicleType, vehicleMode);
    const mode = (vehicleMode ?? '').toString().toUpperCase();
    if (effectiveType === 'BICYCLE' || mode === 'CYCLING') {
      return 'bike';
    }
    if (effectiveType === 'PEDESTRIAN' || mode === 'WALKING') {
      return 'foot';
    }
    if (effectiveType === 'MOTORCYCLE') {
      return this.motorcycleProfile;
    }
    return this.profile || 'driving';
  }

  parseResponse(
    request: RouteDirectionsRequest,
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
    const effectiveMode = request.vehicleMode ?? request._vehicleMode;
    const effectiveType = this.resolveVehicleType(request.vehicleType, effectiveMode);
    const parsedRoutes = root.routes
      .map((route) => this.parseRoute(route, effectiveType, effectiveMode))
      .sort((left, right) => left.distanceMeters - right.distanceMeters);

    const shortestDistanceMeters = parsedRoutes[0].distanceMeters;
    const maxDistanceMeters = shortestDistanceMeters * (1 + thresholdPercent / 100);
    const acceptedRoutes: RoutePathResponse[] = [];
    for (const route of parsedRoutes) {
      if (route.distanceMeters > maxDistanceMeters) continue;
      acceptedRoutes.push(
        this.toResponse(route, acceptedRoutes.length, shortestDistanceMeters, effectiveType),
      );
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
    let lastError: unknown;
    for (let attempt = 0; attempt <= OsrmRoutingClient.TRANSIENT_RETRY_LIMIT; attempt++) {
      try {
        return await this.fetchOnce(url);
      } catch (error) {
        lastError = error;
        // Retry only genuine transient connectivity failures — never timeouts,
        // HTTP mapped errors, or parse failures (avoids request storms).
        if (!(error instanceof ServiceUnavailableException) || attempt >= OsrmRoutingClient.TRANSIENT_RETRY_LIMIT) {
          throw error;
        }
        this.logger.warn(`OSRM transient failure; retrying once (attempt ${attempt + 1})`);
      }
    }
    throw lastError;
  }

  private async fetchOnce(url: URL): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        if (response.status === 400) {
          let detail = '';
          try {
            const errorPayload: any = await response.json();
            if (errorPayload?.message) detail = `: ${errorPayload.message}`;
          } catch {
            /* ignore non-JSON error bodies */
          }
          throw new BadRequestException(`OSRM routing service returned HTTP 400${detail}`);
        }
        if (response.status === 404) {
          throw new NotFoundException('No route found between the specified coordinates');
        }
        // Upstream returned an unexpected status — treat as bad gateway.
        this.logger.warn(`OSRM upstream HTTP ${response.status}`);
        throw new BadGatewayException(`OSRM routing service returned HTTP ${response.status}`);
      }
      return await response.text();
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof BadGatewayException ||
        error instanceof GatewayTimeoutException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }
      if (controller.signal.aborted) {
        // Preserve historical message text for Coolify Sentinel correlation while
        // classifying timeouts as 504 Gateway Timeout.
        this.logger.warn(`OSRM request interrupted after ${this.timeoutMs}ms`);
        throw new GatewayTimeoutException('OSRM routing request was interrupted');
      }
      const cause = error instanceof Error ? error.name : 'unknown';
      this.logger.warn(`OSRM routing unavailable (${cause})`);
      throw new ServiceUnavailableException('OSRM routing service is unavailable');
    } finally {
      clearTimeout(timeout);
    }
  }

  private routeUrl(
    request: RouteDirectionsRequest,
    maxAlternatives: number,
    profileOverride?: string,
  ): URL {
    const effectiveMode = request.vehicleMode ?? request._vehicleMode;
    const effectiveType = this.resolveVehicleType(request.vehicleType, effectiveMode);
    const profile = profileOverride ?? this.resolveProfile(effectiveType, effectiveMode);
    const coordinates = [
      `${request.originLongitude.toFixed(7)},${request.originLatitude.toFixed(7)}`,
      `${request.destinationLongitude.toFixed(7)},${request.destinationLatitude.toFixed(7)}`,
    ].join(';');
    const url = new URL(
      `${this.baseUrl.replace(/\/$/, '')}/route/v1/${profile}/${coordinates}`,
    );
    url.searchParams.set('alternatives', maxAlternatives <= 0 ? 'false' : String(maxAlternatives));
    url.searchParams.set('steps', 'true');
    url.searchParams.set('geometries', 'geojson');
    url.searchParams.set('overview', 'full');
    return url;
  }

  private parseRoute(
    value: unknown,
    vehicleType?: VehicleType,
    vehicleMode?: string,
  ): ParsedRoute {
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
    const rawDistance = this.numberOrZero(route.distance);
    const rawDuration = Math.round(this.numberOrZero(route.duration));
    const effectiveType = this.resolveVehicleType(vehicleType, vehicleMode);
    const calibrated = this.calibrateDuration(
      rawDistance,
      rawDuration,
      steps,
      effectiveType,
      vehicleMode,
    );

    return {
      distanceMeters: rawDistance,
      durationSeconds: calibrated.durationSeconds,
      geometry,
      steps: calibrated.steps,
    };
  }

  private calibrateDuration(
    distanceMeters: number,
    durationSeconds: number,
    steps: RouteStepResponse[],
    vehicleType?: VehicleType,
    vehicleMode?: string,
  ): { durationSeconds: number; steps: RouteStepResponse[] } {
    const effectiveType = this.resolveVehicleType(vehicleType, vehicleMode);
    if (distanceMeters <= 0 || !effectiveType) {
      return { durationSeconds, steps };
    }

    let targetDuration = durationSeconds;
    let factor = 1.0;

    if (effectiveType === 'PEDESTRIAN' || vehicleMode === 'WALKING') {
      const impliedSpeed = durationSeconds > 0 ? distanceMeters / durationSeconds : 0;
      if (impliedSpeed > 1.8) {
        targetDuration = Math.max(1, Math.round(distanceMeters / OsrmRoutingClient.PEDESTRIAN_SPEED_MPS));
        factor = durationSeconds > 0 ? targetDuration / durationSeconds : 1.0;
      }
    } else if (effectiveType === 'BICYCLE' || vehicleMode === 'CYCLING') {
      const impliedSpeed = durationSeconds > 0 ? distanceMeters / durationSeconds : 0;
      if (impliedSpeed > 5.5) {
        targetDuration = Math.max(1, Math.round(distanceMeters / OsrmRoutingClient.BICYCLE_SPEED_MPS));
        factor = durationSeconds > 0 ? targetDuration / durationSeconds : 1.0;
      }
    } else if (effectiveType === 'TRUCK') {
      targetDuration = Math.max(1, Math.round(durationSeconds * OsrmRoutingClient.TRUCK_DURATION_FACTOR));
      factor = OsrmRoutingClient.TRUCK_DURATION_FACTOR;
    } else if (effectiveType === 'BUS') {
      targetDuration = Math.max(1, Math.round(durationSeconds * OsrmRoutingClient.BUS_DURATION_FACTOR));
      factor = OsrmRoutingClient.BUS_DURATION_FACTOR;
    } else if (effectiveType === 'MOTORCYCLE') {
      targetDuration = Math.max(1, Math.round(durationSeconds * this.motorcycleDurationFactor));
      factor = this.motorcycleDurationFactor;
    }

    const calibratedSteps = steps.map((step) => {
      const stepDuration = Math.max(1, Math.round(step.durationSeconds * factor));
      return {
        ...step,
        durationSeconds: stepDuration,
        roadClass:
          effectiveType === 'PEDESTRIAN' || vehicleMode === 'WALKING'
            ? 'walking'
            : effectiveType === 'BICYCLE' || vehicleMode === 'CYCLING'
              ? 'cycling'
              : step.roadClass,
      };
    });

    return { durationSeconds: targetDuration, steps: calibratedSteps };
  }

  private parseStep(value: unknown): RouteStepResponse {
    const step = this.isObject(value) ? value : {};
    const maneuver = this.isObject(step.maneuver) ? step.maneuver : {};
    const type = this.text(maneuver.type) ?? 'continue';
    const modifier = this.text(maneuver.modifier);
    const roadName = this.text(step.name);
    const geometryValue = this.isObject(step.geometry) ? step.geometry.coordinates : undefined;
    return {
      type,
      instruction: this.instruction(type, modifier, roadName, maneuver.exit),
      edgeId: null,
      fromNodeId: null,
      toNodeId: null,
      roadName,
      roadClass: this.text(step.mode),
      distanceMeters: this.numberOrZero(step.distance),
      durationSeconds: Math.round(this.numberOrZero(step.duration)),
      geometry: this.coordinates(geometryValue),
    };
  }

  private instruction(
    type: string,
    modifier: string | null,
    roadName: string | null,
    exitValue: unknown,
  ): string {
    const direction = modifier ? ` ${modifier.replace(/-/g, ' ')}` : '';
    const road = roadName ? ` onto ${roadName}` : '';
    const exit = this.numberOrZero(exitValue);

    switch (type) {
      case 'depart':
        return `Head${direction}${road}`;
      case 'arrive':
        return modifier ? `Arrive at your destination on the ${modifier}` : 'Arrive at your destination';
      case 'turn':
      case 'end of road':
        return `Turn${direction}${road}`;
      case 'continue':
      case 'new name':
        return `Continue${direction}${road}`;
      case 'merge':
        return `Merge${direction}${road}`;
      case 'fork':
        return `Keep${direction}${road}`;
      case 'on ramp':
      case 'off ramp':
        return `Take the ramp${direction}${road}`;
      case 'roundabout':
      case 'rotary':
      case 'roundabout turn':
        return exit > 0
          ? `Enter the roundabout and take exit ${exit}${road}`
          : `Enter the roundabout${road}`;
      case 'exit roundabout':
      case 'exit rotary':
        return `Exit the roundabout${road}`;
      default:
        return `${this.capitalize(type.replace(/-/g, ' '))}${direction}${road}`;
    }
  }

  private capitalize(value: string): string {
    return value ? value[0].toUpperCase() + value.slice(1) : 'Continue';
  }

  private toResponse(
    route: ParsedRoute,
    index: number,
    shortestDistance: number,
    vehicleType?: VehicleType,
  ): RoutePathResponse {
    const ratio = shortestDistance === 0 ? 1 : route.distanceMeters / shortestDistance;
    const typeLabel = vehicleType && vehicleType !== 'CAR'
      ? ` (${this.capitalize(vehicleType.toLowerCase())})`
      : '';
    return {
      rank: index + 1,
      primary: index === 0,
      recommendation:
        index === 0
          ? `Shortest route${typeLabel}`
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
