import { Injectable } from '@nestjs/common';
import { GeocodingSearchRequest } from '../domain/geocoding.types';
import { NominatimGeocodingClient } from '../infrastructure/nominatim-geocoding.client';

@Injectable()
export class GeocodingService {
  constructor(private readonly nominatim: NominatimGeocodingClient) {}

  search(request: GeocodingSearchRequest) {
    return this.nominatim.search(request);
  }

  reverse(latitude: number, longitude: number) {
    return this.nominatim.reverse(latitude, longitude);
  }
}
