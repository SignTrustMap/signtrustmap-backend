import { Module } from '@nestjs/common';
import { OsrmRoutingClient } from './osrm-routing.client';
import { RoutingController } from './routing.controller';
import { RoutingService } from './routing.service';

@Module({
  controllers: [RoutingController],
  providers: [OsrmRoutingClient, RoutingService],
  exports: [RoutingService],
})
export class RoutingModule {}
