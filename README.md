# Chess DB

Web-based chess database project (MVP in progress).

Planning docs:

1. `docs/mvp_spec.md`
2. `docs/build_backlog_plan.md`
3. `docs/railway_setup.md`

## Monorepo Layout

1. `apps/web`: Next.js frontend.
2. `apps/api`: Fastify API (`auth`, `games`, `imports`, `analysis`, `saved filters`, migrations).
3. `apps/worker`: queue worker (`imports`, `analysis` with Stockfish).

## Local Setup

Requirements:

1. Node.js 20+
2. npm 10+
3. Docker (for Postgres/Redis/MinIO)

Commands:

```bash
cp .env.example .env
docker compose up -d
npm install
npm run migrate:api
npm run dev:api
npm run dev:web
npm run dev:worker
```

Validation commands:

```bash
npm run lint
npm run test
npm run typecheck
```

Benchmark harness:

```bash
npm run bench:import
npm run bench:queries
```

Notes:

1. API migrations auto-run at startup when `AUTO_MIGRATE=true`.
2. API integration tests require `DATABASE_URL` to be set (CI sets this in `.github/workflows/ci.yml`).
3. Local worker analysis needs a `stockfish` binary on PATH (`brew install stockfish` on macOS).
4. API exposes Prometheus metrics at `/metrics` by default; worker exposes metrics at `http://localhost:9465/metrics`.
5. Optional Sentry support:
   - API: `API_SENTRY_DSN`, `API_SENTRY_ENV`
   - Worker: `WORKER_SENTRY_DSN`, `WORKER_SENTRY_ENV`
6. Local Prometheus/Grafana stack and alert rules are in `ops/observability/`.

## Implemented Endpoints (Current)

1. Auth:
   - `POST /api/auth/register`
   - `POST /api/auth/login`
   - `GET /api/auth/me`
   - `POST /api/auth/logout`
   - `POST /api/auth/password-reset/request`
   - `POST /api/auth/password-reset/confirm`
2. Games:
   - `POST /api/games`
   - `GET /api/games`
   - `GET /api/games/:id`
   - `GET /api/games/:id/pgn`
   - `GET /api/games/:id/annotations`
   - `PUT /api/games/:id/annotations`
3. Filters:
   - `POST /api/filters`
   - `GET /api/filters`
   - `DELETE /api/filters/:id`
4. Imports:
   - `POST /api/imports` (multipart `.pgn` / `.pgn.zst`)
   - `GET /api/imports`
   - `GET /api/imports/:id`
5. Analysis:
   - `POST /api/analysis`
   - `GET /api/analysis/:id`
   - `GET /api/analysis/:id/stream`
   - `POST /api/analysis/:id/cancel`
6. Export:
   - `POST /api/exports`
   - `GET /api/exports`
   - `GET /api/exports/:id`
   - `GET /api/exports/:id/download`

Railway deployment helper:

```bash
./scripts/railway_deploy_all.sh
```

Automatic deploy on push:

1. Workflow file: `.github/workflows/railway-deploy.yml`
2. Required GitHub secret: `RAILWAY_TOKEN`
3. Generate this as a Railway API/deploy token in Railway dashboard (account/project token), then set it:

```bash
gh secret set RAILWAY_TOKEN -R LuKev/chess_db
```

## Convert to Remote Git Repo

This directory is already initialized as a local git repo.

Create first commit:

```bash
git add .
git commit -m "chore: bootstrap chessdb monorepo"
```

Connect your remote (replace URL):

```bash
git branch -M main
git remote add origin <your-repo-url>
git push -u origin main
```

## Railway Deployment Plan

Use one Railway project with three services from this repo:

1. `web` service
   - Root directory: `apps/web`
   - Build command: `npm install && npm run build`
   - Start command: `npm run start`
2. `api` service
   - Root directory: `apps/api`
   - Build command: `npm install && npm run build`
   - Start command: `npm run start`
3. `worker` service
   - Root directory: `apps/worker`
   - Build command: `npm install && npm run build`
   - Start command: `npm run start`

### Web at `kezilu.com/chess_db`

In the `web` Railway service set:

1. `NEXT_PUBLIC_BASE_PATH=/chess_db`
2. `NEXT_PUBLIC_API_BASE_URL=https://<your-api-domain>`
3. `API_BASE_URL=https://<your-api-domain>`

If you already use a Cloudflare Worker router on `kezilu.com` (as in `tm_server/cloudflare-worker/tm-router`), add a `/chess_db` route there and proxy to your Railway web domain.

If you are not using a Cloudflare Worker router, you need an edge/proxy rule to forward `/chess_db*` to the Railway web service.

If Railway path routing is limited in your plan/region, route by subdomain (for example `chessdb.kezilu.com`) and use your site proxy to rewrite `/chess_db -> https://chessdb.kezilu.com`.
