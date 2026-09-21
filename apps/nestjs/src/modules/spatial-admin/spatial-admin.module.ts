import { Module } from '@nestjs/common';
import { GeocodingModule } from '../geocoding/geocoding.module';
import { SpatialAdminService } from './application/spatial-admin.service';
import { SpatialAdminBackfillService } from './application/spatial-admin-backfill.service';
import { SpatialAdminController } from './presentation/spatial-admin.controller';

@Module({
  imports: [GeocodingModule],
  controllers: [SpatialAdminController],
  providers: [SpatialAdminService, SpatialAdminBackfillService],
  exports: [SpatialAdminService, SpatialAdminBackfillService],
})
export class SpatialAdminModule {}
