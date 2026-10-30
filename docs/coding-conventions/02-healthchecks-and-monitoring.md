# 02 — Healthchecks & Uptime Probing Conventions

This guide defines the mandatory rules for healthchecks, liveness probes, readiness probes, and Prometheus Blackbox monitoring across all SignTrustMap services.

---

## 1. The `@Public()` Rule for Health Endpoints (NestJS)

NestJS enforces authentication by default across all routes via global `APP_GUARD: JwtAuthGuard`.

> [!CAUTION]
> If a developer creates a healthcheck route and forgets `@Public()`, Docker healthchecks and Prometheus probes will receive `401 Unauthorized`. Coolify and Docker will mark the container `UNHEALTHY` and continuously restart or kill it!

```typescript
// ❌ CRITICAL BUG: Docker container will be killed by Coolify healthcheck
@Controller('health')
export class HealthController {
  @Get()
  check() { return { status: 'ok' }; }
}

// ✅ CORRECT: Explicitly public
@ApiTags('Health')
@Public()
@Controller('health')
export class HealthController {
  @Get()
  liveness() { return this.healthService.liveness(); }

  @Get('ready')
  readiness() { return this.healthService.readiness(); }
}
```

---

## 2. Liveness vs. Readiness Probes

Every backend service must provide both probes:

| Probe Type | Endpoint | What it verifies | Failure Action |
| :--- | :--- | :--- | :--- |
| **Liveness** | `/health` (or `/api/v1/health`) | Process is running and accepting event loop ticks | Restart container if deadlocked |
| **Readiness** | `/api/v1/health/ready` | Outgoing dependencies (PostgreSQL `SELECT 1`, Redis PING) are reachable | Stop routing ingress traffic until DB recovers |

### Implementation standard in NestJS:
```typescript
async readiness(): Promise<HealthResponse> {
  try {
    await this.dataSource.query('SELECT 1');
    return { status: 'ready', checks: { database: 'up' } };
  } catch (error) {
    throw new ServiceUnavailableException({
      status: 'unavailable',
      checks: { database: 'down' }
    });
  }
}
```

---

## 3. Standard Service Healthcheck Endpoints

| Service | Internal URL | Container Health Command | Gateway Route |
| :--- | :--- | :--- | :--- |
| **Gateway (Nginx)** | `http://127.0.0.1:80/health` | `wget -q -O - http://127.0.0.1:80/health \|\| exit 1` | `https://api.signmap.site/health` |
| **NestJS Core API** | `http://127.0.0.1:3000/api/v1/health/ready` | `wget -q -O - http://127.0.0.1:3000/api/v1/health/ready \|\| exit 1` | `https://api.signmap.site/api/v1/health/ready` |
| **FastAPI Spatial** | `http://127.0.0.1:8000/health` | `curl -f http://127.0.0.1:8000/health \|\| exit 1` | `https://api.signmap.site/api/v1/spatial/health` |
| **Jetson Orin AI** | `http://ai-inference:8000/health` | `curl -f http://localhost:8000/health \|\| exit 1` | `https://ai.signmap.site/health` |

---

## 4. Container Image Health Tools

- Minimal Alpine images for Node/NestJS include `wget` by default, but **not** `curl`. Use `wget -q -O - ...`.
- Python slim/alpine images include Python standard library (`urllib.request`) and `curl`.
- Never use external dependencies (e.g. `npm test` or bash-specific syntax in `sh`) inside Docker `HEALTHCHECK` commands.
