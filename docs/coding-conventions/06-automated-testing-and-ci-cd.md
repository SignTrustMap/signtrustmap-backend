# 06 — Automated Testing & CI/CD Conventions

This guide defines test suites, code quality rules, and automated failure detection standards.

---

## 1. Automated Failure Testing (Schemathesis Sentinel)

An automated Sentinel runs continuously in Coolify, generating property-based fuzz tests against all endpoints in **NestJS Core** (`/docs-json`) and **FastAPI Spatial** (`/openapi.json`).

### The Golden Rule of Error Handling:
> **A `500 Internal Server Error` is ALWAYS a bug.**

- When an invalid, malformed, out-of-range, or malicious payload is sent:
  - ✅ **EXPECTED:** The server catches it and returns a clean `400 Bad Request`, `401 Unauthorized`, `403 Forbidden`, `404 Not Found`, or `422 Unprocessable Entity`.
  - ❌ **FAILURE:** The server throws an unhandled exception or database crash, returning `500 Internal Server Error`.
- Schemathesis asserts `not_a_server_error` on every endpoint. If any endpoint returns `500`, Schemathesis triggers an alert directly to Discord with the exact reproduction `curl` command.

---

## 2. Zero ESLint Warnings Policy (NestJS)

In [`apps/nestjs/package.json`](../../apps/nestjs/package.json):
```json
"lint": "eslint \"src/**/*.ts\" --max-warnings=0"
```
The GitHub Actions CI pipeline fails the build if **even one warning** exists:
- No unused variables (`no-unused-vars`).
- No implicit or raw `any` types where avoidable.
- Run `npm run lint` locally before pushing to git.

---

## 3. Test Suites & Coverage Thresholds

### NestJS (Jest + Supertest):
- Run unit tests: `npm run test`
- Run coverage: `npm run test:cov`
- Run E2E tests: `npm run test:e2e`

### FastAPI (Pytest + HTTPX AsyncClient):
- Run test suite: `pytest`
- Pytest fixtures use `httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test")` to test async route handlers without needing live network sockets.

---

## 4. Pre-Commit / Pre-Deployment Checklist

Before merging a branch or deploying to Coolify:

1. [ ] **Build Check**: `npm run build` in `apps/nestjs` succeeds with 0 errors.
2. [ ] **Lint Check**: `npm run lint` has 0 warnings.
3. [ ] **Python Check**: `python -m py_compile app/main.py` passes without syntax errors.
4. [ ] **Public Route Check**: Did you add `@Public()` to any unauthenticated endpoint or health probe?
5. [ ] **DTO Check**: Are all `@Body()` parameters typed with formal classes (no inline `{}` types)?
6. [ ] **Gateway Check**: Did you add any new FastAPI or AI route prefix to `nginx.conf`?
7. [ ] **Schemathesis Check**: Run a quick local scan:
   ```bash
   st run http://localhost:3000/docs-json -c not_a_server_error -n 10
   ```
