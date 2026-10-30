import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class GeocodingSearchQueryDto {
  @ApiProperty({ description: 'Search query address or location', example: 'Ben Thanh Market' })
  @IsString()
  @Length(2, 200)
  @Matches(/\S/, { message: 'q must not be blank' })
  q: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  limit = 5;

  @ApiPropertyOptional({ description: 'ISO 2-letter country code', pattern: '^[A-Za-z]{2}$', example: 'vn' })
  @IsOptional()
  @Matches(/^[A-Za-z]{2}$/)
  countryCode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  minLat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  minLon?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  maxLat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  maxLon?: number;
}
