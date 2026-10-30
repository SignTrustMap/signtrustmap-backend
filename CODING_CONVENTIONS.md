# SignTrustMap Coding Conventions for AI Models & Developers

All code modifications in this codebase must comply with the rules documented in **[`docs/coding-conventions/`](./docs/coding-conventions/README.md)**.

## Key Directives for AI Agents & Developers:

1. **DTOs & OpenAPI**:
   - Always use formal class DTOs with `class-validator` and `@nestjs/swagger` decorators (`@ApiProperty()`).
   - Never use inline TypeScript types `{ foo: string }` for `@Body()` or `@Query()`.
   - Never let raw RegExp slashes leak into Swagger (always specify clean pattern without slashes in `@ApiProperty`).
   - See: [`docs/coding-conventions/01-api-and-dto-conventions.md`](./docs/coding-conventions/01-api-and-dto-conventions.md)

2. **Healthchecks & Probes**:
   - Every health check in NestJS MUST be decorated with `@Public()`.
   - Never remove `@Public()` from health routes; doing so will cause Docker and Coolify to kill and restart containers.
   - See: [`docs/coding-conventions/02-healthchecks-and-monitoring.md`](./docs/coding-conventions/02-healthchecks-and-monitoring.md)

3. **API Gateway & Routing**:
   - When adding new top-level subpaths to FastAPI (`/api/v1/spatial/...`) or AI (`/api/v1/models/...`), update the Nginx regular expression in `signtrustmap-backend/infra/gateway/nginx.conf`.
   - See: [`docs/coding-conventions/03-gateway-and-routing.md`](./docs/coding-conventions/03-gateway-and-routing.md)

4. **Database & Workers**:
   - Never use `asyncpg` inside synchronous Celery worker tasks; use synchronous `psycopg`.
   - TypeORM is strictly `synchronize: false` in production.
   - See: [`docs/coding-conventions/04-database-and-async-workers.md`](./docs/coding-conventions/04-database-and-async-workers.md)

5. **Security & RBAC**:
   - NestJS routes are authenticated by default via global `APP_GUARD`.
   - Internal service-to-service endpoints require `@Public()` and `@UseGuards(InternalTokenGuard)`.
   - See: [`docs/coding-conventions/05-security-auth-and-rbac.md`](./docs/coding-conventions/05-security-auth-and-rbac.md)

6. **Error Handling & Fuzzing**:
   - `500 Internal Server Error` is ALWAYS considered a bug. All input edge cases must return clean `4xx` error codes.
   - Schemathesis runs continuously in production and alerts Discord on any 500 status code.
   - Zero ESLint warnings policy (`--max-warnings=0`).
   - See: [`docs/coding-conventions/06-automated-testing-and-ci-cd.md`](./docs/coding-conventions/06-automated-testing-and-ci-cd.md)
