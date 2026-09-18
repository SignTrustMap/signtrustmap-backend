import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { VEHICLE_TYPES, VehicleType } from '../../../../common/vehicle-types';
import { RouteDirectionsRequest } from '../../domain/routing.types';

export class UpdateNavigationPreferencesDto {
  @IsOptional()
  @IsIn(Object.values(VEHICLE_TYPES))
  vehicleType?: VehicleType;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  enabledCategoryCodes?: string[];
}

export class RouteDirectionsRequestDto implements RouteDirectionsRequest {
  @IsOptional()
  @IsIn(['DRIVING'])
  vehicleMode?: 'DRIVING';

  @IsOptional()
  @IsIn(Object.values(VEHICLE_TYPES))
  vehicleType?: VehicleType;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  enabledCategoryCodes?: string[];

  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  originLatitude: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  originLongitude: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  destinationLatitude: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  destinationLongitude: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  alternativeThresholdPercent?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10)
  maxAlternatives?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(10_000)
  snapRadiusMeters?: number;
}
