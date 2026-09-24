import { Module } from '@nestjs/common';
import { SpatialAdminController } from './presentation/spatial-admin.controller';
import { SpatialAdminService } from './application/spatial-admin.service';
import { SpatialAdminBackfillService } from './application/spatial-admin-backfill.service';

@Module({
  imports: [],
  controllers: [SpatialAdminController],
  providers: [SpatialAdminService, SpatialAdminBackfillService],
  exports: [SpatialAdminService, SpatialAdminBackfillService],
})
export class SpatialAdminModule {}
