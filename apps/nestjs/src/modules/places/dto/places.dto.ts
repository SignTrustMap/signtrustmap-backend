import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class AddSavedPlaceDto {
  @ApiProperty({ description: 'Place label (e.g. Home, Work, Gym)', example: 'Home' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  label: string;

  @ApiProperty({ description: 'Full human-readable address', example: '123 Nguyen Hue, District 1, HCMC' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  address: string;

  @ApiProperty({ description: 'Latitude coordinate (-90 to 90)', example: 10.7769, minimum: -90, maximum: 90 })
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @ApiProperty({ description: 'Longitude coordinate (-180 to 180)', example: 106.7009, minimum: -180, maximum: 180 })
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  @ApiPropertyOptional({ description: 'Place category type (e.g. HOME, WORK, SAVED)', example: 'HOME' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  placeType?: string;
}

export class AddRecentSearchDto {
  @ApiProperty({ description: 'Search query string', example: 'Bitexco Financial Tower' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  query: string;

  @ApiPropertyOptional({ description: 'Resolved address string', example: '2 Hai Trieu, Ben Nghe, District 1, HCMC' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiPropertyOptional({ description: 'Latitude coordinate (-90 to 90)', example: 10.7716, minimum: -90, maximum: 90 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional({ description: 'Longitude coordinate (-180 to 180)', example: 106.7042, minimum: -180, maximum: 180 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;
}
