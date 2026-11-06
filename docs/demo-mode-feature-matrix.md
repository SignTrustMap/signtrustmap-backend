# Demo Mode Feature & Traceability Matrix

> **Document Version:** 1.0.0  
> **Target Release:** Clean Review & Production Releases  
> **Repository:** `signtrustmap-backend` & `signtrustmap-frontend`

This document serves as the **single source of truth** mapping all demonstration-specific shortcuts, intentional requirement flaws, and bypassed security controls to their exact code locations, database feature flags, and verification procedures.

Use this matrix whenever preparing a **clean, bugless review release** (e.g., for thesis examination, compliance audits, or production deployment) to certify that all production security controls and business rules are strictly active.

---

## 1. Architectural Overview

Rather than maintaining a divergent `demo` branch that bypasses business rules, all demo shortcuts are governed at runtime by the **Dynamic Feature Flag Switchboard** (`system_feature_flags` table) managed via `@Roles('ADMIN')` endpoints in `AdminController`.

```
                  ┌─────────────────────────────────────────────────────────┐
                  │                 Admin Ops Portal                        │
                  │   apps/ops/src/features/settings/SystemSettingsPage     │
                  └────────────────────────────┬────────────────────────────┘
                                               │
                       PATCH /api/v1/admin/system-switches/:key
                                               │
                                               ▼
                  ┌─────────────────────────────────────────────────────────┐
                  │          AdminController & SystemSwitchService          │
                  │    - In-memory cache (TTL 30s) + PostgreSQL fallback    │
                  │    - Every toggle recorded in `audit_logs` table        │
                  └──────────────┬────────────────────────────┬─────────────┘
                                 │                            │
             isFeatureEnabled()  │                            │ Reads flags
                                 ▼                            ▼
                 ┌──────────────────────────────┐  ┌────────────────────────┐
                 │ Target Services:             │  │ Table:                 │
                 │ - ConsensusService           │  │ `system_feature_flags` │
                 │ - ReviewsService             │  └────────────────────────┘
                 │ - ModerationService          │
                 │ - ReviewsController (Testing)│
                 └──────────────────────────────┘
```

### Master vs. Granular Switches
- **Master Switch (`DEMO_MODE_ACTIVE`)**: When `true`, all demo bypasses cascade to active automatically. When `false`, the system strictly evaluates each granular switch.
- **Strict Production Mode**: All switches in `system_feature_flags` have `is_enabled = false`.

---

## 2. Feature Traceability Matrix

