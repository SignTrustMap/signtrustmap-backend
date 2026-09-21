import { Module } from '@nestjs/common';
import { GeocodingService } from './application/geocoding.service';
import { PhotonGeocodingClient } from './infrastructure/photon-geocoding.client';
import { GeocodingController } from './presentation/geocoding.controller';

@Module({
  controllers: [GeocodingController],
  providers: [PhotonGeocodingClient, GeocodingService],
  exports: [GeocodingService],
})
export class GeocodingModule {}
