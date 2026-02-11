# Railway Setup Notes

Date: 2026-02-11
Project: `chess-db`
Project ID: `aea9db8b-a434-4826-864e-4869ed452dbe`

## Services

1. `web` (`c452a9cd-d238-4a8d-abae-45d040d5988e`)
2. `api` (`059cc1af-bed0-47cb-af8a-feb744fb7fc2`)
3. `worker` (`52a64ddd-f4f7-466a-938f-2230012e9090`)
4. `Postgres` (`246edc2e-704b-45b2-8688-cc7a8c09736d`)
5. `Redis` (`fa194298-00b6-43f7-9999-eec347b99d28`)

## Current Railway Service Domains

1. Web: `https://web-production-d3e49.up.railway.app`
2. API: `https://api-production-d291.up.railway.app`

## Configured Environment Variables

### web

1. `NODE_ENV=production`
2. `NEXT_PUBLIC_BASE_PATH=/chess_db`
3. `NEXT_PUBLIC_API_BASE_URL=https://api-production-d291.up.railway.app`
4. `API_BASE_URL=https://api-production-d291.up.railway.app`

### api

1. `NODE_ENV=production`
2. `HOST=0.0.0.0`
3. `CORS_ORIGIN=https://kezilu.com`
4. `DATABASE_URL=${{Postgres.DATABASE_URL}}`
5. `REDIS_URL=${{Redis.REDIS_URL}}`

### worker

1. `NODE_ENV=production`
2. `DATABASE_URL=${{Postgres.DATABASE_URL}}`
3. `REDIS_URL=${{Redis.REDIS_URL}}`
4. `API_BASE_URL=https://api-production-d291.up.railway.app`

## Custom Domains Created in Railway

1. Web custom domain: `kezilu.com`
   - Required DNS record shown by Railway: `CNAME @ -> dqj8mo9z.up.railway.app`
2. API custom domain: `api.kezilu.com`
   - Required DNS record shown by Railway: `CNAME api -> 1twus16e.up.railway.app`

These are optional in the current live architecture because `kezilu.com` is already routed by a Cloudflare Worker.

## Live Routing Architecture for `/chess_db`

Path routing is handled by the existing Cloudflare Worker in:

1. `/Users/kevin/projects/tm_server/cloudflare-worker/tm-router/src/index.ts`

Current flow:

1. `https://kezilu.com/chess_db...`
2. Cloudflare Worker route match for `/chess_db`
3. Worker proxies to `https://web-production-d3e49.up.railway.app/chess_db...`

This is why you did not need ad-hoc Cloudflare dashboard rules for each app path: the worker code is the routing layer.

## Important Note About Path Hosting

Railway custom domains are service-level host routing, not path-prefix routing between services.

If you are not using the worker-router approach, to serve the app at `https://kezilu.com/chess_db` while keeping other paths, configure your existing edge/proxy with a path rule:

1. Match `/chess_db*`
2. Proxy upstream to `https://web-production-d3e49.up.railway.app/chess_db$1`

Alternative:

1. Use `https://chessdb.kezilu.com` as the app host and rewrite `/chess_db` from your main site to that subdomain.
2. Current Railway plan has a per-service custom domain limit; remove/replace the current web custom domain in Railway dashboard if you want to switch from apex to subdomain.

## Deploy Commands

From repo root:

```bash
./scripts/railway_deploy_all.sh
```

Manual per service:

```bash
railway up --service web --path-as-root apps/web -d
railway up --service api --path-as-root apps/api -d
railway up --service worker --path-as-root apps/worker -d
```
