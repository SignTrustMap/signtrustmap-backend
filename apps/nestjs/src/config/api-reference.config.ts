import { INestApplication } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import { SCALAR_CONFIGURATION } from './scalar.config';
import {
  API_REFERENCE_PATH,
  buildOpenApiConfig,
  OPENAPI_JSON_PATH,
  sanitizeOpenApiDocument,
} from './swagger.config';

export function setupApiReference(app: INestApplication): void {
  let document = SwaggerModule.createDocument(app, buildOpenApiConfig());
  document = sanitizeOpenApiDocument(document);

  SwaggerModule.setup(API_REFERENCE_PATH, app, document, {
    jsonDocumentUrl: OPENAPI_JSON_PATH,
    swaggerUiEnabled: false,
  });

  app.use(`/${API_REFERENCE_PATH}`, apiReference(SCALAR_CONFIGURATION));
}
