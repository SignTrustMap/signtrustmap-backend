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
  @IsString()
  @Length(2, 200)
  @Matches(/\S/, { message: 'q must not be blank' })
  q: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  limit = 5;

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

export interface GeocodingBoundingBoxResponse {
  minLatitude: number;
  minLongitude: number;
  maxLatitude: number;
  maxLongitude: number;
}

export interface GeocodingResultResponse {
  providerPlaceId: number;
  osmType: string | null;
  osmId: number | null;
  name: string | null;
  displayName: string | null;
  latitude: number;
  longitude: number;
  category: string | null;
  type: string | null;
  importance: number | null;
  boundingBox: GeocodingBoundingBoxResponse | null;
  address: Readonly<Record<string, string>>;
}

export interface GeocodingSearchResponse {
  query: string;
  attribution: string;
  results: GeocodingResultResponse[];
}

export interface GeocodingSearchRequest {
  query: string;
  limit: number;
  countryCode?: string;
  minLatitude?: number;
  minLongitude?: number;
  maxLatitude?: number;
  maxLongitude?: number;
}
