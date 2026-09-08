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
4. `POST /api/v1/submissions/:submissionId/submit` validates the full contract. A valid
   submission moves to `QUEUED`; otherwise it moves to `PENDING_CORRECTION`.
5. Correct metadata with `PATCH /api/v1/submissions/:submissionId`, attach or finish required
   media, and submit again.

`validationErrors` describes each failed rule. `correctionRequirements` gives the corresponding
action, including the affected `field` and `mediaType` where applicable. Internal pipeline status
updates may also supply these arrays when later processing requires user correction.

Docker Compose applies the idempotent SQL files in `infra/postgres/migrations` before NestJS
starts, including for an existing PostgreSQL volume. Deployments outside Compose must apply
`infra/postgres/migrations/001_unify_submission_contract.sql` before starting this API version.
