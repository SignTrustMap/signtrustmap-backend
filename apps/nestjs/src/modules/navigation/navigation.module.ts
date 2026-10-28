import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SignMapModule } from '../sign-map/sign-map.module';
import { WalletModule } from '../wallet/wallet.module';
import { NavigationSession } from './infrastructure/persistence/navigation-session.entity';
import { CustomAlertProfile } from './infrastructure/persistence/custom-alert-profile.entity';
import { SavedRoute } from './infrastructure/persistence/saved-route.entity';
import { DriverProfile } from '../auth/infrastructure/persistence/driver-profile.entity';
import { NavigationCreditGateService } from './application/navigation-credit-gate.service';
import { RoutePreviewService } from './application/route-preview.service';
import { RoutingService } from './application/routing.service';
import { SavedRoutesService } from './application/saved-routes.service';
import { OsrmRoutingClient } from './infrastructure/osrm-routing.client';
import { NavigationController } from './presentation/navigation.controller';
import { RoutingController } from './presentation/routing.controller';
import { SavedRoutesController } from './presentation/saved-routes.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      NavigationSession,
      CustomAlertProfile,
      SavedRoute,
      DriverProfile,
    ]),
    SignMapModule,
    WalletModule,
  ],
  controllers: [
    RoutingController,
    NavigationController,
    SavedRoutesController,
  ],
  providers: [
    OsrmRoutingClient,
    RoutingService,
    RoutePreviewService,
    SavedRoutesService,
    NavigationCreditGateService,
  ],
  exports: [RoutingService, SavedRoutesService, NavigationCreditGateService],
})
export class NavigationModule {}

