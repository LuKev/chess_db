# Chess DB

Web-based chess database project (MVP in progress).

Planning docs:

1. `docs/mvp_spec.md`
2. `docs/build_backlog_plan.md`

## Monorepo Layout

1. `apps/web`: Next.js frontend.
2. `apps/api`: Fastify API.
3. `apps/worker`: background worker placeholder.

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
npm run dev:api
npm run dev:web
npm run dev:worker
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

### Web at `kezilu.com/chessdb`

In the `web` Railway service set:

1. `NEXT_PUBLIC_BASE_PATH=/chessdb`
2. `NEXT_PUBLIC_API_BASE_URL=https://<your-api-domain>`
3. `API_BASE_URL=https://<your-api-domain>`

Then map your custom domain in Railway:

1. Add domain `kezilu.com`.
2. Route/path-prefix `chessdb` to the `web` service (or use your edge/proxy rule to forward `/chessdb`).

If Railway path routing is limited in your plan/region, route by subdomain (for example `chessdb.kezilu.com`) and use your site proxy to rewrite `/chessdb -> https://chessdb.kezilu.com`.

