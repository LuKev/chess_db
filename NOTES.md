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
7. Playwright E2E is configured to run against production base path via `PLAYWRIGHT_BASE_URL=https://kezilu.com/chess_db` and validates: register/login/reload/logout, seed sample game via `/diagnostics`, CSRF negative-case, password reset UI.
8. Web now uses an app-shell + auth gate under `apps/web/app/(app)/layout.tsx`; public login at `apps/web/app/(public)/login/page.tsx`.
9. Important web routing gotcha: normalize `next` redirects to avoid `/chess_db/chess_db/...` 404s; handled via `apps/web/lib/basePath.ts` (`stripAppBasePath`). Optional override: `NEXT_PUBLIC_FALLBACK_BASE_PATH` (default `/chess_db`).
10. Web pages implemented (non-diagnostics): `/games`, `/games/[gameId]`, `/import`, `/search/position`, `/openings`, `/tags`, `/collections` (others still stubbed).
11. Legacy all-in-one UI remains at `/diagnostics` (still used by E2E seed/open flow) while feature pages are extracted.
12. `/games` includes an inline sticky viewer panel (board + side notation bar) opened via the `View` action; full page viewer remains at `/games/[gameId]`.
13. UI testing hook: `/viewer-demo` is an API-free viewer page (public route) intended for quick viewer styling checks; Playwright spec `apps/web/e2e/viewer_demo_ui.spec.ts` asserts piece sizing and writes a reference screenshot to `apps/web/test-results/viewer-demo-board.png`.
14. Import pipeline exists (async jobs, supports `.pgn` and `.pgn.zst`); UI currently implemented on `/import` for queue sample import and upload.
15. Sample seed content (`POST /api/imports/sample` and "Insert sample game" buttons) now uses a real full-length PGN: Karpov vs Kasparov, World Chess Championship 1985 (1985-10-15), rather than a dummy mini-line.
16. Viewer move replay uses `moveTree` mainline SAN (not PGN parsing) so forward/back controls work even when PGN contains variations/comments; implemented via `apps/web/lib/chess/moveTree.ts`.
17. Position search API exists (`POST /api/search/position`); UI currently implemented on `/search/position` (raw FEN input, exact match).
18. Opening tree API exists (`GET /api/openings/tree`); UI currently implemented on `/openings` (FEN + depth, basic breadcrumb).
19. Tags and collections APIs exist with CRUD + bulk assignment; basic management UI exists on `/tags` and `/collections`.
20. Generated test artifacts: Playwright outputs `apps/web/test-results/` and `apps/web/playwright-report/` and are ignored in `.gitignore`.
21. Local environment: Docker is present at `/opt/homebrew/bin/docker`.
22. Tooling constraint: destructive shell commands may be blocked by policy (e.g. `rm -rf`, `git rm --cached`); prefer non-destructive edits via `apply_patch` or add ignores.
23. Deployments use the Railway dashboard GitHub connector (per-service source set to the repo/branch). GitHub Actions no longer requires a Railway token.
24. Railway worker requires Stockfish for analysis jobs:
   - Install via Railway Railpack: `RAILPACK_DEPLOY_APT_PACKAGES=stockfish`
   - Debian installs to `/usr/games/stockfish`, so also set `STOCKFISH_BINARY=/usr/games/stockfish` (since `/usr/games` may not be on PATH).
25. Games are per-user. A new account starts empty until a PGN import job runs and the worker processes it into `games`.
26. If "Seed starter games" or uploads queue but no games appear, the most common cause is the worker not running / BullMQ-Redis connection miswiring (imports stay `queued`).
27. `POST /api/imports/starter` now extracts ~N games into a `.pgn` before uploading, instead of storing the full upstream `.pgn.zst` blob.
28. `POST /api/imports/starter` must store the object key ending in `.pgn` (not `.pgn.zst`) or the worker will attempt zstd decompression and fail with `invalid zstd data`.
29. Web UI convention: prefer lighter/smaller buttons (reduced padding/radius, tighter typography) and shared utility classes in `apps/web/app/globals.css` over per-component inline styles.
30. `/games` filters are reactive (no "Apply" button): changing any filter resets to page 1 and clears selection to avoid stale bulk actions.
30. Password reset UX on `/login` is a two-step flow: step 1 requests a token by email; step 2 submits token + new password, and is disabled until a request has been made (or a token is present).
