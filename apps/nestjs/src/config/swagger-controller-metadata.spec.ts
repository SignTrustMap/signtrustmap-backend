import 'reflect-metadata';
import { AdminController } from '../modules/admin/admin.controller';
import { AuthController } from '../modules/auth/presentation/auth.controller';
import { CatalogController } from '../modules/catalog/catalog.controller';
import { DailyTasksController } from '../modules/daily-tasks/daily-tasks.controller';
import { GeocodingController } from '../modules/geocoding/presentation/geocoding.controller';
import { SignGeolocationController } from '../modules/geolocation/presentation/sign-geolocation.controller';
import { HealthController } from '../modules/health/presentation/health.controller';
import { LeaderboardController } from '../modules/leaderboard/leaderboard.controller';
import { ModerationController } from '../modules/moderation/presentation/moderation.controller';
import { NavigationController } from '../modules/navigation/presentation/navigation.controller';
import { RoutingController } from '../modules/navigation/presentation/routing.controller';
import { NotificationsController } from '../modules/notifications/notifications.controller';
import { PaymentsController } from '../modules/payments/presentation/payments.controller';
import { PlacesController } from '../modules/places/places.controller';
import { RevalidationController } from '../modules/revalidation/presentation/revalidation.controller';
import { ReviewsController } from '../modules/reviews/presentation/reviews.controller';
import { VerifiedSignController } from '../modules/sign-map/presentation/verified-sign.controller';
import { CameraProfileController } from '../modules/survey/presentation/camera-profile.controller';
import { SurveyController } from '../modules/survey/presentation/survey.controller';
import { WalletController } from '../modules/wallet/presentation/wallet.controller';
import { OPENAPI_TAGS } from './swagger.config';

const API_TAGS_METADATA = 'swagger/apiUseTags';
const API_OPERATION_METADATA = 'swagger/apiOperation';
const ROUTE_METHOD_METADATA = 'method';

const CONTROLLER_GROUPS = [
  { controller: AuthController, tag: 'Auth' },
  { controller: WalletController, tag: 'Wallet' },
  { controller: PlacesController, tag: 'Places' },
  { controller: GeocodingController, tag: 'Geocoding' },
  { controller: RoutingController, tag: 'Routing' },
  { controller: NavigationController, tag: 'Navigation' },
  { controller: VerifiedSignController, tag: 'Sign Map' },
  { controller: SignGeolocationController, tag: 'Geolocation' },
  { controller: SurveyController, tag: 'Survey Submissions' },
  { controller: CameraProfileController, tag: 'Survey Submissions' },
  { controller: ReviewsController, tag: 'Reviews' },
  { controller: RevalidationController, tag: 'Revalidation' },
  { controller: CatalogController, tag: 'Catalog' },
  { controller: ModerationController, tag: 'Moderation' },
  { controller: DailyTasksController, tag: 'Daily Tasks' },
  { controller: LeaderboardController, tag: 'Leaderboard' },
  { controller: NotificationsController, tag: 'Notifications' },
  { controller: PaymentsController, tag: 'Payments' },
  { controller: AdminController, tag: 'Admin' },
  { controller: HealthController, tag: 'Health' },
];

describe('OpenAPI controller metadata', () => {
  it.each(CONTROLLER_GROUPS)('$controller.name uses the $tag group', ({
    controller,
    tag,
  }) => {
    const configuredTags = OPENAPI_TAGS.map((item) => item.name);

    expect(Reflect.getMetadata(API_TAGS_METADATA, controller)).toEqual([tag]);
    expect(configuredTags).toContain(tag);
  });

  it.each(CONTROLLER_GROUPS)(
    '$controller.name explains each endpoint',
    ({ controller }) => {
      const prototype = controller.prototype as unknown as Record<
        string,
        unknown
      >;
      const routeHandlers = Object.getOwnPropertyNames(prototype)
        .map((name) => prototype[name])
        .filter(
          (handler) =>
            typeof handler === 'function' &&
            Reflect.hasMetadata(ROUTE_METHOD_METADATA, handler),
        );

      expect(routeHandlers.length).toBeGreaterThan(0);

      for (const handler of routeHandlers) {
        const operation = Reflect.getMetadata(
          API_OPERATION_METADATA,
          handler as object,
        ) as { summary?: string; description?: string } | undefined;

        expect(operation?.summary).toBeTruthy();
        expect(operation?.description).toBeTruthy();
      }
    },
  );
});
