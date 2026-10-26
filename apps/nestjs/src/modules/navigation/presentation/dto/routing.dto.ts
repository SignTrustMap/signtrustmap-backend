import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { VEHICLE_TYPES, VehicleType } from '../../../../common/vehicle-types';
import { RouteDirectionsRequest } from '../../domain/routing.types';

export class UpdateNavigationPreferencesDto {
  @ApiPropertyOptional({ enum: Object.values(VEHICLE_TYPES), example: 'CAR' })
  @IsOptional()
  @IsIn(Object.values(VEHICLE_TYPES))
  vehicleType?: VehicleType;

  @ApiPropertyOptional({ type: [String], example: ['SPEED_LIMIT', 'WARNING'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  enabledCategoryCodes?: string[];
}

export class RouteDirectionsRequestDto implements RouteDirectionsRequest {
  @ApiPropertyOptional({ enum: ['DRIVING', 'CYCLING', 'WALKING', 'BIKE', 'MOTORCYCLE'], example: 'DRIVING' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value))
  @IsIn(['DRIVING', 'CYCLING', 'WALKING', 'BIKE', 'MOTORCYCLE'])
  vehicleMode?: 'DRIVING' | 'CYCLING' | 'WALKING' | 'BIKE' | 'MOTORCYCLE';

  @IsOptional()
  @IsString()
  _vehicleMode?: string;

  @ApiPropertyOptional({ enum: Object.values(VEHICLE_TYPES), example: 'CAR' })
  @IsOptional()
  @IsIn(Object.values(VEHICLE_TYPES))
  vehicleType?: VehicleType;

  @ApiPropertyOptional({ type: [String], example: ['SPEED_LIMIT', 'WARNING'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  enabledCategoryCodes?: string[];

  @ApiProperty({ description: 'Origin latitude coordinate', example: 10.7949, minimum: -90, maximum: 90 })
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  originLatitude: number;

  @ApiProperty({ description: 'Origin longitude coordinate', example: 106.7218, minimum: -180, maximum: 180 })
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  originLongitude: number;

  @ApiProperty({ description: 'Destination latitude coordinate', example: 10.7725, minimum: -90, maximum: 90 })
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  destinationLatitude: number;

  @ApiProperty({ description: 'Destination longitude coordinate', example: 106.6980, minimum: -180, maximum: 180 })
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  destinationLongitude: number;

  @ApiPropertyOptional({ description: 'Alternative route threshold percent', minimum: 0, maximum: 100, example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  alternativeThresholdPercent?: number;

  @ApiPropertyOptional({ description: 'Max alternative routes', minimum: 0, maximum: 10, example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10)
  maxAlternatives?: number;

  @ApiPropertyOptional({ description: 'Snap radius in meters', minimum: 1, maximum: 10000, example: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(10_000)
  snapRadiusMeters?: number;
}
