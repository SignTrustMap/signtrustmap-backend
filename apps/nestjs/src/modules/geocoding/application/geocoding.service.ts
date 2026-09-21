import { Injectable } from '@nestjs/common';
import { GeocodingSearchRequest, ReverseGeocodingResult } from '../domain/geocoding.types';
import { PhotonGeocodingClient } from '../infrastructure/photon-geocoding.client';

@Injectable()
export class GeocodingService {
  constructor(private readonly photon: PhotonGeocodingClient) {}

  search(request: GeocodingSearchRequest) {
    return this.photon.search(request);
  }

  reverse(latitude: number, longitude: number): Promise<ReverseGeocodingResult> {
    return this.photon.reverse(latitude, longitude);
  }
}
