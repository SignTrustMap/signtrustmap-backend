import 'reflect-metadata';
import { OpenAPIObject } from '@nestjs/swagger';
import { buildOpenApiConfig, sanitizeOpenApiDocument, OPENAPI_TAGS } from './swagger.config';

describe('Swagger Contract and Schema Validation', () => {
  describe('buildOpenApiConfig', () => {
    it('builds valid OpenAPI metadata with title, version and tags', () => {
      const config = buildOpenApiConfig();
      expect(config.info.title).toBe('SignTrustMap API');
      expect(config.info.version).toBe('1.0');
      expect(config.tags).toBeDefined();
      expect(config.tags?.length).toBe(OPENAPI_TAGS.length);
    });
  });

  describe('sanitizeOpenApiDocument', () => {
    it('sets additionalProperties: false on standalone object schemas with explicit properties', () => {
      const doc: OpenAPIObject = {
        openapi: '3.0.0',
        info: { title: 'Test API', version: '1.0' },
        paths: {},
        components: {
          schemas: {
            UserDto: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                email: { type: 'string' },
              },
            },
          },
        },
      };

      const sanitized = sanitizeOpenApiDocument(doc);
      const userSchema = sanitized.components?.schemas?.UserDto as any;
      expect(userSchema.additionalProperties).toBe(false);
    });

    it('does NOT set additionalProperties: false on polymorphic/composition schemas (allOf, oneOf, anyOf)', () => {
      const doc: OpenAPIObject = {
        openapi: '3.0.0',
        info: { title: 'Test API', version: '1.0' },
        paths: {},
        components: {
          schemas: {
            CompositeDto: {
              type: 'object',
              allOf: [{ $ref: '#/components/schemas/BaseDto' }],
              properties: {
                extra: { type: 'string' },
              },
            },
            UnionDto: {
              type: 'object',
              oneOf: [{ $ref: '#/components/schemas/VariantA' }],
              properties: {
                type: { type: 'string' },
              },
            },
          },
        },
      };

      const sanitized = sanitizeOpenApiDocument(doc);
      const composite = sanitized.components?.schemas?.CompositeDto as any;
      const union = sanitized.components?.schemas?.UnionDto as any;
      expect(composite.additionalProperties).toBeUndefined();
      expect(union.additionalProperties).toBeUndefined();
    });

    it('does NOT set additionalProperties: false on free-form object maps without properties', () => {
      const doc: OpenAPIObject = {
        openapi: '3.0.0',
        info: { title: 'Test API', version: '1.0' },
        paths: {},
        components: {
          schemas: {
            MetadataMap: {
              type: 'object',
            },
          },
        },
      };

      const sanitized = sanitizeOpenApiDocument(doc);
      const metadata = sanitized.components?.schemas?.MetadataMap as any;
      expect(metadata.additionalProperties).toBeUndefined();
    });

    it('enforces required: true on all path parameters per OpenAPI 3.0 contract', () => {
      const doc: OpenAPIObject = {
        openapi: '3.0.0',
        info: { title: 'Test API', version: '1.0' },
        paths: {
          '/users/{id}': {
            get: {
              summary: 'Get user',
              responses: { '200': { description: 'OK' } },
              parameters: [
                {
                  name: 'id',
                  in: 'path',
                  // required was omitted
                } as any,
              ],
            },
          },
        },
      };

      const sanitized = sanitizeOpenApiDocument(doc);
      const param = (sanitized.paths['/users/{id}'].get as any).parameters[0];
      expect(param.required).toBe(true);
    });

    it('ensures every operation has at least one response definition', () => {
      const doc: OpenAPIObject = {
        openapi: '3.0.0',
        info: { title: 'Test API', version: '1.0' },
        paths: {
          '/health': {
            get: {
              summary: 'Check health',
              responses: {},
            },
          },
        },
      };

      const sanitized = sanitizeOpenApiDocument(doc);
      const responses = (sanitized.paths['/health'].get as any).responses;
      expect(Object.keys(responses).length).toBeGreaterThan(0);
      expect(responses['200']).toBeDefined();
    });
  });
});
