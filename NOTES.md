# Chess DB Workspace Notes

## Retention Policy
1. Keep this file concise and durable (target 20-30 items).
2. Keep only active constraints, unresolved blockers, key environment truths, and decisions that still affect implementation.
3. Move superseded/historical detail into dated archives (`NOTES.archive.YYYY-MM-DD.md`).

## Current Durable Notes (Accurate Snapshot)
1. Repo root: `/Users/kevin/projects/chess_db` (monorepo: `apps/web`, `apps/api`, `apps/worker`).
2. Primary deploy target is Railway with services `web`, `api`, `worker`; CI in `.github/workflows/ci.yml`; `.github/workflows/railway-deploy.yml` runs post-deploy checks (smoke + E2E) and does not deploy.
3. Production domains: web served under `/chess_db` on `kezilu.com`; API at `https://api.kezilu.com` (custom domain).
4. API CORS/CSRF allowlists include both `https://kezilu.com` and `https://www.kezilu.com`; `CORS_ORIGIN` supports comma-separated origins.
5. Smoke checks: `SMOKE_API_BASE_URL=https://api.kezilu.com RELEASE_REQUIRED_API_ORIGIN=https://api.kezilu.com node scripts/smoke_post_deploy.mjs`.
6. Scripts: `scripts/lib/api_client.mjs` centralizes JSON fetch + cookie extraction + random credential generation for `bench_*` and `smoke_post_deploy.mjs` (no hardcoded default passwords).
7. Playwright E2E is configured to run against production base path via `PLAYWRIGHT_BASE_URL=https://kezilu.com/chess_db` and validates: register/login/reload/logout, seed sample game via `/diagnostics`, replay controls in Diagnostics Game Viewer (forward/back/start/end with board-state regression check), CSRF negative-case, password reset UI. Local default base URL is `http://localhost:3000`; for parallel local E2E runs, start API with `AUTH_RATE_LIMIT_ENABLED=false` to avoid `429` on repeated registration flows.
8. Web now uses an app-shell + auth gate under `apps/web/app/(app)/layout.tsx`; public login at `apps/web/app/(public)/login/page.tsx`.
9. Important web routing gotcha: normalize `next` redirects to avoid `/chess_db/chess_db/...` 404s; handled via `apps/web/lib/basePath.ts` (`stripAppBasePath`). Optional override: `NEXT_PUBLIC_FALLBACK_BASE_PATH` (default `/chess_db`).
10. Web API origin selection: `apps/web/lib/api.ts` prefers `NEXT_PUBLIC_API_BASE_URL`; otherwise it infers production via `NEXT_PUBLIC_PROD_DOMAIN` (default `kezilu.com`) and can be overridden with `NEXT_PUBLIC_PROD_API_ORIGIN` (default `https://api.<prodDomain>`).
11. Local env gotcha: npm workspaces run with `cwd=apps/*`, so naive `dotenv/config` won’t see repo-root `.env`; API/worker load env via `apps/api/src/env.ts` and `apps/worker/src/env.ts` (loads both `process.cwd()/.env` and repo-root `.env`).
12. Web pages implemented (non-diagnostics): `/games`, `/games/[gameId]`, `/import`, `/search/position`, `/openings`, `/tags`, `/collections` (others still stubbed).
13. Legacy all-in-one UI remains at `/diagnostics` (still used by E2E seed/open flow) while feature pages are extracted; UI testing hook `/viewer-demo` is an API-free viewer page and `apps/web/e2e/viewer_demo_ui.spec.ts` writes a reference screenshot to `apps/web/test-results/viewer-demo-board.png`.
14. `/games` includes an inline sticky viewer panel (board + side notation bar) opened via the `View` action; full page viewer remains at `/games/[gameId]`.
15. Import pipeline exists (async jobs, supports `.pgn` and `.pgn.zst`); UI currently implemented on `/import` for queue sample import and upload.
16. Sample seed content (`POST /api/imports/sample` and "Insert sample game" buttons) uses a full-length PGN: Karpov vs Kasparov, World Chess Championship 1985 (1985-10-15).
17. Viewer move replay uses `moveTree` mainline SAN (not PGN parsing) so forward/back controls work even when PGN contains variations/comments; implemented via `apps/web/lib/chess/moveTree.ts`.
18. Position search API exists (`POST /api/search/position`); UI implemented on `/search/position` (raw FEN input, exact match).
19. Opening tree API exists (`GET /api/openings/tree`); UI implemented on `/openings` (FEN + depth, basic breadcrumb).
20. Tags and collections APIs exist with CRUD + bulk assignment; basic management UI exists on `/tags` and `/collections`.
21. Generated test artifacts: Playwright outputs `apps/web/test-results/` and `apps/web/playwright-report/` and are ignored in `.gitignore`.
22. Deployments use the Railway dashboard GitHub connector (per-service source set to the repo/branch). GitHub Actions no longer requires a Railway token.
23. Railway worker requires Stockfish for analysis jobs: install via `RAILPACK_DEPLOY_APT_PACKAGES=stockfish`, then set `STOCKFISH_BINARY=/usr/games/stockfish`.
24. Games are per-user. A new account starts empty until a PGN import job runs and the worker processes it into `games`.
25. If uploads/seed queue but no games appear, the most common cause is the worker not running or BullMQ/Redis connection miswiring (imports stay `queued`).
26. `POST /api/imports/starter` extracts games into a `.pgn` before uploading; object keys must end in `.pgn` (not `.pgn.zst`) or the worker will attempt zstd decompression and fail.
27. Web UI convention: prefer lighter/smaller buttons in `apps/web/app/globals.css`; `/games` filters are reactive (no Apply button) and reset pagination/selection on change.
28. Password reset UX on `/login` is a two-step flow: request token by email, then submit token + new password (step 2 disabled until a request has been made or a token is present).
29. Production outage pattern (observed 2026-02-18): `https://api.kezilu.com` returns Railway edge `502` and web login shows `TypeError: Failed to fetch` when Railway `Postgres` is crashed due disk exhaustion (`pg_wal/xlogtemp.*: No space left on device`); API then crashes with DB `ETIMEDOUT`.
30. Storage-growth hotspot: `/Users/kevin/projects/chess_db/apps/api/migrations/0005_chessbase_features.sql` creates `game_positions` with several indexes (`user+fen`, `user+material`, `user+game+ply`, `user+next_fen`); this is roughly one row per ply per imported game and can dominate small Postgres volumes quickly.
31. Active product direction question: user pushed back on per-ply persistence in `game_positions`; potential follow-up is to make position indexing optional (feature flag/background/offline index) or redesign schema to avoid direct one-row-per-position writes on ingest.
32. Destructive production DB reset performed on 2026-02-18: switched `api` and `worker` `DATABASE_URL` to new Railway DB service `Postgres-KAxY` (`postgres-kaxy.railway.internal`), restoring auth/API availability; old `Postgres` service remains in FAILED state with a separate attached volume and should be removed from Railway when convenient.
