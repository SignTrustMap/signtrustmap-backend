# SignTrustMap — Developer & AI Model Coding Conventions

> **Target Audience:** Future human developers, Cursor, Copilot, Gemini, Claude, and autonomous AI coding agents working on the SignTrustMap codebase.

This directory contains the **non-negotiable coding conventions and architectural constraints** required to ensure that all **Docker healthchecks, automated failure scanners (Schemathesis), and Coolify deployments** continue running without obstruction.

---

## 📚 Conventions Directory Map

| Guide | Description | Key Focus |
| :--- | :--- | :--- |
| [**01 — API, DTO & Schema**](./01-api-and-dto-conventions.md) | Endpoint design, request bodies, and OpenAPI metadata | DTO classes, clean regex, PostgreSQL 32-bit limits, geo-coordinates |
| [**02 — Healthchecks & Monitoring**](./02-healthchecks-and-monitoring.md) | Liveness probes, readiness probes, and Docker container healthchecks | `@Public()` rule, `SELECT 1` readiness, Blackbox Exporter |
| [**03 — Gateway & Routing**](./03-gateway-and-routing.md) | Reverse proxy configuration and traffic routing | Nginx location regex matching, WebSocket upgrades, upload limits |
| [**04 — Database & Workers**](./04-database-and-async-workers.md) | Database connections, ORM lifecycles, and Celery workers | `asyncpg` (FastAPI) vs `psycopg` (Celery), `synchronize: false`, `lifespan` |
| [**05 — Security, Auth & RBAC**](./05-security-auth-and-rbac.md) | Authentication guards, user roles, and internal security | `@Public()` rule, `@Roles()`, `InternalTokenGuard` + `X-Internal-Token` |
| [**06 — Testing & CI/CD**](./06-automated-testing-and-ci-cd.md) | Automated testing, error code rules, and CI verification | Schemathesis failure detection, zero ESLint warnings, Jest & Pytest |

---

## ⚡ The Top 7 Golden Rules (Quick Summary)

1. **Never use inline TypeScript types for `@Body()`:** Always write a formal class DTO with `@ApiProperty()` and `class-validator` decorators. Inline types are erased at runtime and cause requests to be rejected by `ValidationPipe`.
2. **Every health check in NestJS MUST have `@Public()`:** NestJS protects all routes with JWT by default. Omitting `@Public()` on `/health` causes Docker health checks to fail with 401, leading Coolify to continuously kill and restart the container.
3. **Never let JavaScript regex slashes leak into Swagger:** Always supply clean regex patterns without leading/trailing slashes (e.g. `@ApiProperty({ pattern: '^[A-Z]+$' })`).
4. **Constrain integer inputs to PostgreSQL 32-bit limits:** Use `@Max(2147483647)` or `Query(..., le=2147483647)` on integer IDs to prevent unhandled database overflow crashes (500).
5. **Update Nginx when adding new FastAPI or AI route groups:** Nginx routes using explicit regex (`^/api/v1/spatial/(signs|navigation|health|tiles)`). Unmatched routes fall through to NestJS and return `404 Not Found`.
6. **Never use asyncpg in Celery background workers:** Celery tasks run synchronously. Use the synchronous `psycopg` driver (`app.db_sync`).
7. **A `500 Server Error` is ALWAYS considered a bug:** Invalid inputs must be caught and return clean `4xx` error codes (`400`, `401`, `403`, `404`, `422`). Unhandled 500 crashes trigger automated Discord failure alerts via Schemathesis.
