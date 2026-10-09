import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VEHICLE_TYPES, VehicleType } from '../../../common/vehicle-types';
import { RouteSignQueryService } from '../../sign-map/application/route-sign-query.service';
import { decodePolyline, encodePolyline } from '../domain/encoded-polyline';
import { RoutePointResponse } from '../domain/routing.types';
import { SavedRoute } from '../infrastructure/persistence/saved-route.entity';
import {
  CreateSavedRouteDto,
  UpdateSavedRouteDto,
} from '../presentation/dto/saved-route.dto';
import { RoutingService } from './routing.service';

@Injectable()
export class SavedRoutesService {
  constructor(
    @InjectRepository(SavedRoute)
    private readonly repo: Repository<SavedRoute>,
    @Optional()
    private readonly routing?: RoutingService,
    @Optional()
    private readonly routeSigns?: RouteSignQueryService,
  ) {}

  async listForUser(userId: string, vehicleMode?: string): Promise<SavedRoute[]> {
    const where: any = { userId };
    if (vehicleMode) {
      where.vehicleMode = vehicleMode.toUpperCase();
    }
    return this.repo.find({
      where,
      order: { updatedAt: 'DESC' },
    });
  }

  async getById(userId: string, id: string): Promise<SavedRoute> {
    const route = await this.repo.findOne({ where: { id, userId } });
    if (!route) {
      throw new NotFoundException(`Saved route with ID "${id}" was not found`);
    }
    return route;
  }

  async create(userId: string, dto: CreateSavedRouteDto): Promise<SavedRoute> {
    const vehicleMode = (dto.vehicleMode || 'MOTORCYCLE').toUpperCase();

    let distanceMeters = dto.distanceMeters ?? 0;
    let durationSeconds = dto.durationSeconds ?? 0;
    let encodedPolyline = dto.encodedPolyline ?? '';

    // If encoded polyline was not provided by client, calculate route via routing engine
    if (!encodedPolyline && this.routing) {
      try {
        const directions = await this.routing.findDirections({
          originLatitude: dto.originLatitude,
          originLongitude: dto.originLongitude,
          destinationLatitude: dto.destinationLatitude,
          destinationLongitude: dto.destinationLongitude,
          vehicleMode: vehicleMode as any,
        });
        distanceMeters = Math.round(directions.shortestPath.distanceMeters);
        durationSeconds = Math.round(directions.shortestPath.durationSeconds);
        encodedPolyline = encodePolyline(directions.shortestPath.geometry);
      } catch {
        // Fallback: simple line between origin and destination
        encodedPolyline = encodePolyline([
          { latitude: dto.originLatitude, longitude: dto.originLongitude },
          { latitude: dto.destinationLatitude, longitude: dto.destinationLongitude },
        ]);
      }
    }

    const route = this.repo.create({
      userId,
      title: dto.title.trim(),
      vehicleMode,
      originName: dto.originName.trim(),
      originLatitude: dto.originLatitude,
      originLongitude: dto.originLongitude,
      destinationName: dto.destinationName.trim(),
      destinationLatitude: dto.destinationLatitude,
      destinationLongitude: dto.destinationLongitude,
      waypoints: dto.waypoints ?? [],
      distanceMeters,
      durationSeconds,
      encodedPolyline,
      filterRules: dto.filterRules ?? {
        onlyFixedSigns: true,
        categories: ['P', 'W', 'R', 'I'],
      },
    });

    return this.repo.save(route);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateSavedRouteDto,
  ): Promise<SavedRoute> {
    const route = await this.getById(userId, id);

    if (dto.title !== undefined) {
      route.title = dto.title.trim();
    }
    if (dto.vehicleMode !== undefined) {
      route.vehicleMode = dto.vehicleMode.toUpperCase();
    }
    if (dto.filterRules !== undefined) {
      route.filterRules = {
        ...route.filterRules,
        ...dto.filterRules,
      };
    }

    return this.repo.save(route);
  }

  async delete(userId: string, id: string): Promise<{ success: boolean; id: string }> {
    const route = await this.getById(userId, id);
    await this.repo.remove(route);
    return { success: true, id };
  }

  async getSignsForSavedRoute(userId: string, id: string): Promise<any> {
    const route = await this.getById(userId, id);
    if (!this.routeSigns) {
      return {
        routeId: id,
        signCount: 0,
        signs: [],
      };
    }

    let geometry: RoutePointResponse[] = decodePolyline(route.encodedPolyline);
    if (geometry.length < 2) {
      geometry = [
        { latitude: route.originLatitude, longitude: route.originLongitude },
        { latitude: route.destinationLatitude, longitude: route.destinationLongitude },
      ];
    }

    const vehicleType = this.resolveVehicleType(route.vehicleMode);
    const enabledCategories = route.filterRules?.categories;
    const onlyFixedSigns = route.filterRules?.onlyFixedSigns !== false;

    const result = await this.routeSigns.findAlongRoute({
      geometry,
      vehicleType,
      enabledCategoryCodes: enabledCategories,
      onlyFixedSigns,
    });

    return {
      routeId: id,
      routeTitle: route.title,
      vehicleMode: route.vehicleMode,
      distanceMeters: route.distanceMeters,
      signCount: result.signCount,
      signs: result.signs,
    };
  }

  private resolveVehicleType(mode: string): VehicleType | undefined {
    const m = (mode || '').toUpperCase();
    if (m === 'MOTORCYCLE' || m === 'BIKE') return 'MOTORCYCLE';
    if (m === 'CAR' || m === 'DRIVING') return 'CAR';
    if (m === 'BICYCLE' || m === 'CYCLING') return 'BICYCLE';
    if (m === 'PEDESTRIAN' || m === 'WALKING') return 'PEDESTRIAN';
    return undefined;
  }
}
