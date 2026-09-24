import { Module } from '@nestjs/common';
import { SignGeolocationService } from './application/sign-geolocation.service';
import { SignGeolocationController } from './presentation/sign-geolocation.controller';

@Module({
  controllers: [SignGeolocationController],
  providers: [SignGeolocationService],
  exports: [SignGeolocationService],
})
export class GeolocationModule {}
