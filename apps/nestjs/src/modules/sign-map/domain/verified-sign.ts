import { VehicleType } from '../../../common/vehicle-types';

export interface RoutePoint {
  latitude: number;
  longitude: number;
}

export interface RouteSignsRequest {
  geometry: RoutePoint[];
  vehicleType?: VehicleType;
  enabledCategoryCodes?: string[];
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
  allowedVehicles?: VehicleType[];
  value?: number | null;
  category: SignCategorySummary;
}

export interface VerifiedSign {
  id: string;
  signType: SignTypeSummary;
  latitude: number;
  longitude: number;
  trafficDirection: number | null;
  signCropUrl: string;
  frameUrl?: string | null;
  bestFrameUrl?: string | null;
  status: string;
  freshnessScore: number;
  confirmationCount?: number;
  lastVerifiedAt: Date | string | null;
  communeCode?: string | null;
  roadName?: string | null;
  displayAddress?: string | null;
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
  communeCode?: string | null;
  roadName?: string | null;
  displayAddress?: string | null;
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
  communeCode?: string | null;
  roadName?: string | null;
  displayAddress?: string | null;
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

export interface NearbySignCandidate {
  sign: VerifiedSign;
  distanceMeters: number;
}

export interface ConfirmSignRequest {
  isPresent: boolean;
  latitude?: number;
  longitude?: number;
  photoEvidenceUrl?: string;
  note?: string;
}

export interface ConfirmSignResponse {
  success: boolean;
  signId: string;
  isPresent: boolean;
  creditsAwarded: number;
  cooldownActive: boolean;
  revalidationTaskId?: string;
  message: string;
}
