#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

railway up --service web --path-as-root "$ROOT_DIR/apps/web" -d
railway up --service api --path-as-root "$ROOT_DIR/apps/api" -d
railway up --service worker --path-as-root "$ROOT_DIR/apps/worker" -d

echo "Deployments queued. Check status with: railway status"
