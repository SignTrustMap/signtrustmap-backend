import { Module } from '@nestjs/common';
import { GeocodingService } from './application/geocoding.service';
import { NominatimGeocodingClient } from './infrastructure/nominatim-geocoding.client';
import { GeocodingController } from './presentation/geocoding.controller';

@Module({
  controllers: [GeocodingController],
  providers: [NominatimGeocodingClient, GeocodingService],
  exports: [GeocodingService],
})
export class GeocodingModule {}
