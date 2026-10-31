import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { VEHICLE_TYPES, VehicleType } from '../../../../common/vehicle-types';
import { RouteDirectionsRequest } from '../../domain/routing.types';
import { ToNumber } from '../../../../common/transformers/to-number.transformer';

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

  @ApiPropertyOptional({ description: 'Legacy vehicle mode alias', example: 'DRIVING' })
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

  @ApiProperty({ description: 'Origin latitude coordinate (Vietnam)', example: 10.7949, minimum: 8.0, maximum: 24.0 })
  @ToNumber()
  @IsNumber()
  @Min(8.0)
  @Max(24.0)
  originLatitude: number;

  @ApiProperty({ description: 'Origin longitude coordinate (Vietnam)', example: 106.7218, minimum: 102.0, maximum: 110.0 })
  @ToNumber()
  @IsNumber()
  @Min(102.0)
  @Max(110.0)
  originLongitude: number;

  @ApiProperty({ description: 'Destination latitude coordinate (Vietnam)', example: 10.7725, minimum: 8.0, maximum: 24.0 })
  @ToNumber()
  @IsNumber()
  @Min(8.0)
  @Max(24.0)
  destinationLatitude: number;

  @ApiProperty({ description: 'Destination longitude coordinate (Vietnam)', example: 106.6980, minimum: 102.0, maximum: 110.0 })
  @ToNumber()
  @IsNumber()
  @Min(102.0)
  @Max(110.0)
  destinationLongitude: number;

  @ApiPropertyOptional({ description: 'Alternative route threshold percent', minimum: 0, maximum: 100, example: 0 })
  @IsOptional()
  @ToNumber()
  @IsNumber()
  @Min(0)
  @Max(100)
  alternativeThresholdPercent?: number;

  @ApiPropertyOptional({ description: 'Max alternative routes', minimum: 0, maximum: 10, example: 0 })
  @IsOptional()
  @ToNumber()
  @IsInt()
  @Min(0)
  @Max(10)
  maxAlternatives?: number;

  @ApiPropertyOptional({ description: 'Snap radius in meters', minimum: 1, maximum: 10000, example: 100 })
  @IsOptional()
  @ToNumber()
  @IsNumber()
  @Min(1)
  @Max(10_000)
  snapRadiusMeters?: number;
}
