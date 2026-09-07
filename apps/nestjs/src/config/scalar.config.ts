import type { NestJSReferenceConfiguration } from '@scalar/nestjs-api-reference';
import { OPENAPI_JSON_PATH } from './swagger.config';

export const SCALAR_CONFIGURATION = {
  url: `/${OPENAPI_JSON_PATH}`,
  pageTitle: 'SignTrustMap API Reference',
  favicon: 'data:,',
  cdn: 'https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.68.0',
  theme: 'default',
  layout: 'modern',
  darkMode: false,
  showSidebar: true,
  hideModels: false,
  hideDownloadButton: false,
  persistAuth: true,
  telemetry: false,
  defaultHttpClient: {
    targetKey: 'js',
    clientKey: 'fetch',
  },
} satisfies NestJSReferenceConfiguration;
