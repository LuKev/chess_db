# Rollback Playbook

Use this playbook when a production deploy causes authentication, import/export, or API stability regressions.

## Trigger conditions

Rollback immediately if any of the following are true after deploy:

- Browser E2E fails on auth/session lifecycle.
- Smoke script fails on auth, import, or authenticated write.
- `api.kezilu.com` health endpoint is failing or timing out.
- Queue failures/dead-letters increase sharply.
- P95 latency breach is sustained and user-facing.

## 1) Identify last known good commit

- Use CI history on `main` to find the most recent successful deploy before regression.
- Record both commit SHA and Railway deployment IDs for audit notes.

## 2) Roll back code

- Re-deploy the last known good commit for `web`, `api`, and `worker`.
- Keep DB schema forward-only; do not run destructive downgrade migrations.

## 3) Stabilize runtime flags

If the issue is in stricter behavior introduced by the latest release, temporarily relax non-critical strictness flags while preserving safety:

- Keep auth/cookie/CSRF protections enabled.
- Optional temporary relaxations (only if needed):
  - `S3_STARTUP_CHECK_STRICT=false` (degraded mode while storage creds are repaired)

## 4) Queue recovery

- Pause ingestion triggers if queue failure loops are active.
- Inspect dead letters:
  - `GET /api/ops/dead-letters`
- Fix root cause, then replay affected jobs from source payload.
- Verify retries are not repeatedly re-poisoning the queue.

## 5) Data integrity checks

- Run backfill verification script:
  - `BACKFILL_VERIFY_STRICT=true DATABASE_URL=... npm run verify:backfill`
- If missing position/opening aggregates are detected, enqueue targeted backfills before reopening full traffic.

## 6) Validation after rollback

- Run smoke checks:
  - `SMOKE_API_BASE_URL=https://api.kezilu.com RELEASE_REQUIRED_API_ORIGIN=https://api.kezilu.com node scripts/smoke_post_deploy.mjs`
- Run browser E2E against production URL.
- Confirm auth/session, import, analysis, and export flows all pass.

## 7) Incident follow-up

- Document timeline, impact, root cause, and corrective actions.
- Add regression tests for the failure mode before the next deploy.
- Require successful SLO and smoke/E2E gates before reattempting release.

