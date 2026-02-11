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
