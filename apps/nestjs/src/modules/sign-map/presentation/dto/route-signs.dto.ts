import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { VEHICLE_TYPES, VehicleType } from '../../../../common/vehicle-types';
import { RoutePoint, RouteSignsRequest } from '../../domain/verified-sign';

export class RoutePointDto implements RoutePoint {
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;
}

export class RouteSignsRequestDto implements RouteSignsRequest {
  @IsOptional()
  @IsIn(Object.values(VEHICLE_TYPES))
  vehicleType?: VehicleType;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  enabledCategoryCodes?: string[];

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(5_000)
  @ValidateNested({ each: true })
  @Type(() => RoutePointDto)
  geometry: RoutePointDto[];
}
