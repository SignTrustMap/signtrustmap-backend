import { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  OpenAPIObject,
  SwaggerModule,
} from '@nestjs/swagger';
import { AuthModule } from '../modules/auth/auth.module';
import { WalletModule } from '../modules/wallet/wallet.module';
import { DailyTasksModule } from '../modules/daily-tasks/daily-tasks.module';
import { SurveyModule } from '../modules/survey/survey.module';
import { ReviewsModule } from '../modules/reviews/reviews.module';
import { CatalogModule } from '../modules/catalog/catalog.module';
import { ModerationModule } from '../modules/moderation/moderation.module';
import { RevalidationModule } from '../modules/revalidation/revalidation.module';
import { PaymentsModule } from '../modules/payments/payments.module';
import { NotificationsModule } from '../modules/notifications/notifications.module';
import { AdminModule } from '../modules/admin/admin.module';
import { LeaderboardModule } from '../modules/leaderboard/leaderboard.module';
import { PlacesModule } from '../modules/places/places.module';
import { GeocodingModule } from '../modules/geocoding/geocoding.module';
import { GeolocationModule } from '../modules/geolocation/geolocation.module';
import { NavigationModule } from '../modules/navigation/navigation.module';
import { SignMapModule } from '../modules/sign-map/sign-map.module';
import { HealthModule } from '../modules/health/health.module';

export const SWAGGER_PATH = 'docs';
export const SWAGGER_JSON_PATH = 'docs-json';

export function buildSwaggerConfig(): Omit<OpenAPIObject, 'paths'> {
  return new DocumentBuilder()
    .setTitle('SignTrustMap API')
    .setDescription('SignTrustMap business, geocoding, and routing API')
export function buildSwaggerConfig(titleSuffix = '', descriptionSuffix = ''): Omit<OpenAPIObject, 'paths'> {
  const builder = new DocumentBuilder()
    .setTitle(`SignTrustMap API${titleSuffix ? ` - ${titleSuffix}` : ''}`)
    .setDescription(
      `SignTrustMap business, geocoding, and routing API${descriptionSuffix ? `. ${descriptionSuffix}` : ''}`,
    )
    .setVersion('1.0')
    .addBearerAuth()
    .addApiKey(
      { type: 'apiKey', name: 'X-Internal-Token', in: 'header' },
      'internal-token',
    )
    .build();
    .addTag('Auth', 'User authentication, registration, sessions, and profile management')
    .addTag('Wallet', 'User wallet credits, transactions, and top-up packages')
    .addTag('Routing', 'Turn-by-turn driving route calculations and vehicle modes')
    .addTag('Navigation', 'Live GPS navigation session management and tracking')
    .addTag('Sign Map', 'Verified traffic signs query, bounding-box search, and route signs')
    .addTag('Survey Submissions', 'Dashcam video chunk upload and AI detection pipeline')
    .addTag('Reviews', 'Community review queue, candidate voting, and fraud reporting')
    .addTag('Revalidation', 'On-site sign verification tasks, evidence collection, and consensus')
    .addTag('Catalog', 'Official traffic sign catalog, categories, and system parameters')
    .addTag('Moderation', 'Content reports, missing sign types, and administrative case resolution')
    .addTag('Places', 'Saved places (Home, Work, Favorites) and recent search history')
    .addTag('Geocoding', 'Address search and viewport geocoding via OpenStreetMap Nominatim')
    .addTag('Geolocation', 'Coordinate reverse-geocoding to street signs')
    .addTag('Daily Tasks', 'Daily surveyor reward challenges and task completions')
    .addTag('Leaderboard', 'Community contributor rankings and points')
    .addTag('Notifications', 'In-app user notifications and alerts')
    .addTag('Payments', 'Payment gateway webhook processing')
    .addTag('Admin', 'User management, role assignment, audit logs, and sign export')
    .addTag('Health', 'Service health checks and uptime monitoring');

  return builder.build();
}

export function setupSwagger(app: INestApplication): void {
  const document = SwaggerModule.createDocument(app, buildSwaggerConfig());
  SwaggerModule.setup(SWAGGER_PATH, app, document, {
  const commonOptions = {
    docExpansion: 'none' as const,
    filter: true,
    showRequestDuration: true,
    persistAuthorization: true,
  };

  const allSpecUrls = [
    { url: '/docs-json', name: '🌟 All APIs' },
    { url: '/docs/driver-json', name: '🚗 Driver & Navigation API' },
    { url: '/docs/crowdsourcing-json', name: '📸 Crowdsourcing & Verification API' },
    { url: '/docs/user-json', name: '👤 User, Wallet & Rewards API' },
    { url: '/docs/admin-json', name: '🛡️ Administration API' },
  ];

  // 1. Full All APIs document
  const fullDoc = SwaggerModule.createDocument(app, buildSwaggerConfig());
  SwaggerModule.setup(SWAGGER_PATH, app, fullDoc, {
    jsonDocumentUrl: SWAGGER_JSON_PATH,
    swaggerOptions: { persistAuthorization: true },
    swaggerOptions: {
      ...commonOptions,
      urls: allSpecUrls,
    },
  });

  // 2. Driver & Navigation API
  const driverDoc = SwaggerModule.createDocument(
    app,
    buildSwaggerConfig('Driver & Navigation', 'APIs for routing, GPS navigation, verified signs, and place search'),
    { include: [NavigationModule, SignMapModule, GeolocationModule, GeocodingModule, PlacesModule, HealthModule] },
  );
  SwaggerModule.setup('docs/driver', app, driverDoc, {
    jsonDocumentUrl: 'docs/driver-json',
    swaggerOptions: {
      ...commonOptions,
      urls: allSpecUrls,
    },
  });

  // 3. Crowdsourcing & Verification API
  const crowdDoc = SwaggerModule.createDocument(
    app,
    buildSwaggerConfig('Crowdsourcing & Verification', 'APIs for dashcam video survey uploads, peer reviews, revalidation, and catalog'),
    { include: [SurveyModule, ReviewsModule, RevalidationModule, ModerationModule, CatalogModule] },
  );
  SwaggerModule.setup('docs/crowdsourcing', app, crowdDoc, {
    jsonDocumentUrl: 'docs/crowdsourcing-json',
    swaggerOptions: {
      ...commonOptions,
      urls: allSpecUrls,
    },
  });

  // 4. User, Wallet & Rewards API
  const userDoc = SwaggerModule.createDocument(
    app,
    buildSwaggerConfig('User & Rewards', 'APIs for authentication, wallet transactions, daily tasks, leaderboard, and notifications'),
    { include: [AuthModule, WalletModule, PaymentsModule, DailyTasksModule, LeaderboardModule, NotificationsModule] },
  );
  SwaggerModule.setup('docs/user', app, userDoc, {
    jsonDocumentUrl: 'docs/user-json',
    swaggerOptions: {
      ...commonOptions,
      urls: allSpecUrls,
    },
  });

  // 5. Administration API
  const adminDoc = SwaggerModule.createDocument(
    app,
    buildSwaggerConfig('Administration', 'APIs for user management, role assignment, audit logs, and catalog configuration'),
    { include: [AdminModule, CatalogModule, ModerationModule] },
  );
  SwaggerModule.setup('docs/admin', app, adminDoc, {
    jsonDocumentUrl: 'docs/admin-json',
    swaggerOptions: {
      ...commonOptions,
      urls: allSpecUrls,
    },
  });
}
