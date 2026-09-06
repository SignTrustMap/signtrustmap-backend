# SignTrustMap

Crowdsourced traffic sign mapping with AI verification, gamification, and smart navigation.

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [System Architecture](#system-architecture)
- [Tech Stack](#tech-stack)
- [Setup & Run](#setup--run)
- [Project Structure](#project-structure)
- [API Documentation](#api-documentation)

---

## Overview

SignTrustMap is a platform where surveyors drive routes, record dashcam footage and GPS logs, and upload them for automated AI processing. A multi-stage Celery pipeline (YOLO12 detection, BoT-SORT tracking, CLIP classification) extracts candidate traffic signs from the footage. Community reviewers then vote on each candidate; a configurable consensus engine promotes verified candidates into a live PostGIS map of trusted traffic signs.

Drivers can use the Smart Navigation feature, which streams real-time proximity alerts for verified signs via WebSocket. The system is gamified with a credit wallet, daily tasks, a leaderboard, and in-app notifications. Admins can moderate users, export sign data, and tune system parameters. An Active Learning stub allows an AI teammate to prioritize uncertain candidates for human review.

---

## Key Features

- **Chunked video/GPX upload** — resumable multi-part upload sessions for large dashcam files and GPS tracks.
- **AI detection pipeline** — Celery workers orchestrate a 6-stage pipeline (QUEUED to SYNCHRONIZING to DETECTING to TRACKING to ESTIMATING to CLASSIFYING to COMPLETED). YOLO12/BoT-SORT/CLIP inference stubs are ready for teammate integration.
- **Community review & consensus** — reviewers vote APPROVE/REJECT/UNSURE on sign candidates. Configurable quorum and approval thresholds auto-promote candidates to verified signs.
- **Active Learning integration** — internal endpoints let the AI pipeline set uncertainty-based priority scores so the review queue surfaces the most valuable candidates first.
- **Credit wallet** — every user has a wallet. Survey completions, review votes, and daily tasks credit the wallet; navigation sessions can deduct a fee.
- **Daily tasks** — configurable recurring tasks with claimable credit rewards.
- **Leaderboard** — PostgreSQL materialized view ranked by credits earned, refreshable on demand.
- **Sign revalidation** — periodic freshness scoring triggers revalidation tasks; surveyors submit evidence photos, reviewers vote, staff finalizes the verdict.
- **In-app notifications** — system events (survey complete, consensus reached, rewards, etc.) generate push notifications readable via REST.
- **Spatial GIS map** — FastAPI serves ACTIVE verified signs as GeoJSON FeatureCollection via a bounding-box PostGIS query with GIST index.
- **Smart Navigation** — WebSocket stream delivers real-time sign proximity alerts filtered by heading cone (30 deg) and radius (50 m by default), with route-point buffering and alert deduplication.
- **RBAC** — roles ADMIN, STAFF, SURVEYOR, REVIEWER, DRIVER enforced globally via NestJS guards.
- **Payment integration** — webhook receiver for external payment gateways to top up credit wallets.

---

## System Architecture

```
                            Client (mobile / web / Postman)
                                       |
                    +------------------+------------------+
                    |  HTTP / REST                        |  WebSocket
                    v                                     v
     +----------------------+              +------------------------------+
     |  NestJS API  :3000   |              |  FastAPI GIS  :8000          |
     |  /api/v1/*           |              |  GET  /api/v1/spatial/signs  |
     |  JWT + RBAC guards   |              |  GET  /api/v1/spatial/.../{id}|
     |  14 modules, ~65 ep. |              |  WS   /api/v1/spatial/nav/ws |
     |  TypeORM / pg        |              |  POST/PATCH /nav/sessions    |
     +----------+-----------+              +---------------+--------------+
                |                                        | SQLAlchemy async
                | TypeORM                                v
                v
     +--------------------------------------------------------------+
     |  PostgreSQL 15 + PostGIS  :5432                               |
     |  schema.postgres.sql + schema.addendum.sql  (auto-loaded)    |
     +-----------------------------+------------------+---------------+
                                   |                  |
                    +--------------+                  +--------------+
                    v                                 v
         +----------------+              +-----------------------------+
         | Redis  :6379  |              | Celery workers (4 queues)   |
         | broker  db 2  |              | ai_pipeline  6-stage AI flow|
         | results db 3  |              | freshness    sign scoring   |
         | cache   db 0  |              | leaderboard  matview refresh|
         +----------------+              | default      misc tasks     |
---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Business API | NestJS | 10.x |
| Spatial / GIS API | FastAPI | 0.111.1 |
| Database | PostgreSQL + PostGIS | 15 (custom Docker image) |
| ORM (NestJS) | TypeORM | 0.3.20 |
| Async DB driver | asyncpg | 0.29.0 |
| Sync DB driver | psycopg 3 | 3.1.19 |
| Task queue | Celery | 5.4.0 |
| Message broker / cache | Redis | 7 |
| Object storage | MinIO | latest |
| Auth | JWT + Google OAuth2 | @nestjs/jwt 10, passport-jwt 4 |
| Validation (NestJS) | class-validator / class-transformer | 0.14 / 0.5 |
| Validation (FastAPI) | Pydantic v2 | 2.8.2 |
| Containerization | Docker Compose | v2 |

---

## Setup & Run

### Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Docker Desktop | 4.x+ | Must include Docker Compose v2 |
| Git | any | |
| Node.js + npm | 20+ / 10+ | Only for Option B (local NestJS dev) |
| Python + pip | 3.11+ | Only for Option C (local FastAPI dev) |

### Step 1 — Clone the repository

```bash
git clone <repo-url> signTrustMap
cd signTrustMap
```

On Windows:

```powershell
git clone <repo-url> signTrustMap
cd signTrustMap
```

### Step 2 — Create environment files

**Root `.env`** — controls Docker Compose wiring (passwords, ports, secrets):

```powershell
Copy-Item .env.example .env
# or on macOS/Linux:
cp .env.example .env
```

Open `.env` and review values. Defaults work for local development:

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgres://stm_user:stm_password@localhost:5432/signtrustmap` | NestJS DB connection string |
| `JWT_SECRET` | `dev_jwt_secret_change_me` | Signing key for access tokens — change in production |
| `JWT_EXPIRES_IN` | `7d` | Token lifetime |
| `PORT` | `3000` | NestJS listen port |

### Step 3 — Start with Docker Compose (recommended)

This launches all 8 services — Postgres, Redis, MinIO, MinIO-init (one-time bucket creation), NestJS, FastAPI, Celery worker, and Celery beat — in one command:

```powershell
cd signTrustMap
docker compose up --build -d
```

The first build takes 3-5 minutes. Subsequent starts are much faster.

Verify every service is healthy:

```powershell
docker compose ps
```

Expected output:

```
NAME                  STATUS              PORTS
stm-postgres          Up (healthy)        0.0.0.0:5432->5432/tcp
stm-redis             Up (healthy)        0.0.0.0:6379->6379/tcp
stm-minio             Up (healthy)        0.0.0.0:9000->9000/tcp, 0.0.0.0:9001->9001/tcp
stm-minio-init        Exited (0)          (one-time bucket setup — exit 0 is correct)
stm-nestjs            Up                  0.0.0.0:3000->3000/tcp
stm-fastapi           Up                  0.0.0.0:8000->8000/tcp
stm-celery-worker     Up
stm-celery-beat       Up
```

### Step 4 — Verify the services

NestJS — expect 401 Unauthorized (server is up, credentials are just wrong, which is good):

```powershell
curl http://localhost:3000/api/v1/auth/login `
  -Method POST -ContentType "application/json" `
  -Body '{"email":"x","password":"y"}'
```

NestJS with the **seeded admin** — the container bootstraps 6 roles + one admin user automatically on first `docker compose up` (via `infra/postgres/seed-admin.sql` mounted as `03-seed-admin.sql`):

```powershell
curl http://localhost:3000/api/v1/auth/login `
  -Method POST -ContentType "application/json" `
  -Body '{"email":"admin@stm.dev","password":"Admin@123"}'
# => 200, { "user": { "email":"admin@stm.dev", "roles":["ADMIN"], ... },
#           "accessToken": "...", "refreshToken": "..." }
```

FastAPI — liveness probe:

```powershell
curl http://localhost:8000/health
# {"status":"ok","service":"stm-fastapi","version":"1.0.0","env":"development"}

curl http://localhost:8000/api/v1/health
# identical — version-prefixed alias
```

FastAPI — spatial query (bbox around Hanoi; DB is empty on first boot so expect `total:0`, HTTP 200):

```powershell
curl "http://localhost:8000/api/v1/spatial/signs?min_lat=20.9&max_lat=21.1&min_lon=105.7&max_lon=105.9"
# {"type":"FeatureCollection","features":[],"total":0}
```

MinIO console (optional): open http://localhost:9001 and log in with MINIO_ROOT_USER / MINIO_ROOT_PASSWORD.

View logs for any service:

```powershell
docker compose logs api-nestjs  --tail=80 -f
docker compose logs api-fastapi --tail=80 -f
docker compose logs celery-worker --tail=80 -f
```

### Step 5 — Stop and reset

```powershell
# Stop, keep data volumes
docker compose down

# Stop and wipe all volumes (full database reset — schema, roles, admin all reseed on next up)
docker compose down -v
```

> **Note on `down -v`:** All named volumes (`stm_postgres_data`, `stm_redis_data`, `stm_minio_data`) are destroyed. Next `docker compose up` re-runs `docker-entrypoint-initdb.d/`: extensions → schema → addendum → seed-roles + admin. Use this whenever a schema change or seed change needs to take effect from scratch.

### Step 6 — Publish to your own GitHub repository

The repo is initialized on branch `main` and contains a single initial commit. To publish it to a new (empty) GitHub repo:

```powershell
cd signTrustMap

# 1. Create the remote on github.com first (empty repo, no README/LICENSE/.gitignore),
#    then wire it up locally:
git remote add origin https://github.com/<your-username>/<repo-name>.git
#    or via SSH:
#    git remote add origin git@github.com:<your-username>/<repo-name>.git

# 2. Sanity-check: .env, node_modules/, dist/, venv/ are all listed in .gitignore,
#    so they will not be pushed.
git status --short

# 3. Push the main branch and set it as upstream
git push -u origin main
```

For subsequent work, follow the standard cycle: `git checkout -b feat/xyz` → commit → `git push -u origin feat/xyz` → open a Pull Request on GitHub → merge to `main`.

### Alternative: Run NestJS locally with hot-reload (Option B)

Start only the infrastructure in Docker, run NestJS directly for faster iteration:

```powershell
# 1. Start infra only
docker compose up postgres redis minio minio-init -d

# 2. Install NestJS dependencies (first time only)
cd apps\nestjs
npm install

# 3. Start with hot-reload
npm run start:dev
---

## Project Structure

```
signTrustMap/
├── .env.example                     # Root env template (Docker Compose + local dev)
├── docker-compose.yml               # 8 services: postgres, redis, minio (+minio-init),
│                                    #   api-nestjs, api-fastapi, celery-worker, celery-beat
├── schema.postgres.sql              # Primary DDL (tables, types, enums, indexes)
├── schema.addendum.sql              # Addendum DDL (materialized views, extra indexes)
├── infra/
│   └── postgres/
│       ├── Dockerfile               # PostGIS-enabled Postgres image
│       └── init-extensions.sql      # CREATE EXTENSION postgis, uuid-ossp
├── postman/                         # Postman collections (import into Postman)
│   └── *.postman_collection.json
├── apps/
│   ├── nestjs/                      # NestJS business API (port 3000)
│   │   ├── .env.example
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   └── src/
│   │       ├── main.ts              # Bootstrap, global prefix /api/v1, ValidationPipe, CORS
│   │       ├── app.module.ts        # Root module — TypeORM, global JwtAuthGuard + RolesGuard
│   │       ├── config/
│   │       │   └── configuration.ts # DB / JWT / MinIO config factories
│   │       ├── common/
│   │       │   ├── decorators/      # @Public, @Roles, @CurrentUser
│   │       │   └── guards/          # JwtAuthGuard, RolesGuard, InternalTokenGuard
│   │       ├── entities/            # 25+ TypeORM entities
│   │       │   ├── user.entity.ts
│   │       │   ├── wallet.entity.ts
│   │       │   ├── survey-submission.entity.ts
│   │       │   ├── unverified-sign-candidate.entity.ts
│   │       │   ├── candidate-review.entity.ts
│   │       │   ├── verified-traffic-sign.entity.ts
│   │       │   └── ...
│   │       └── modules/
│   │           ├── admin/           # User management, audit logs, sign export
│   │           ├── auth/            # JWT register/login, Google OAuth2
│   │           ├── catalog/         # Sign categories, sign types, system parameters
│   │           ├── consensus/       # Consensus engine (quorum, approval threshold)
│   │           ├── daily-tasks/     # Daily task definitions and reward claims
│   │           ├── leaderboard/     # Rankings materialized view
│   │           ├── moderation/      # Missing-type reports, moderation cases
│   │           ├── notifications/   # In-app notification delivery
│   │           ├── payments/        # Payment gateway webhook handler
│   │           ├── revalidation/    # Sign freshness revalidation tasks & evidence
│   │           ├── reviews/         # Review queue, voting, Active Learning hooks
│   │           ├── storage/         # MinIO abstraction (upload / presign / delete)
│   │           ├── survey/          # Chunked upload sessions, submission lifecycle
│   │           └── wallet/          # Credit wallet, top-up, deduct
│   └── fastapi/                     # FastAPI spatial + navigation service (port 8000)
│       ├── Dockerfile
│       ├── requirements.txt
│       └── app/
│           ├── main.py              # FastAPI app — CORS, lifespan, /health, /api/v1/health
│           ├── config.py            # Pydantic Settings (DATABASE_URL, nav tuning)
│           ├── database.py          # SQLAlchemy async engine + session factory
│           ├── db_sync.py           # Sync session factory for Celery workers
│           ├── celery_app.py        # Celery app, queue + beat schedule
│           ├── api/
│           │   └── v1/
│           │       ├── router.py    # Aggregates spatial + navigation routers
│           │       ├── spatial.py   # GET /spatial/signs, GET /spatial/signs/{id}
│           │       └── navigation.py# POST/PATCH /navigation/sessions, WS /navigation/ws
│           ├── models/              # SQLAlchemy ORM models (read path)
│           ├── schemas/
│           │   └── spatial.py       # Pydantic request/response schemas
│           └── tasks/
│               ├── ai_pipeline.py   # 6-stage AI submission pipeline
│               ├── freshness.py     # Periodic sign freshness scoring
---

## API Documentation

NestJS endpoints are served at `http://localhost:3000/api/v1`. FastAPI endpoints at `http://localhost:8000/api/v1` (health probe also at `/health`). The global NestJS prefix is `/api/v1`; FastAPI's versioned prefix is the same.

The NestJS OpenAPI documentation is available at `http://localhost:3000/docs`. The raw OpenAPI JSON document is available at `http://localhost:3000/docs-json`.

For Heroku deployments, deploy from the repository root. The root npm workspace installs and builds `apps/nestjs`, and the `web` process starts its compiled application.

**Auth legend**

| Label | Meaning |
|---|---|
| Public | No token required |
| JWT | `Authorization: Bearer <access_token>` |
| Internal | `X-Internal-Token: <INTERNAL_TOKEN>` — service-to-service (Celery to NestJS) |
| ADMIN / STAFF / SURVEYOR / REVIEWER / DRIVER | JWT plus the named role (checked by `RolesGuard`) |

> Tip: import the Postman collection from `postman/` — it contains pre-wired examples for every endpoint below.

### Authentication — `auth`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | Public | Register a new user. Body: `{ email, password, name }` |
| POST | `/auth/login` | Public | Login with email + password. Returns `{ access_token }` |
| GET | `/auth/google` | Public | Redirect to Google OAuth2 consent screen (Passport strategy) |
| GET | `/auth/google/callback` | Public | Google OAuth2 callback — issues JWT on success |
| GET | `/auth/me` | JWT | Get the authenticated user's profile |

### Wallet — `wallet`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/wallet` | JWT | Get own wallet: balance and recent credit transactions |
| POST | `/wallet/top-up` | JWT | Purchase a top-up package. Body: `{ packageId }` |
| POST | `/wallet/internal/deduct` | Internal | Deduct credits (e.g. navigation fee). Body: `{ userId, amount, referenceType?, referenceId?, description? }` |

### Survey Submissions — `submissions`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/submissions/initialize` | JWT | Create an upload session for a dashcam video or GPX file. Returns `sessionId`, `totalChunks`, `expiresAt` |
| POST | `/submissions/:sessionId/chunks` | JWT | Upload one file chunk. Multipart form with field `file` plus `chunkIndex` in body |
| GET | `/submissions/me` | JWT | List own survey submissions. Query: `page`, `pageSize` |
| GET | `/submissions/status/:submissionId` | JWT | Full submission detail: current status, `submission_status_history`, extracted candidates, upload sessions |
| GET | `/submissions/:sessionId` | JWT | Get a single upload session by its ID |
| POST | `/submissions/internal/:submissionId/complete` | Internal | Mark submission COMPLETED, credit surveyor wallet, send notification |
| PATCH | `/submissions/internal/:submissionId/status` | Internal | Advance AI pipeline status. Body: `{ status, note? }`. Allowed: `QUEUED`, `SYNCHRONIZING`, `DETECTING`, `TRACKING`, `ESTIMATING`, `CLASSIFYING`, `COMPLETED`, `PARTIALLY_PROCESSED`, `FAILED`, `PENDING_CORRECTION`, `NO_SIGN_DETECTED` |

### Reviews — `reviews`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/reviews/queue` | JWT | Paginated queue of `PENDING_REVIEW` candidates, sorted by AL priority descending. Query: `page`, `pageSize` (max 100) |
| POST | `/reviews/:candidateId/vote` | JWT | Cast a vote. Body: `{ vote: "APPROVE" \| "REJECT" \| "UNSURE", suggestedSignTypeId? }`. One vote per reviewer per candidate (409 on duplicate). Triggers consensus evaluation |
| GET | `/reviews/internal/unscored-candidates` | Internal | List candidates with default AL priority (not yet scored). Query: `limit` (1-200, default 50) |
| PATCH | `/reviews/internal/:candidateId/active-learning-priority` | Internal | Set AL uncertainty score. Body: `{ priority: 0.0-1.0 }` |
| POST | `/reviews/internal/active-learning-priorities` | Internal | Bulk set AL priorities. Body: `{ items: [{ candidateId, priority }] }` (max 200 items) |
| POST | `/reviews/missing-type` | REVIEWER/ADMIN/STAFF | Report a sign type missing from the catalog |

### Sign Catalog — `catalog` + System Parameters — `admin/system-parameters`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/catalog/categories` | JWT | List all sign categories |
| GET | `/catalog/categories/:id` | JWT | Get a single sign category |
| POST | `/catalog/categories` | ADMIN | Create a sign category |
| PATCH | `/catalog/categories/:id` | ADMIN | Update a sign category |
| DELETE | `/catalog/categories/:id` | ADMIN | Delete a sign category |
| GET | `/catalog/sign-types` | JWT | List sign types. Query: `categoryId`, `isActive` |
### Revalidation — `revalidation`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/revalidation/tasks` | JWT | List revalidation tasks. Query: `status`, `sort`, `page`, `pageSize` |
| GET | `/revalidation/tasks/:taskId` | JWT | Get task detail |
| GET | `/revalidation/tasks/:taskId/evidences` | JWT | List evidence submissions for a task |
| POST | `/revalidation/tasks/:taskId/evidence` | SURVEYOR/ADMIN | Submit photographic evidence. Multipart form: `file` (optional, 20 MB) + `note?` and other DTO fields |
| POST | `/revalidation/tasks/:taskId/finalize` | STAFF/ADMIN | Finalize task verdict based on accumulated evidence votes |
| POST | `/revalidation/evidence/:evidenceId/vote` | REVIEWER/ADMIN | Vote on an evidence item. Body: `{ vote, note? }` |
| GET | `/revalidation/evidence/:evidenceId/decisions` | JWT | List review decisions for an evidence item |

### Payments — `payments`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/payments/webhook` | Public | Payment gateway callback. Validates and processes the order, then credits the wallet |

### Notifications — `notifications`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/notifications` | JWT | List notifications for the authenticated user, unread first. Query: `page`, `pageSize` |
| PATCH | `/notifications/:id/read` | JWT | Mark a single notification as read |
| PATCH | `/notifications/read-all` | JWT | Mark all notifications as read |

### Admin — `admin` (requires ADMIN role)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/admin/users` | ADMIN | List users. Query: `role`, `status`, `search`, `page`, `pageSize` |
| PATCH | `/admin/users/:id/status` | ADMIN | Update user account status (ban / activate). Body: `{ status, reason? }` |
| POST | `/admin/users/:id/roles` | ADMIN | Assign a role to a user. Body: `{ roleCode, isActive? }` |
| GET | `/admin/audit-logs` | ADMIN | List audit log entries. Query: `action`, `resourceName`, `userId`, `page`, `pageSize` |
| GET | `/admin/signs/export` | ADMIN | Export verified signs as JSON (filterable by `status`) |

### Daily Tasks — `daily-tasks`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/daily-tasks` | JWT | List active daily tasks with completion requirements and rewards |
| GET | `/daily-tasks/completions/me` | JWT | List own task completions. Query: `date` (YYYY-MM-DD) |
| POST | `/daily-tasks/:id/claim` | JWT | Claim credit reward for a completed daily task |

### Leaderboard — `leaderboard`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/leaderboard` | JWT | Paginated leaderboard ranked by total credits earned. Query: `page`, `pageSize` |
| POST | `/leaderboard/refresh` | ADMIN | Trigger manual refresh of the leaderboard materialized view |

### Route Planning — `routing`, `signs`, and `navigation`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/routing/directions` | Public | Calculate the shortest route and eligible alternatives through OSRM |
| POST | `/signs/along-route` | Public | Find ACTIVE verified signs inside the configured route corridor, filtered by travel heading and ordered by encounter distance |
| POST | `/navigation/route-preview` | Public | Calculate directions and return route-aware signs for the shortest path in one response |

### FastAPI — Spatial GIS — `spatial` (served at `http://localhost:8000`)

No authentication — intended for map clients.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/spatial/signs` | Public | GeoJSON FeatureCollection of ACTIVE verified signs within a bounding box. Query: `min_lat`, `min_lon`, `max_lat`, `max_lon`, `sign_type_id?`, `category_id?` |
| GET | `/api/v1/spatial/signs/{sign_id}` | Public | Full detail of a single verified sign including type metadata (404 if not found) |

### FastAPI — Smart Navigation — `spatial/navigation`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/v1/spatial/navigation/sessions` | Public | Create a navigation session (records origin + destination). Body: `{ driverId, origin_latitude, origin_longitude, destination_latitude, destination_longitude }`. Returns `sessionId` |
| PATCH | `/api/v1/spatial/navigation/sessions/{id}` | Public | End a session. Body: `{ status: "COMPLETED" \| "CANCELED" }` |
| WS | `ws://localhost:8000/api/v1/spatial/navigation/ws` | Public | Real-time sign alert stream — see below |

#### WebSocket — `ws://localhost:8000/api/v1/spatial/navigation/ws`

The client sends one JSON tick per telemetry update; the server responds with matching sign alerts.

**Tick payload (client to server)**

```json
{
  "latitude": 10.7769,
  "longitude": 106.7009,
  "heading": 45.0,
  "sessionId": "uuid-of-active-session"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `latitude` | number | yes | -90 to 90 |
| `longitude` | number | yes | -180 to 180 |
| `heading` | number | no | Compass bearing, 0 = North, 90 = East (default 0) |
| `sessionId` | UUID | no | When provided, the point is persisted to `navigation_route_points` and alerts to `navigation_sign_alerts`. Points are buffered and flushed every 5 ticks |

**Alert response (server to client)**

```json
{
  "type": "sign_alerts",
  "latitude": 10.7769,
  "longitude": 106.7009,
  "heading": 45.0,
  "alertCount": 1,
  "alerts": [
    {
      "id": "uuid",
      "signTypeId": 12,
      "latitude": 10.7771,
      "longitude": 106.7012,
      "trafficDirection": 45.0,
      "signCropUrl": "https://minio:9000/stm-sign-crops/..."
    }
  ]
}
```

Alerts are computed with `ST_DWithin(..., 50 m)` and a heading cone of 30 degrees; each sign is alerted only once per connection.

**Error response**

```json
{ "type": "error", "message": "Invalid payload: ..." }
```

### FastAPI — Health

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | Public | Liveness probe — unversioned, used by Docker healthchecks |
| GET | `/api/v1/health` | Public | Liveness probe — version-prefixed alias |
## System Workflows

SignTrustMap is a comprehensive platform integrating Crowdsourcing, Artificial Intelligence (AI), and Geographic Information Systems (GIS) across 14 closed-loop workflows[cite: 2]. Below is a detailed technical breakdown of each flow and its corresponding API implementation.

### 1. Ingestion & Tracking
*   **Flow 1: Survey Submission**
    *   **Purpose:** Allow Surveyors to upload dashcam videos, GPX trajectory files, or sign images[cite: 2].
    *   **API Implementation (NestJS):** Utilizes a highly optimized chunked upload mechanism. `POST /submissions/initialize` initiates the upload session[cite: 1]. Subsequently, `POST /submissions/{{sessionId}}/chunks` receives individual file chunks[cite: 1]. Upon completion of the final chunk, the system automatically aggregates the file and queues it for AI processing.
*   **Flow 2: Submission Tracking**
    *   **Purpose:** Help Surveyors track video processing status, view extracted candidate counts, and check contribution history[cite: 2].
    *   **API Implementation (NestJS):** `GET /submissions/me` lists the user's history[cite: 1]. `GET /submissions/status/{{submissionId}}` retrieves detailed progress states (e.g., `QUEUED` or `DETECTING`)[cite: 1].

### 2. AI & Validation
*   **Flow 3: Sign Extraction**
    *   **Purpose:** Background AI models (YOLO12, BoT-SORT, CLIP) process videos, crop sign images, deduplicate, and calculate physical coordinates[cite: 2].
    *   **API Implementation (NestJS - Internal):** Communicates internally via an `X-Internal-Token`[cite: 1]. Celery Workers use `PATCH /submissions/internal/{{submissionId}}/status` to report processing stages[cite: 1]. Upon completion, `POST /submissions/internal/{{submissionId}}/complete` closes the pipeline and automatically distributes credit rewards to the user[cite: 1].
*   **Flow 4: Candidate Review**
    *   **Purpose:** Present AI-extracted signs (with uncertainty) to the community (Reviewers) to validate (Approve/Reject) or suggest corrected labels[cite: 2].
    *   **API Implementation (NestJS):** `GET /reviews/queue` fetches pending candidates[cite: 1]. `POST /reviews/{{candidateId}}/vote` records the Reviewer's decision (Approve, Reject, or suggest a different type)[cite: 1].
*   **Flow 5: Consensus Publishing**
    *   **Purpose:** Calculate a consensus score from votes based on Reviewer reliability[cite: 2]. If the threshold is met, the sign is published to the official map[cite: 2].
    *   **API Implementation (Background Task):** No direct HTTP endpoint[cite: 1]. This logic is triggered internally within the Celery worker (`task_finalize_submission`) once the minimum vote requirement is met[cite: 1].
*   **Flow 14: Active Learning**
    *   **Purpose:** Filter out signs with the highest AI uncertainty to prioritize for human review, improving YOLO12 and CLIP models in future iterations[cite: 2].
    *   **API Implementation (NestJS - Internal):** `GET /reviews/internal/unscored-candidates` allows the AI to fetch unscored candidates[cite: 1]. After calculating uncertainty margins, the AI uses `POST /reviews/internal/active-learning-priorities` to bulk-update priorities in the database[cite: 1].

### 3. Map & Navigation
*   **Flow 6: Map Usage**
    *   **Purpose:** Allow drivers to view, search, and filter verified traffic signs on an interactive OpenStreetMap[cite: 2].
    *   **API Implementation (FastAPI):** `GET /spatial/signs` accepts bounding box coordinates (`min_lat`, `max_lon`, etc.) and returns standard GeoJSON data[cite: 1]. It supports direct filtering by `sign_type_id` and `category_id`[cite: 1].
*   **Flow 7: Navigation**
    *   **Purpose:** Track vehicle GPS coordinates in real-time, match movement heading with sign orientation to issue proximity alerts, and deduct service fees[cite: 2].
    *   **API Implementation (FastAPI):** `POST /spatial/navigation/sessions` initializes the trip and deducts wallet credits[cite: 1]. The `WS /spatial/navigation/stream` WebSocket endpoint maintains a continuous two-way connection to receive GPS ticks and broadcast zero-latency alerts[cite: 1].

### 4. Maintenance & Economy
*   **Flow 8: Revalidation**
    *   **Purpose:** When published signs become stale, the system generates maintenance tasks for the community to capture new evidence (confirming it is unchanged, updated, or removed)[cite: 2].
    *   **API Implementation (NestJS):** `GET /revalidation/tasks` lists available maintenance tasks[cite: 1]. `POST /revalidation/tasks/{{taskId}}/evidence` accepts new photographic evidence[cite: 1]. `POST /revalidation/evidence/{{evidenceId}}/vote` allows Reviewers to validate the submitted evidence[cite: 1].
*   **Flow 11: Credit Economy**
    *   **Purpose:** Manage user wallets, handle top-ups, and distribute rewards for platform contributions[cite: 2].
    *   **API Implementation (NestJS):** `GET /wallet` retrieves the balance and `POST /wallet/top-up` creates a top-up order[cite: 1]. `POST /payments/webhook` securely processes payment gateway callbacks with idempotency checks[cite: 1]. Users can also claim daily task rewards via `POST /daily-tasks/{id}/claim`[cite: 1].

### 5. Administration & Moderation
*   **Flow 9: Catalog Management**
    *   **Purpose:** Manage the official taxonomy of traffic sign types used as the baseline for AI classification and human review[cite: 2].
    *   **API Implementation (NestJS):** Provides a complete set of CRUD APIs (GET, POST, PATCH, DELETE) for `/catalog/categories` and `/catalog/sign-types`[cite: 1].
*   **Flow 10: Missing Type Reports**
    *   **Purpose:** Allow users to report unknown or uncatalogued traffic signs for Administrators to review and potentially add to the official catalog[cite: 2].
    *   **API Implementation (NestJS):** Reviewers use `POST /reviews/missing-type` to submit reports[cite: 1]. Staff use `GET /moderation/missing-type-reports` to view the pending queue[cite: 1].
*   **Flow 12: Moderation**
    *   **Purpose:** Provide Staff with tools to handle fraud, spam, GPS spoofing, or conflicting review cases[cite: 2].
    *   **API Implementation (NestJS):** `GET /moderation/cases` lists flagged violations[cite: 1]. `PUT /moderation/cases/{{caseId}}/resolve` allows Staff to issue a final resolution[cite: 1].
*   **Flow 13: Administration**
    *   **Purpose:** Allow Admins to dynamically configure core system parameters (e.g., minimum consensus votes, default reward values)[cite: 2].
    *   **API Implementation (NestJS):** `GET /admin/system-parameters` lists active parameters and `PUT /admin/system-parameters/{key}` applies hot-updates to these rules without requiring server restarts[cite: 1].

---

## License

Proprietary — internal PPL-HK253 project. Not for public distribution.

| GET | `/catalog/sign-types/:id` | JWT | Get a single sign type |
| POST | `/catalog/sign-types` | ADMIN | Create a sign type |
| PATCH | `/catalog/sign-types/:id` | ADMIN | Update a sign type |
| DELETE | `/catalog/sign-types/:id` | ADMIN | Delete a sign type |
| GET | `/admin/system-parameters` | ADMIN | List tunable system parameters (consensus thresholds, reward amounts, etc.) |
| GET | `/admin/system-parameters/:key` | ADMIN | Get a single parameter by key |
| PUT | `/admin/system-parameters/:key` | ADMIN | Upsert a parameter value. Body: `{ value, description? }` |

### Moderation — `moderation`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/moderation/missing-type-reports` | REVIEWER/STAFF/ADMIN | List missing sign type reports. Query: `page`, `pageSize` |
| GET | `/moderation/missing-type-reports/:id` | REVIEWER/STAFF/ADMIN | Get a single missing-type report |
| GET | `/moderation/cases` | STAFF/ADMIN | List moderation cases. Query: `status`, `page`, `pageSize` |
| GET | `/moderation/cases/:id` | STAFF/ADMIN | Get a single moderation case |
| PUT | `/moderation/cases/:id/resolve` | STAFF/ADMIN | Resolve a case. Body: `{ resolution, note? }` |

│               └── leaderboard.py   # Leaderboard materialized view refresh
```

```

NestJS will listen at http://localhost:3000/api/v1. Make sure apps/nestjs/.env exists.

### Alternative: Run FastAPI locally (Option C)

```powershell
# 1. Install Python dependencies (first time only)
cd apps\fastapi
pip install -r requirements.txt

# 2. Start FastAPI with auto-reload
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# 3. Start Celery worker (separate terminal)
celery -A app.celery_app worker --loglevel=info --queues=default,freshness,leaderboard,ai_pipeline

# 4. Start Celery beat (separate terminal)
celery -A app.celery_app beat --loglevel=info
```

Requires apps/fastapi/.env or env vars exported in the shell.

### Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| stm-postgres keeps restarting | Port 5432 already in use | Change POSTGRES_PORT in .env or stop local Postgres |
| NestJS exits immediately | DATABASE_URL wrong or Postgres not healthy | docker compose logs api-nestjs and docker compose logs postgres |
| stm-minio-init exits non-zero | Bucket creation race | docker compose logs minio-init; then docker compose up minio-init once |
| FastAPI asyncpg connect refused | Celery sync URL uses async driver | SYNC_DATABASE_URL must use postgresql+psycopg:// |
| 403 Forbidden on /internal/* | Missing or wrong X-Internal-Token | Match header to INTERNAL_TOKEN in .env |
| 409 Conflict on second vote | Duplicate-vote guard | Correct — one reviewer may vote once per candidate |
| GET /spatial/signs returns 0 | No ACTIVE signs within bbox | Seed data via revalidation / consensus, or widen bbox |


| `NODE_ENV` | `development` | Environment mode |
| `GOOGLE_CLIENT_ID` | `dummy-client-id` | Google OAuth2 client ID |
| `GOOGLE_CLIENT_SECRET` | `dummy-client-secret` | Google OAuth2 client secret |
| `GOOGLE_CALLBACK_URL` | `http://localhost:3000/api/v1/auth/google/callback` | OAuth2 redirect URL |
| `MINIO_ENDPOINT` | `localhost` | MinIO host |
| `MINIO_PORT` | `9000` | MinIO API port |
| `MINIO_ACCESS_KEY` | `stm_minio` | MinIO access key |
| `MINIO_SECRET_KEY` | `stm_minio_secret_123` | MinIO secret key |
| `MINIO_USE_SSL` | `false` | TLS for MinIO |
| `INTERNAL_TOKEN` | `stm_internal_secret_dev` | Shared secret for `/internal/*` endpoints — Celery workers call NestJS with `X-Internal-Token: <value>`. Change in production. |

> Note: `apps/nestjs/.env.example` is identical to the root `.env.example`. When running inside Docker Compose, variables are injected via `docker-compose.yml` directly — no separate NestJS `.env` is needed. The per-app `.env` is only used for Option B (running NestJS outside Docker).

**NestJS `.env`** (Option B only):

```powershell
Copy-Item apps\nestjs\.env.example apps\nestjs\.env
```

                                        | + celery-beat (scheduler)   |
                                        +-----------------------------+
                                                     |
                                                     v
                                        +------------------------+
                                        | MinIO  :9000 / :9001  |
                                        | stm-raw-videos         |
                                        | stm-gpx-logs           |
                                        | stm-sign-crops         |
                                        | stm-revalidation-ev.   |
                                        | stm-catalog-images     |
                                        +------------------------+
```

## Quản trị Cơ sở dữ liệu với pgAdmin

> **Lưu ý:** pgAdmin đang được cấu hình chạy ở chế độ Desktop (`SERVER_MODE = False`), do đó bạn sẽ vào thẳng dashboard mà không qua màn hình đăng nhập. (Việc log báo HTTP 302 redirect là hành vi chuẩn của chế độ này; cảnh báo lỗi CSRF khi POST bằng cURL thiếu token có thể bỏ qua hoàn toàn).




### Hướng dẫn Truy cập và Truy vấn

1. **Mở Dashboard:** Truy cập [http://localhost:5050](http://localhost:5050) trên trình duyệt web.
2. **Kết nối Server:** Ở thanh điều hướng bên trái, mở rộng **Servers** > **Docker** và double-click vào **SignTrustMap (local)** (Server này đã được pre-register sẵn).
3. **Xác thực (Lần đầu):** Khi popup yêu cầu mật khẩu hiện lên, nhập `stm_password` và tick chọn **"Save Password"** để hệ thống tự động ghi nhớ.
4. **Xem Dữ liệu Bảng (UI):** Điều hướng theo cây thư mục sau để xem dữ liệu trực quan:
   ```text
   Servers
    └─ SignTrustMap (local)
        └─ Databases
            └─ signtrustmap
                └─ Schemas
                    └─ public
                        └─ Tables
                            └─ navigation_sessions (Chuột phải → Chọn "View/Edit Data")

```

Để chạy query tự do: click vào `signtrustmap` → menu `Tools > Query Tool` → gõ SQL → F5.

---
