# Release Readiness Checklist

This checklist is the hard gate for Chess DB production releases.

## 1) Domain and topology gates

- [ ] `https://api.kezilu.com/health` returns `200`.
- [ ] `https://kezilu.com/chess_db` loads and uses `https://api.kezilu.com` as API origin.
- [ ] API startup guard values are correct:
  - `PUBLIC_API_ORIGIN=https://api.kezilu.com`
  - `PUBLIC_WEB_ORIGIN=https://kezilu.com/chess_db`
  - `CORS_ORIGIN=https://kezilu.com/chess_db`

## 2) Auth/session correctness

- [ ] Browser E2E passes for register -> reload -> logout -> login.
- [ ] Session cookie includes `HttpOnly`, `SameSite=Lax`, and `Secure` (HTTPS).
- [ ] CSRF bad-origin negative test returns `403`.
- [ ] Password reset request/confirm flow works from web UI.

## 3) Data and queue health

- [ ] Import queue is processing (`queued` -> `completed`) on sample import.
- [ ] Analysis queue accepts authenticated writes and returns job status.
- [ ] Export queue completes and download URL is valid.
- [ ] Dead-letter queue endpoint has no unexplained spikes.

## 4) Migration and backfill gates

- [ ] Latest DB migrations are applied.
- [ ] Position/opening backfills are complete for active users:
  - Run: `BACKFILL_VERIFY_STRICT=true DATABASE_URL=... npm run verify:backfill`
  - Expected: `"pass": true`

## 5) Performance/SLO gates

- [ ] Metadata API latency target met: P50 <= 120 ms, P95 <= 500 ms.
- [ ] Position/opening latency budgets met.
- [ ] Run strict SLO benchmark:
  - `BENCH_STRICT=true API_BASE_URL=https://api.kezilu.com npm run bench:slo`
  - Expected: `"pass": true`

## 6) Deployment smoke gates

- [ ] Post-deploy smoke script passes:
  - `SMOKE_API_BASE_URL=https://api.kezilu.com RELEASE_REQUIRED_API_ORIGIN=https://api.kezilu.com node scripts/smoke_post_deploy.mjs`
- [ ] Smoke checks validate:
  - health
  - register/login/me
  - import enqueue/status poll
  - authenticated write
  - logout and post-logout 401

## 7) Final signoff

- [ ] Railway deploy workflow succeeded on `main`.
- [ ] Nightly SLO checks are green (or known issue logged).
- [ ] Rollback playbook was reviewed for this release.

