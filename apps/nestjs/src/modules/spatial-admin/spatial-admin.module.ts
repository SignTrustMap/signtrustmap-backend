import { Module } from '@nestjs/common';
import { GeocodingModule } from '../geocoding/geocoding.module';
import { SpatialAdminService } from './application/spatial-admin.service';
import { SpatialAdminController } from './presentation/spatial-admin.controller';

@Module({
  imports: [GeocodingModule],
  controllers: [SpatialAdminController],
  providers: [SpatialAdminService],
  exports: [SpatialAdminService],
})
export class SpatialAdminModule {}
