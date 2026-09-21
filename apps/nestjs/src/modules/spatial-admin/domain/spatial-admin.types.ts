export interface ResolvedLocation {
  latitude: number;
  longitude: number;
  roadName: string | null;
  communeCode: string | null;
  communeName: string | null;
  communeType: string;
  provinceCode: string | null;
  provinceName: string | null;
  provinceType: string;
  displayAddress: string;
  boundaryVersion: string;
  source: 'INTERNAL_SPATIAL' | 'FALLBACK_GEOCODER' | 'GEOCODER_DISCOVERED';
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
