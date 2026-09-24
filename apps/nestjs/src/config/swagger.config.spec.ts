import {
  API_REFERENCE_PATH,
  buildOpenApiConfig,
  OPENAPI_JSON_PATH,
  OPENAPI_TAGS,
} from './swagger.config';
import { SCALAR_CONFIGURATION } from './scalar.config';

describe('API documentation configuration', () => {
  it('publishes API metadata and both authentication schemes', () => {
    const config = buildOpenApiConfig();

    expect(config.info).toMatchObject({
      title: 'SignTrustMap API',
      version: '1.0',
    });
    expect(config.components?.securitySchemes).toMatchObject({
      bearer: { type: 'http', scheme: 'bearer' },
      'internal-token': {
        type: 'apiKey',
        name: 'X-Internal-Token',
        in: 'header',
      },
    });
    expect(API_REFERENCE_PATH).toBe('docs');
    expect(OPENAPI_JSON_PATH).toBe('docs-json');
  });

  it('defines a unique, explained tag for every API feature group', () => {
    const config = buildOpenApiConfig();
    const expectedTags = OPENAPI_TAGS.map((tag) => ({ ...tag }));
    const tagNames = expectedTags.map((tag) => tag.name);

    expect(config.tags).toEqual(expectedTags);
    expect(new Set(tagNames).size).toBe(tagNames.length);
    expect(tagNames).not.toContain('default');
    expect(expectedTags.every((tag) => tag.description.length > 0)).toBe(true);
  });

  it('configures Scalar as the interactive API reference', () => {
    expect(SCALAR_CONFIGURATION).toMatchObject({
      url: '/docs-json',
      pageTitle: 'SignTrustMap API Reference',
      theme: 'default',
      layout: 'modern',
      showSidebar: true,
      persistAuth: true,
      telemetry: false,
    });
  });
});
