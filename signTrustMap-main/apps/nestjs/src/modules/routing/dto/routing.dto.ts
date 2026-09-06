import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class RouteDirectionsRequestDto {
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

export interface RoutePointResponse {
  latitude: number;
  longitude: number;
}

export interface RouteSnapResponse extends RoutePointResponse {
  nodeId: string | null;
  distanceMeters: number;
}

export interface RouteStepResponse {
  edgeId: string | null;
  fromNodeId: string | null;
  toNodeId: string | null;
  roadName: string | null;
  roadClass: string | null;
  distanceMeters: number;
  durationSeconds: number;
  geometry: RoutePointResponse[];
}

export interface RoutePathResponse {
  rank: number;
  primary: boolean;
  recommendation: string;
  distanceMeters: number;
  durationSeconds: number;
  distanceRatioToShortest: number;
  nodeIds: string[];
  edgeIds: string[];
  geometry: RoutePointResponse[];
  steps: RouteStepResponse[];
}

export interface RouteDirectionsResponse {
  origin: RoutePointResponse;
  destination: RoutePointResponse;
  snappedOrigin: RouteSnapResponse;
  snappedDestination: RouteSnapResponse;
  shortestPath: RoutePathResponse;
  alternatives: RoutePathResponse[];
}
