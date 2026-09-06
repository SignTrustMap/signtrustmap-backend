import { Module } from '@nestjs/common';
import { GeocodingController } from './geocoding.controller';
import { NominatimGeocodingService } from './nominatim-geocoding.service';

@Module({
  controllers: [GeocodingController],
  providers: [NominatimGeocodingService],
  exports: [NominatimGeocodingService],
})
export class GeocodingModule {}
