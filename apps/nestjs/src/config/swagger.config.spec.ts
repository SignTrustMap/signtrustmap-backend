import {
  buildSwaggerConfig,
  SWAGGER_JSON_PATH,
  SWAGGER_PATH,
} from './swagger.config';

describe('Swagger configuration', () => {
  it('publishes API metadata and both authentication schemes', () => {
    const config = buildSwaggerConfig();

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
    expect(SWAGGER_PATH).toBe('docs');
    expect(SWAGGER_JSON_PATH).toBe('docs-json');
  });
});
