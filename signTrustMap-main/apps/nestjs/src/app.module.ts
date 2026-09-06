import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_GUARD } from '@nestjs/core';
import databaseConfig, {
  geocodingConfig,
  jwtConfig,
  minioConfig,
  routingConfig,
} from './config/configuration';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { AuthModule } from './modules/auth/auth.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { DailyTasksModule } from './modules/daily-tasks/daily-tasks.module';
import { StorageModule } from './modules/storage/storage.module';
import { SurveyModule } from './modules/survey/survey.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { ModerationModule } from './modules/moderation/moderation.module';
import { RevalidationModule } from './modules/revalidation/revalidation.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { User } from './entities/user.entity';
import { Role } from './entities/role.entity';
import { UserRole } from './entities/user-role.entity';
import { Wallet } from './entities/wallet.entity';
import { CreditTransaction } from './entities/credit-transaction.entity';
import { DailyTask } from './entities/daily-task.entity';
import { DailyTaskCompletion } from './entities/daily-task-completion.entity';
import { TopupPackage } from './entities/topup-package.entity';
import { PaymentOrder } from './entities/payment-order.entity';
import { PaymentCallback } from './entities/payment-callback.entity';
import { SignCategory } from './entities/sign-category.entity';
import { TrafficSignType } from './entities/traffic-sign-type.entity';
import { SystemParameter } from './entities/system-parameter.entity';
import { SurveySubmission } from './entities/survey-submission.entity';
import { SubmissionMediaFile } from './entities/submission-media-file.entity';
import { UploadSession } from './entities/upload-session.entity';
import { UploadChunk } from './entities/upload-chunk.entity';
import { UnverifiedSignCandidate } from './entities/unverified-sign-candidate.entity';
import { CandidateReview } from './entities/candidate-review.entity';
import { ModerationCase } from './entities/moderation-case.entity';
import { ModerationAction } from './entities/moderation-action.entity';
import { MissingSignTypeReport } from './entities/missing-sign-type-report.entity';
import { RevalidationTask } from './entities/revalidation-task.entity';
import { RevalidationEvidence } from './entities/revalidation-evidence.entity';
import { RevalidationDecision } from './entities/revalidation-decision.entity';
import { ConsensusConfig } from './entities/consensus-config.entity';
import { ConsensusLog } from './entities/consensus-log.entity';
import { Notification } from './entities/notification.entity';
import { PaymentMethod } from './entities/payment-method.entity';
import { SavedPlace } from './entities/saved-place.entity';
import { RecentSearch } from './entities/recent-search.entity';
import { ReviewFlag } from './entities/review-flag.entity';
import { ConsensusModule } from './modules/consensus/consensus.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AdminModule } from './modules/admin/admin.module';
import { LeaderboardModule } from './modules/leaderboard/leaderboard.module';
import { PlacesModule } from './modules/places/places.module';
import { GeocodingModule } from './modules/geocoding/geocoding.module';
import { RoutingModule } from './modules/routing/routing.module';



@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, jwtConfig, minioConfig, geocodingConfig, routingConfig],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('database.url');
        const base: any = {
          type: 'postgres' as const,
          entities: [
            User,
            Role,
            UserRole,
            Wallet,
            CreditTransaction,
            DailyTask,
            DailyTaskCompletion,
            TopupPackage,
            PaymentOrder,
            PaymentCallback,
            SignCategory,
            TrafficSignType,
            SystemParameter,
            SurveySubmission,
            SubmissionMediaFile,
            UploadSession,
            UploadChunk,
            UnverifiedSignCandidate,
            CandidateReview,
            ModerationCase,
            ModerationAction,
            MissingSignTypeReport,
            RevalidationTask,
            RevalidationEvidence,
            RevalidationDecision,
            ConsensusConfig,
            ConsensusLog,
            Notification,
            PaymentMethod,
            SavedPlace,
            RecentSearch,
            ReviewFlag,
          ],
          synchronize: false,
          logging: config.get<string>('NODE_ENV') === 'development' ? (['error', 'warn'] as any) : (['error'] as any),
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
    StorageModule,
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
    RoutingModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
