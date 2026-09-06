import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNumber,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
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
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(5_000)
  @ValidateNested({ each: true })
  @Type(() => RoutePointDto)
  geometry: RoutePointDto[];
}
