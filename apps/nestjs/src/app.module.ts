import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_GUARD } from '@nestjs/core';
import databaseConfig from './config/database.config';
import geocodingConfig from './config/geocoding.config';
import jwtConfig from './config/jwt.config';
import minioConfig from './config/minio.config';
import routingConfig from './config/routing.config';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { AuthModule } from './modules/auth/auth.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { DailyTasksModule } from './modules/daily-tasks/daily-tasks.module';
import { MinioModule } from './integrations/minio/minio.module';
import { SurveyModule } from './modules/survey/survey.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { ModerationModule } from './modules/moderation/moderation.module';
import { RevalidationModule } from './modules/revalidation/revalidation.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { ConsensusModule } from './modules/consensus/consensus.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AdminModule } from './modules/admin/admin.module';
import { LeaderboardModule } from './modules/leaderboard/leaderboard.module';
import { PlacesModule } from './modules/places/places.module';
import { GeocodingModule } from './modules/geocoding/geocoding.module';
import { GeolocationModule } from './modules/geolocation/geolocation.module';
import { NavigationModule } from './modules/navigation/navigation.module';
import { SignMapModule } from './modules/sign-map/sign-map.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        databaseConfig,
        jwtConfig,
        minioConfig,
        geocodingConfig,
        routingConfig,
      ],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('database.url');
        const base: any = {
          type: 'postgres' as const,
          autoLoadEntities: true,
          synchronize: false,
          logging:
            config.get<string>('NODE_ENV') === 'development'
              ? (['error', 'warn'] as any)
              : (['error'] as any),
          extra: { max: 20 },
        };
        if (url) {
          base.url = url;
        } else {
          base.host = config.get<string>('database.host');
          base.port = config.get<number>('database.port');
          base.username = config.get<string>('database.username');
          base.password = config.get<string>('database.password');
          base.database = config.get<string>('database.database');
        }
        return base;
      },
    }),
    MinioModule,
    AuthModule,
    WalletModule,
    DailyTasksModule,
    SurveyModule,
    ReviewsModule,
    ConsensusModule,
    CatalogModule,
    ModerationModule,
    NotificationsModule,
    RevalidationModule,
    PaymentsModule,
    AdminModule,
    LeaderboardModule,
    PlacesModule,
    GeocodingModule,
    GeolocationModule,
    SignMapModule,
    NavigationModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
