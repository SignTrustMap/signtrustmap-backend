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

export interface ReverseGeocodingResult {
  roadName: string | null;
  communeName: string | null;
  provinceName: string | null;
  displayLocation: string;
}
