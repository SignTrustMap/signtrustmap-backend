import { RouteSignsResponse } from '../../sign-map/domain/verified-sign';

export interface RouteDirectionsRequest {
  originLatitude: number;
  originLongitude: number;
  destinationLatitude: number;
  destinationLongitude: number;
  alternativeThresholdPercent?: number;
  maxAlternatives?: number;
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

export interface RoutePreviewResponse {
  directions: RouteDirectionsResponse;
  upcomingSigns: RouteSignsResponse;
}
