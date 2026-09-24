import { Module } from '@nestjs/common';
import { SignMapModule } from '../sign-map/sign-map.module';
import { RoutePreviewService } from './application/route-preview.service';
import { RoutingService } from './application/routing.service';
import { OsrmRoutingClient } from './infrastructure/osrm-routing.client';
import { NavigationController } from './presentation/navigation.controller';
import { RoutingController } from './presentation/routing.controller';

@Module({
  imports: [SignMapModule],
  controllers: [RoutingController, NavigationController],
  providers: [OsrmRoutingClient, RoutingService, RoutePreviewService],
  exports: [RoutingService],
})
export class NavigationModule {}
