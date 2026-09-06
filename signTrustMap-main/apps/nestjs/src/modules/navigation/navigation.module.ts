import { Module } from '@nestjs/common';
import { RoutingService } from './application/routing.service';
import { OsrmRoutingClient } from './infrastructure/osrm-routing.client';
import { RoutingController } from './presentation/routing.controller';

@Module({
  controllers: [RoutingController],
  providers: [OsrmRoutingClient, RoutingService],
  exports: [RoutingService],
})
export class NavigationModule {}
