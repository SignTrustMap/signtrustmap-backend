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

export enum VerifiedSignStatus {
  ACTIVE = 'ACTIVE',
  STALE = 'STALE',
  RETIRED = 'RETIRED',
  MODERATED_OVERRIDE = 'MODERATED_OVERRIDE',
}

export interface CreateVerifiedSign {
  signTypeId: number;
  originCandidateId: string;
  latitude: number;
  longitude: number;
  trafficDirection: number | null;
  signCropUrl: string;
  lastVerifiedAt: Date;
}

export interface CreateVerifiedSignRequest
  extends Omit<CreateVerifiedSign, 'trafficDirection' | 'lastVerifiedAt'> {
  trafficDirection?: number | null;
  lastVerifiedAt?: Date;
}

export interface UpdateVerifiedSign {
  signTypeId?: number;
  latitude?: number;
  longitude?: number;
  trafficDirection?: number | null;
  signCropUrl?: string;
  lastVerifiedAt?: Date;
  status?: VerifiedSignStatus;
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
