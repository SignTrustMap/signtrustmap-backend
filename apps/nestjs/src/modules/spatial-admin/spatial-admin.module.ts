import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SpatialAdminController } from './presentation/spatial-admin.controller';
import { SpatialAdminService } from './application/spatial-admin.service';
import { SpatialAdminBackfillService } from './application/spatial-admin-backfill.service';
import { AdminProvince } from './infrastructure/persistence/admin-province.entity';
import { AdminCommune } from './infrastructure/persistence/admin-commune.entity';
import { OsmRoad } from './infrastructure/persistence/osm-road.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([AdminProvince, AdminCommune, OsmRoad]),
  ],
  controllers: [SpatialAdminController],
  providers: [SpatialAdminService, SpatialAdminBackfillService],
  exports: [SpatialAdminService, SpatialAdminBackfillService],
})
export class SpatialAdminModule {}
