import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RouteFilterRulesDto {
  @ApiPropertyOptional({ description: 'Filter only fixed infrastructure signs (excluding temporary hazards)', default: true })
  @IsOptional()
  @IsBoolean()
  onlyFixedSigns?: boolean;

  @ApiPropertyOptional({ description: 'List of sign category codes to include (e.g. P, W, R, I)', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categories?: string[];
}

export class CreateSavedRouteDto {
  @ApiProperty({ description: 'User-assigned label/name for the route', example: 'Home to Work by Motorbike' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title: string;

  @ApiPropertyOptional({ description: 'Preferred vehicle mode (e.g. MOTORCYCLE, CAR, BICYCLE)', default: 'MOTORCYCLE' })
  @IsOptional()
  @IsString()
  vehicleMode?: string;

  @ApiProperty({ description: 'Readable origin address or landmark name', example: '123 Nguyen Hue, Ben Nghe, Q1' })
  @IsString()
  originName: string;

  @ApiProperty({ description: 'Origin GPS latitude', example: 10.7769 })
  @Type(() => Number)
  @IsNumber()
  originLatitude: number;

  @ApiProperty({ description: 'Origin GPS longitude', example: 106.7009 })
  @Type(() => Number)
  @IsNumber()
  originLongitude: number;

  @ApiProperty({ description: 'Readable destination address or landmark name', example: 'Thu Duc Campus' })
  @IsString()
  destinationName: string;

  @ApiProperty({ description: 'Destination GPS latitude', example: 10.8500 })
  @Type(() => Number)
  @IsNumber()
  destinationLatitude: number;

  @ApiProperty({ description: 'Destination GPS longitude', example: 106.7720 })
  @Type(() => Number)
  @IsNumber()
  destinationLongitude: number;

  @ApiPropertyOptional({ description: 'Intermediate waypoints along the route' })
  @IsOptional()
  @IsArray()
  waypoints?: Array<{ latitude: number; longitude: number; name?: string }>;

  @ApiPropertyOptional({ description: 'Total route distance in meters', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  distanceMeters?: number;

  @ApiPropertyOptional({ description: 'Total estimated duration in seconds', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  durationSeconds?: number;

  @ApiPropertyOptional({ description: 'Google encoded polyline representation of the path' })
  @IsOptional()
  @IsString()
  encodedPolyline?: string;

  @ApiPropertyOptional({ description: 'Filter preferences for traffic signs along this route' })
  @IsOptional()
  @IsObject()
  filterRules?: RouteFilterRulesDto;
}

export class UpdateSavedRouteDto {
  @ApiPropertyOptional({ description: 'Updated title for the saved route' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional({ description: 'Updated preferred vehicle mode (e.g. MOTORCYCLE, CAR)' })
  @IsOptional()
  @IsString()
  vehicleMode?: string;

  @ApiPropertyOptional({ description: 'Updated filter rules for signs along this route' })
  @IsOptional()
  @IsObject()
  filterRules?: RouteFilterRulesDto;
}
