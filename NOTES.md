# Deployment Notes

## Retention Policy
1. Keep this file concise and durable (target 20-30 items).
2. Keep only active constraints, unresolved blockers, key environment truths, and decisions that still affect implementation.
3. Move superseded/historical detail into dated archives (`NOTES.archive.YYYY-MM-DD.md`).

## Current Durable Notes
1. Primary deploy target remains Railway with services `web`, `api`, `worker`; CI workflow and Railway deploy workflow are in `.github/workflows/ci.yml` and `.github/workflows/railway-deploy.yml`.
2. API integration tests require `DATABASE_URL`; they intentionally skip when unset and run in CI when env is present.
3. Local environment has Docker/Colima working (`docker compose` available).
4. Import pipeline supports `.pgn` and `.pgn.zst`, async queue processing, parse diagnostics in `import_errors`, and strict duplicate mode via canonical hash.
5. Analysis pipeline supports queued Stockfish jobs, cancellation, SSE stream updates, and persisted engine lines by game/ply.
6. Export pipeline supports export-by-ids and export-by-query with include-annotations option.
7. Core ChessBase-like data model is present (`game_positions`, `opening_stats`, `engine_lines`, `collections`, `tags`, `collection_games`, `game_tags`, upgraded `user_annotations`).
8. Position search APIs are implemented:
   - `POST /api/search/position`
   - `POST /api/search/position/material`
9. Opening explorer API is implemented: `GET /api/openings/tree`.
10. Collections/tags APIs are implemented with bulk assignment/removal support (`/api/collections/:id/games`, `/api/tags/:id/games`).
11. Saved filters support presets and shareable tokens (`/api/filters/presets`, `/api/filters/shared/:token`).
12. Import diagnostics endpoint is implemented: `GET /api/imports/:id/errors`.
13. Security hardening implemented: CSRF origin checks, auth brute-force rate limiting, audit event logging, idempotency keys on long-running job creation.
14. Reliability hardening implemented: queue retries/backoff, dead-letter persistence, tenant-scoped dead-letter inspection endpoint.
15. Startup hardening implemented: production topology validation (`PUBLIC_API_ORIGIN`, `PUBLIC_WEB_ORIGIN`, `CORS_ORIGIN`) and S3 bucket validation with optional strict mode.
16. Observability baseline exists: API/worker Prometheus metrics, optional Sentry hooks, and local Grafana/Prometheus configs in `ops/observability/`.
17. Query planner regression tests exist for key indexed paths (`apps/api/test/query_planner.integration.test.ts`).
18. API and worker are wired to GCS S3-compatible storage; bucket provisioning helper exists in `scripts/setup_gcs_s3_railway.sh`.
19. `api.kezilu.com` still does not resolve from this environment (latest verification: `curl` returns host resolution failure), while Railway API domain is healthy.
20. Release policy is now blocked on custom-domain health (`api.kezilu.com`) only; browser E2E + smoke gates are wired in CI workflow.
21. Web app supports keyboard-first viewer navigation, recently-viewed list, password reset UI, annotation undo/redo + autosave status, FEN board editor, opening breadcrumb/depth explorer, and tag/collection edit/delete UX.
22. API game listing supports optional position node filtering via `GET /api/games?positionFen=...` (normalized FEN match against `game_positions`).
23. Release ops artifacts now exist:
   - `docs/release_readiness_checklist.md`
   - `docs/rollback_playbook.md`
24. Scheduled ops checks exist in `.github/workflows/nightly-slo.yml`:
   - strict API SLO benchmark (`npm run bench:slo`)
   - optional strict backfill verification (`npm run verify:backfill`) when `BACKFILL_VERIFY_DATABASE_URL` secret is set.
25. Railway custom-domain status for `api.kezilu.com` currently requires DNS record:
   - CNAME `api.kezilu.com` -> `1twus16e.up.railway.app` (`DNS_RECORD_STATUS_REQUIRES_UPDATE` as of 2026-02-11).
26. Cloudflare `wrangler` auth is available, but current token context cannot update DNS records via v4 API (returns Cloudflare authentication error); DNS update requires a Zone DNS Edit-capable API token or manual dashboard change.
