# 05 — Security, Authentication & RBAC Conventions

This guide defines how authentication, authorization, role-based access control (RBAC), and internal service-to-service security are enforced.

---

## 1. Authentication by Default (NestJS)

NestJS registers `JwtAuthGuard` and `RolesGuard` globally in [`app.module.ts`](../../apps/nestjs/src/app.module.ts):
```typescript
providers: [
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
]
```

### The Rule:
- **Every endpoint is protected by default** with JWT bearer authentication (`Authorization: Bearer <TOKEN>`).
- If an endpoint is meant to be accessible without logging in, you **MUST** decorate it with `@Public()`.

```typescript
// ❌ WRONG: Endpoint fails with 401 Unauthorized for anonymous users
@Get('catalog/categories')
getCategories() { ... }

// ✅ CORRECT: Anonymous users can fetch the catalog
@Public()
@Get('catalog/categories')
getCategories() { ... }
```

---

## 2. Role-Based Access Control (RBAC)

The platform defines 5 primary user roles:
1. `DRIVER` (Default mobile app user)
2. `SURVEYOR` (Dashcam video contributor)
3. `REVIEWER` (Community traffic sign validator)
4. `STAFF` (Platform moderator / operations)
5. `ADMIN` (Full administrative privileges)

### Role Decorator Usage:
```typescript
// Requires ADMIN or STAFF role
@Roles('ADMIN', 'STAFF')
@Patch('catalog/sign-types/:id/support-shots/:imageId/pin')
togglePin(@Param('id') id: number) { ... }
```

---

## 3. Internal Service-to-Service Security (`InternalTokenGuard`)

Certain endpoints are called directly by internal background workers (FastAPI, Celery, or AI Jetson Orin) rather than end-users:
- Example: AI worker reporting candidate extraction complete (`POST /api/v1/submissions/internal/batch/:id/complete`)
- Example: Navigation engine deducting session fees (`POST /api/v1/wallet/internal/deduct`)

### Mandatory Pattern for Internal Endpoints:
Internal endpoints must bypass user JWT checks using `@Public()` but **MUST** enforce the `InternalTokenGuard`:

```typescript
@Public() // Bypasses user JWT requirement
@UseGuards(InternalTokenGuard) // Validates X-Internal-Token header against ${INTERNAL_TOKEN}
@Post('internal/batch/:batchId/complete')
async completeBatch(
  @Param('batchId', ParseUUIDPipe) batchId: string,
  @Body() dto: CompleteBatchSurveyDto,
) {
  return this.batchService.completeBatch(batchId, dto);
}
```

### Calling Internal Endpoints from FastAPI / Python:
```python
headers = {
    "X-Internal-Token": settings.INTERNAL_API_TOKEN,
    "Content-Type": "application/json",
}
async with httpx.AsyncClient() as client:
    response = await client.post(f"{settings.NESTJS_INTERNAL_URL}/api/v1/wallet/internal/deduct", json=payload, headers=headers)
```
