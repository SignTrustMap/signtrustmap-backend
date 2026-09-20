export interface ResolvedLocation {
  latitude: number;
  longitude: number;
  roadName: string | null;
  communeCode: string;
  communeName: string;
  communeType: string;
  provinceCode: string;
  provinceName: string;
  provinceType: string;
  displayAddress: string;
  boundaryVersion: string;
  source: 'INTERNAL_SPATIAL' | 'FALLBACK_GEOCODER';
}

export interface AdminSearchResult {
  communeCode: string;
  communeName: string;
  communeType: string;
  provinceCode: string;
  provinceName: string;
  legacyDistrictName: string | null;
  legacyWardName: string | null;
  displayName: string;
  latitude: number;
  longitude: number;
}
