import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { RouteDirectionsRequest } from '../../domain/routing.types';

export class RouteDirectionsRequestDto implements RouteDirectionsRequest {
  @IsOptional()
  @IsIn(['DRIVING'])
  vehicleMode?: 'DRIVING';

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