| # | Feature / Flaw | Official Production Rule | Source Code Location | Feature Flag Key | Behavior when Switch is ON (Demo Mode) | Behavior when Switch is OFF (Clean Review Release) | Test Suite Verification |
| :- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | **Consensus Quorum Bypass** | **BR-30 / SEC-20**: Requires quorum ($\ge 3$ reviewer votes) and Bayesian score threshold ($\ge 0.5$ approved, $\le -0.5$ rejected). | [`apps/nestjs/src/modules/consensus/application/consensus.service.ts`](file:///C:/Users/khang/Projects/Capstone/signtrustmap-backend/apps/nestjs/src/modules/consensus/application/consensus.service.ts#L136-L150) | `SINGLE_VOTE_CONSENSUS` | The first reviewer vote ($1$ or $-1$) immediately finalizes the candidate as `APPROVED` or `REJECTED` and updates the live map. | A single vote transitions the candidate to `IN_CONSENSUS`; approval requires meeting the quorum and score threshold. | `npm test -- consensus.service.spec.ts` |
| **2** | **Surveyor Self-Review Bypass (Queue)** | **BR-26 / SEC-18**: Surveyors are strictly prohibited from evaluating their own survey submissions. | [`apps/nestjs/src/modules/reviews/application/reviews.service.ts`](file:///C:/Users/khang/Projects/Capstone/signtrustmap-backend/apps/nestjs/src/modules/reviews/application/reviews.service.ts#L140-L155) | `ALLOW_SELF_REVIEW` | Candidates submitted by the authenticated reviewer appear in their own `/reviews/queue`. | Candidates where `submission.surveyor_id == reviewer.id` are filtered out of the queue. | `npm test -- reviews.service.spec.ts` |
| **3** | **Surveyor Self-Vote Bypass (Voting)** | **BR-26 / SEC-18**: Reviewers cannot vote on candidates originated from their submissions. | [`apps/nestjs/src/modules/reviews/application/reviews.service.ts`](file:///C:/Users/khang/Projects/Capstone/signtrustmap-backend/apps/nestjs/src/modules/reviews/application/reviews.service.ts#L215-L225) | `ALLOW_SELF_REVIEW` | Reviewers can cast approval/rejection votes on their own candidates. | Throws `403 ForbiddenException` ("You cannot review sign candidates from your own survey submission"). | `npm test -- reviews.service.spec.ts` |
| **4** | **Recapture Self-Request Bypass** | **BR-26**: Reviewers cannot initiate recapture quests on candidates from their own submissions. | [`apps/nestjs/src/modules/reviews/presentation/reviews.controller.ts`](file:///C:/Users/khang/Projects/Capstone/signtrustmap-backend/apps/nestjs/src/modules/reviews/presentation/reviews.controller.ts#L200-L215) and [`reviews.service.ts`](file:///C:/Users/khang/Projects/Capstone/signtrustmap-backend/apps/nestjs/src/modules/reviews/application/reviews.service.ts#L1405-L1415) | `ALLOW_SELF_REVIEW` | Any authenticated user or demo surveyor can request recaptures on their own candidates. | Throws `403 ForbiddenException` unless the user holds the system `ADMIN` role. | `npm test -- reviews.service.spec.ts` |
| **5** | **Recapture GPS Geofence Bypass** | Discovery and consumption of recaptures requires the surveyor to be physically present within 1,500m of the sign. | [`apps/nestjs/src/modules/reviews/application/reviews.service.ts`](file:///C:/Users/khang/Projects/Capstone/signtrustmap-backend/apps/nestjs/src/modules/reviews/application/reviews.service.ts#L1755-L1935) | `BYPASS_RECAPTURE_GEOFENCE` | Bypasses `ST_DistanceSphere` spatial checks; presenter can discover, claim, and submit recaptures from any location. | Strictly enforces GPS distance limit against the candidate's estimated location. Returns 0 nearby quests if out of range. | `npm test -- reviews.service.spec.ts` |
| **6** | **Target Surveyor Auto-Routing** | Recapture quests are open quests claimed organically on a first-come basis by nearby surveyors. | [`apps/nestjs/src/modules/moderation/application/moderation.service.ts`](file:///C:/Users/khang/Projects/Capstone/signtrustmap-backend/apps/nestjs/src/modules/moderation/application/moderation.service.ts#L1295-L1310), [`reviews.service.ts`](file:///C:/Users/khang/Projects/Capstone/signtrustmap-backend/apps/nestjs/src/modules/reviews/application/reviews.service.ts#L1415-L1430) | `AUTO_ASSIGN_RECAPTURE_EMAIL` | Automatically assigns new recaptures to a designated surveyor (e.g. `demo@stm.dev`) and sends instant push notification. | `surveyor_id` is set to `NULL`; quest is placed in the open public quest pool. | `npm test -- moderation.service.spec.ts` |
| **7** | **Testing Injection Utilities** | All state changes and review logs must follow audited consensus cycles. | [`apps/nestjs/src/modules/reviews/presentation/reviews.controller.ts`](file:///C:/Users/khang/Projects/Capstone/signtrustmap-backend/apps/nestjs/src/modules/reviews/presentation/reviews.controller.ts#L310-L345) (`POST /reviews/test-review` & `POST /reviews/test-assign`) | `ENABLE_TEST_UTILITY_ENDPOINTS` | Admins can directly inject reviews, reset candidate statuses, and assign candidates to specific queues. | Endpoints throw `403 ForbiddenException` ("Testing utility endpoints are disabled in production mode"). | `npm test -- reviews.controller.spec.ts` |

---

## 3. Retained Production Bugfixes (Category A)

The following fixes from the original `demo` branch are **permanent production improvements** and must **never** be removed during clean releases:

1. **Global TypeORM Exception Filter** (`apps/nestjs/src/common/filters/typeorm-exception.filter.ts`):
   Catches database constraint violations, invalid UUIDs, and foreign key errors and returns a 400 Bad Request instead of an unhandled 500 error.
2. **FastAPI PostgreSQL Enum Literal Typing** (`apps/fastapi/app/models/pipeline.py`):
   Explicitly declares PostgreSQL enum string literals (`submission_status`, `candidate_status`, `ai_model_type`, etc.) preventing SQLAlchemy runtime query failures.
3. **Spatial Admin Query Bounds Clamping** (`apps/nestjs/src/modules/reviews/presentation/spatial-admin.controller.ts`):
   Clamps query parameters `limit` [1..100], `batchSize` [1..1000], and `maxTotal` [1..50000] preventing memory exhaustion attacks.
4. **Schemathesis Fuzzing Hardening** (`apps/nestjs/src/modules/*` DTOs and `infra/schemathesis/run-tests.sh`):
   Guards all endpoints against malformed coordinates, invalid date formats, and out-of-range numerical values.
5. **Global Candidate Review History for Staff** (`apps/nestjs/src/modules/reviews/presentation/reviews.controller.ts`):
   Allows ADMIN and STAFF to query candidate review histories across all reviewers via `GET /reviews/history` and `GET /reviews/candidates`.

---

## 4. Pre-Flight Clean Review Release Checklist

Run the following checks before tagging or deploying a review/evaluation release:

### 1. Database Feature Flag Audit
Verify all switches in PostgreSQL are `false`:
```sql
SELECT key, name, is_enabled 
FROM system_feature_flags 
WHERE is_enabled = true;
```
*Expected Result:* `0 rows returned`.

If any rows are returned, reset them with one command:
```sql
UPDATE system_feature_flags SET is_enabled = false;
```
Or via the authenticated Admin API:
```bash
curl -X POST https://api.signtrustmap.dev/api/v1/admin/system-switches/demo-mode/disable \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

### 2. Environment Variables Sanitation
Verify that no demo override flags are present in deployment environment files:
```bash
grep -rn "DEMO_MODE=true" .env* docker-compose*
grep -rn "ALLOW_SELF_REVIEW=true" .env* docker-compose*
```
*Expected Result:* No occurrences (or set explicitly to `false`).

### 3. Application Source Audit (Zero Hardcoded Demo Accounts)
Verify that no hardcoded `demo@stm.dev` emails remain in business logic services:
```bash
grep -rn "demo@stm.dev" apps/nestjs/src/modules/
```
*Expected Result:* Only appears as optional fallback in metadata configuration, never in raw SQL `WHERE` clauses.

### 4. Automated Test Verification Gate
Execute the full automated test suite to ensure all strict quorums and authorization checks are passing:
```bash
# In signtrustmap-backend:
npm test
npm run test:e2e
```
