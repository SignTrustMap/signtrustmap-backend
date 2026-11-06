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

function cleanArrayEnums(schema: any): void {
  if (!schema || typeof schema !== 'object') return;
  if (schema.type === 'array' && schema.enum && schema.items) {
    delete schema.enum;
  }
  if (schema.properties && typeof schema.properties === 'object') {
    for (const prop of Object.values(schema.properties)) {
      cleanArrayEnums(prop);
    }
  }
  if (schema.items && typeof schema.items === 'object') {
    cleanArrayEnums(schema.items);
  }
}

/**
 * Post-processes the OpenAPI document:
 * 1. Sets additionalProperties: false ONLY on standalone object schemas with explicit properties
 *    (skipping schemas using composition like allOf/oneOf/anyOf and freeform maps) to prevent
 *    schema validation mismatch errors in Schemathesis while avoiding composition conflicts.
 * 2. Enforces OpenAPI 3.0 contract requirements: path parameters MUST have required: true,
 *    and every operation MUST provide at least one response definition.
 * 3. Removes conflicting top-level enum constraints from array schemas (where enum belongs on items),
 *    preventing Schemathesis "Nothing satisfies type: array and enum" schema generation errors.
 */
export function sanitizeOpenApiDocument(doc: OpenAPIObject): OpenAPIObject {
  if (doc.components?.schemas) {
    for (const schema of Object.values(doc.components.schemas) as any[]) {
      if (schema && typeof schema === 'object') {
        cleanArrayEnums(schema);
        if (
          schema.type === 'object' &&
          schema.properties &&
          Object.keys(schema.properties).length > 0 &&
          !schema.allOf &&
          !schema.oneOf &&
          !schema.anyOf &&
          schema.additionalProperties === undefined
        ) {
          schema.additionalProperties = false;
        }
      }
    }
  }
  if (doc.paths) {
    for (const [, pathItem] of Object.entries(doc.paths)) {
      if (!pathItem || typeof pathItem !== 'object') continue;
      const httpMethods = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'] as const;
      for (const method of httpMethods) {
        const operation = (pathItem as any)[method];
        if (operation && typeof operation === 'object') {
          // OpenAPI 3.0 mandate: operations must define at least one response
          if (!operation.responses || Object.keys(operation.responses).length === 0) {
            operation.responses = { '200': { description: 'Successful operation' } };
          }
          // OpenAPI 3.0 mandate: path parameters MUST have required: true
          if (Array.isArray(operation.parameters)) {
            for (const param of operation.parameters) {
              if (param && param.in === 'path') {
                param.required = true;
              }
              if (param?.schema) {
                cleanArrayEnums(param.schema);
              }
            }
          }
          if (operation.requestBody?.content) {
            for (const mediaType of Object.values(operation.requestBody.content) as any[]) {
              if (mediaType?.schema) {
                cleanArrayEnums(mediaType.schema);
              }
            }
          }
        }
      }
      // Also check top-level parameters for the path item
      if (Array.isArray((pathItem as any).parameters)) {
        for (const param of (pathItem as any).parameters) {
          if (param && param.in === 'path') {
            param.required = true;
          }
        }
      }
    }

    // Add deterministic links for collection -> detail operations to eliminate 404s in Schemathesis stateful fuzzing
    const catalogCategories = doc.paths['/api/v1/catalog/categories'] || doc.paths['/catalog/categories'];
    if (catalogCategories?.get?.responses?.['200']) {
      (catalogCategories.get.responses['200'] as any).links = {
        GetCategoryById: {
          operationId: 'CatalogController_getCategory',
          parameters: { id: '$response.body#/0/id' },
          description: 'The id property from any category can be used as path param id.',
        },
      };
    }

    const catalogSignTypes = doc.paths['/api/v1/catalog/sign-types'] || doc.paths['/catalog/sign-types'];
    if (catalogSignTypes?.get?.responses?.['200']) {
      (catalogSignTypes.get.responses['200'] as any).links = {
        GetSignTypeById: {
          operationId: 'CatalogController_getSignType',
          parameters: { id: '$response.body#/0/id' },
          description: 'The id property from any sign type can be used as path param id.',
        },
      };
    }
  }

  return doc;
}
