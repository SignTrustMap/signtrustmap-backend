export interface RoutePoint {
  latitude: number;
  longitude: number;
}

export interface RouteSignsRequest {
  geometry: RoutePoint[];
}

export interface SignCategorySummary {
  id: number;
  code: string;
  nameVi: string;
  nameEn: string;
}

export interface SignTypeSummary {
  id: number;
  categoryId: number;
  signCode: string;
  nameVi: string;
  nameEn: string;
  description: string | null;
  labelingGuidelines: string | null;
  shape: string | null;
  colorScheme: string | null;
  isActive: boolean;
  category: SignCategorySummary;
}

export interface VerifiedSign {
  id: string;
  signType: SignTypeSummary;
  latitude: number;
  longitude: number;
  trafficDirection: number | null;
  signCropUrl: string;
  status: string;
  freshnessScore: number;
  lastVerifiedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface UpcomingSign {
  sign: VerifiedSign;
  distanceAlongRouteMeters: number;
  distanceFromRouteMeters: number;
}

export interface RouteSignsResponse {
  routeDistanceMeters: number;
  corridorWidthMeters: number;
  signCount: number;
  signs: UpcomingSign[];
}
