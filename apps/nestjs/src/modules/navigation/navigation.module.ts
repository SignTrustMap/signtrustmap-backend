import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SignMapModule } from '../sign-map/sign-map.module';
import { WalletModule } from '../wallet/wallet.module';
import { NavigationSession } from './infrastructure/persistence/navigation-session.entity';
import { CustomAlertProfile } from './infrastructure/persistence/custom-alert-profile.entity';
import { NavigationCreditGateService } from './application/navigation-credit-gate.service';
import { RoutePreviewService } from './application/route-preview.service';
import { RoutingService } from './application/routing.service';
import { OsrmRoutingClient } from './infrastructure/osrm-routing.client';
import { NavigationController } from './presentation/navigation.controller';
import { RoutingController } from './presentation/routing.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([NavigationSession, CustomAlertProfile]),
    SignMapModule,
    WalletModule,
  ],
  controllers: [RoutingController, NavigationController],
  providers: [
    OsrmRoutingClient,
    RoutingService,
    RoutePreviewService,
    NavigationCreditGateService,
  ],
  exports: [RoutingService, NavigationCreditGateService],
})
export class NavigationModule {}

