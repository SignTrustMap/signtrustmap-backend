export interface DetectionBox {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

export interface SignObservation {
  cameraLatitude: number;
  cameraLongitude: number;
  cameraBearingDegrees: number;
  detectionBox: DetectionBox;
}

export interface SignGeolocationRequest {
  observations: SignObservation[];
  horizontalFieldOfViewDegrees?: number | null;
  imageWidthPixels?: number | null;
}

export enum SignGeolocationMethod {
  TRIANGULATION = 'TRIANGULATION',
  ASSUMED_HEIGHT = 'ASSUMED_HEIGHT',
}

export interface SignGeolocationResponse {
  latitude: number;
  longitude: number;
  averageDistanceMeters: number;
  estimatedSignHeightMeters: number;
  method: SignGeolocationMethod;
  observationCount: number;
}
