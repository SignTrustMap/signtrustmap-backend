# Submission contract

A submission is created before any media upload. It remains editable while its status is
`DRAFT` or `PENDING_CORRECTION`.

## Required media

| Submission type | Required media | Allowed coordinate sources |
|---|---|---|
| `SINGLE_IMAGE` | `IMAGE` | `IMAGE_EXIF`, `DEVICE_GPS`, `MANUAL` |
| `VIDEO_GPX` | `VIDEO`, `GPX` | `GPX_FILE` |
| `LIVE_TRIP` | `VIDEO` | `LIVE_STREAM` |

## Lifecycle

1. `POST /api/v1/submissions` creates the draft with `submissionType`, `capturedAt`,
   `coordinateSource`, and optional `note`.
2. `POST /api/v1/submissions/:submissionId/uploads` creates one upload session per media file.
3. Upload chunks through `POST /api/v1/submissions/uploads/:sessionId/chunks`, then assemble
   each file through `POST /api/v1/submissions/uploads/:sessionId/complete`.
4. `POST /api/v1/submissions/:submissionId/submit` validates the full contract.
   - Valid submissions move to `QUEUED`.
   - Repairable issues (missing media, incomplete upload, coordinate source mismatch, future capture time, empty GPX, invalid GPS coordinates, timestamp-range mismatch) move to `PENDING_CORRECTION`.
   - Unrepairable format errors (file signature mismatch, unsupported format, corrupted payload, decode failure) move to `REJECTED` (terminal state, further edits and re-submission are rejected with 409 Conflict).
5. For submissions in `PENDING_CORRECTION`, correct metadata with `PATCH /api/v1/submissions/:submissionId`, attach or finish required
   media, and submit again. Submissions in `REJECTED` cannot be corrected or resubmitted.

## Authorization & Ingestion Limits

- **Role Guards**: Surveyor submission endpoints are guarded by `@Roles('SURVEYOR', 'ADMIN')` (with JWT authentication). Internal worker endpoints use `@Public()` with `InternalTokenGuard`.
- **Upload Limits**:
  - `IMAGE`: Max 50 MB
  - `VIDEO`: Max 2 GB
  - `GPX`: Max 20 MB
  - Chunks: Max 50 MB per chunk, max 5,000 chunks per session
- **Validation Pipeline**:
  - **File Signature Verification**: Inspects magic bytes (JPEG `FF D8 FF`, PNG `89 50 4E 47`, WebP `RIFF...WEBP`, MP4/MOV `ftyp`, GPX XML `<?xml` / `<gpx`).
  - **Media Decoding**: Decodes image headers (dimensions) and video containers (duration, tracks).
  - **GPX Trajectory Parsing & Validation**: Extracts trackpoints and waypoints, validates coordinate bounds (`-90 <= lat <= 90`, `-180 <= lon <= 180`), and verifies capture timestamp falls within GPX interval (with 15-minute tolerance).

Celery Beat scans the durable `QUEUED` state and publishes
`task_process_submission_pipeline(submission_id, media_objects)`. Each `media_objects` item contains
only `media_type`, `bucket`, and `object_key`; media bytes are not uploaded again. The worker owns
retries, lifecycle changes, catalog-label resolution, and candidate persistence. The standalone AI
service only downloads those MinIO objects, runs inference synchronously, uploads candidate crops,
and returns inference results.

`validationErrors` describes each failed rule. `correctionRequirements` gives the corresponding
action, including the affected `field` and `mediaType` where applicable. Internal pipeline status
updates may also supply these arrays when later processing requires user correction.

Docker Compose applies the idempotent SQL files in `infra/postgres/migrations` before NestJS
starts, including for an existing PostgreSQL volume. Deployments outside Compose must apply
`infra/postgres/migrations/001_unify_submission_contract.sql` and
`infra/postgres/migrations/002_add_rejected_submission_status.sql` before starting this API version.
