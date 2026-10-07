import { VehicleType } from '../../../common/vehicle-types';

export interface RouteDirectionsRequest {
  vehicleMode?: 'DRIVING' | 'CYCLING' | 'WALKING' | 'BIKE' | 'MOTORCYCLE';
  _vehicleMode?: string;
  vehicleType?: VehicleType;
  enabledCategoryCodes?: string[];
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
  type: string;
  instruction: string;
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
  route: {
    geometry: string;
    distanceMeters: number;
    durationSeconds: number;
  };
  steps: Array<{
    type: string;
    instruction: string;
    distanceMeters: number;
  }>;
  trafficSigns: Array<{
    id: string;
    type: string;
    value?: number;
    lat: number;
    lon: number;
    routeOffsetMeters: number;
  }>;
}
