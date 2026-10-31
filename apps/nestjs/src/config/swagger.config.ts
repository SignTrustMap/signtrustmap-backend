import { DocumentBuilder, OpenAPIObject } from '@nestjs/swagger';

export const API_REFERENCE_PATH = 'docs';
export const OPENAPI_JSON_PATH = 'docs-json';

export const OPENAPI_TAGS = [
  {
    name: 'Auth',
    description:
      'Account registration, login, password recovery, OAuth, and profile management.',
  },
  {
    name: 'Wallet',
    description:
      'Credit balances, transaction history, top-ups, and saved payment methods.',
  },
  {
    name: 'Places',
    description: 'Saved destinations and recent place-search history.',
  },
  {
    name: 'Spatial Admin',
    description:
      'Point-in-polygon administrative address resolution (QĐ 19/2025/QĐ-TTg) and spatial unit search.',
  },
  {
    name: 'Routing',
    description:
      'Supported vehicle modes and point-to-point route calculation.',
  },
  {
    name: 'Navigation',
    description:
      'Driver route previews combining directions with verified signs along the route.',
  },
  {
    name: 'Sign Map',
    description:
      'Verified traffic-sign lookup, route proximity search, and staff maintenance.',
  },
  {
    name: 'Geolocation',
    description:
      'Traffic-sign location estimation from camera and device observations.',
  },
  {
    name: 'Survey Submissions',
    description:
      'Dashcam survey upload sessions, video chunks, and AI processing status.',
  },
  {
    name: 'Reviews',
    description:
      'Community review queues, candidate votes, reviewer history, and reports.',
  },
  {
    name: 'Revalidation',
    description:
      'On-site verification tasks, evidence collection, voting, and finalization.',
  },
  {
    name: 'Catalog',
    description:
      'Official traffic-sign categories, sign types, and system parameters.',
  },
  {
    name: 'Moderation',
    description:
      'Missing sign-type reports, moderation cases, and case resolution.',
  },
  {
    name: 'Daily Tasks',
    description:
      'Daily contributor challenges, completion progress, and reward claims.',
  },
  {
    name: 'Leaderboard',
    description: 'Contributor rankings and leaderboard administration.',
  },
  {
    name: 'Notifications',
    description: 'User notification feeds, unread counts, and read status.',
  },
  {
    name: 'Payments',
    description: 'Payment-provider callbacks used to settle wallet top-ups.',
  },
  {
    name: 'Admin',
    description:
      'User administration, roles, account status, audit logs, and data exports.',
  },
  {
    name: 'Health',
    description: 'API liveness and database readiness checks.',
  },
] as const;

export function buildOpenApiConfig(): Omit<OpenAPIObject, 'paths'> {
  const builder = new DocumentBuilder()
    .setTitle('SignTrustMap API')
    .setDescription(
      'Reference documentation for the SignTrustMap platform. Endpoints are grouped by feature; expand a group to browse its operations.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .addApiKey(
      { type: 'apiKey', name: 'X-Internal-Token', in: 'header' },
      'internal-token',
    );

  for (const tag of OPENAPI_TAGS) {
    builder.addTag(tag.name, tag.description);
  }

  return builder.build();
}

/**
 * Post-processes the OpenAPI document to set additionalProperties: false on object schemas
 * if not otherwise configured. This aligns OpenAPI definitions with NestJS ValidationPipe's
 * `forbidNonWhitelisted: true` to prevent schema validation mismatch errors in Schemathesis.
 */
export function sanitizeOpenApiDocument(doc: OpenAPIObject): OpenAPIObject {
  if (doc.components?.schemas) {
    for (const schema of Object.values(doc.components.schemas) as any[]) {
      if (schema && typeof schema === 'object' && schema.type === 'object') {
        if (schema.additionalProperties === undefined) {
          schema.additionalProperties = false;
        }
      }
    }
  }
  return doc;
}
