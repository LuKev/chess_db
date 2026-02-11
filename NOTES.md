# Deployment Notes

1. Temporary approach: local git `post-push` hook auto-deploys Railway services after pushes to `main`.
2. TODO: migrate to Railway native GitHub source deploys (`web`, `api`, `worker`) once Railway GitHub connector can resolve `LuKev/chess_db` reliably.
3. Sprint 1 foundation implementation added:
   - API env validation (`DATABASE_URL`, `SESSION_SECRET`, etc.) with fail-fast parsing.
   - SQL migration runner (`apps/api/src/migrations.ts`) and initial schema in `apps/api/migrations/0001_initial.sql`.
   - Auth/session routes (`/api/auth/register`, `/api/auth/login`, `/api/auth/me`, `/api/auth/logout`) with Argon2id password hashing and DB-backed sessions.
   - Tenant-scoped game/filter APIs (`/api/games`, `/api/games/:id`, `/api/filters`).
   - CI workflow (`.github/workflows/ci.yml`) for lint/test/typecheck with Postgres service.
4. Integration tests in `apps/api/test/auth_games.integration.test.ts` require `DATABASE_URL`; they intentionally skip when unset. CI sets `DATABASE_URL`, so tests execute there.
5. Local Codex environment note: early in this session `docker` was unavailable, but this was resolved by installing Docker CLI + Colima (see note 6).
6. Docker runtime and CLI were installed in this workspace session via Homebrew (`docker`, `docker-compose`, `docker-buildx`, `colima`) and initialized with `colima start`; `docker compose` now works.
7. Sprint 2 import pipeline now implemented:
   - `POST /api/imports` stores uploads to MinIO/S3-compatible storage and enqueues import jobs.
   - Worker consumes import jobs from Redis (BullMQ), parses PGN, supports `.pgn.zst` streaming decompression via `fzstd`, applies dedupe, and writes `import_errors`.
   - Import status/list endpoints are available (`GET /api/imports`, `GET /api/imports/:id`).
8. Engine analysis queue implemented:
   - API routes: `POST /api/analysis`, `GET /api/analysis/:id`, `POST /api/analysis/:id/cancel`.
   - Worker runs Stockfish for queued analysis jobs and persists best move, PV, and eval.
   - New migration `0002_engine_requests_annotations.sql` adds `engine_requests` and `user_annotations`.
9. Worker integration tests now cover both import and analysis processors (`apps/worker/test/process_import_job.integration.test.ts`, `apps/worker/test/process_analysis_job.integration.test.ts`).
10. Export queue implemented with API and worker flow:
   - API: `POST /api/exports`, `GET /api/exports`, `GET /api/exports/:id`.
   - Worker: `processExportJob` writes PGN export artifacts to object storage.
   - Migration `0003_export_jobs.sql` adds export job tracking schema.
11. Viewer/analysis/export UX hardening added:
   - API: `GET /api/games/:id/pgn`, annotations `GET/PUT /api/games/:id/annotations`, SSE `GET /api/analysis/:id/stream`, and `GET /api/exports/:id/download`.
   - Web UI now includes richer viewer controls, line/variation selector, annotation persistence fields, near-real-time engine stream updates, and export download links.
12. Password reset flow implemented:
   - Endpoints: `POST /api/auth/password-reset/request`, `POST /api/auth/password-reset/confirm`.
   - New migration `0004_password_reset_tokens.sql` stores hashed reset tokens with expiry/usage fields.
13. Export include-annotations toggle is now implemented end-to-end:
   - `includeAnnotations` API payload maps to `export_jobs.include_annotations`.
   - Worker appends serialized annotations as PGN comment lines when enabled.
14. Runtime gotcha: BullMQ version in this workspace rejects `jobId` values containing `:`. Queue job IDs must use `-` (e.g. `import-123`) or enqueue fails at runtime.
15. Runtime gotcha: MinIO rejects unknown-length stream uploads for plain `PutObject` (`MissingContentLength`). API upload path now uses `@aws-sdk/lib-storage` `Upload` for multipart stream-safe uploads.
16. Observability baseline added:
   - API Prometheus metrics endpoint (`/metrics`) with request counters/latency.
   - Worker Prometheus endpoint (`WORKER_METRICS_PORT`, default `9465`) with job counters/duration and queue depth gauges.
   - Optional Sentry hooks for API/worker via `API_SENTRY_DSN` and `WORKER_SENTRY_DSN`.
   - Local Prometheus/Grafana + alert rules in `ops/observability/`.
17. Performance harness scripts added:
   - `scripts/bench_import_throughput.mjs` and `scripts/bench_query_latency.mjs`.
   - Baseline run results are recorded in `docs/performance_baseline.md`.
18. Railway production deploy requirement:
   - `api` and `worker` now require S3-related env vars at boot (`S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`) and `api` also requires `SESSION_SECRET`.
   - Missing these variables causes immediate startup crash on Railway.
   - Current Railway production was set with placeholder S3 credentials to restore service boot; replace with real object-storage credentials for import/export to work correctly.
