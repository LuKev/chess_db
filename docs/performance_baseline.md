# Performance Baseline (2026-02-11)

Environment:

1. Local Docker stack (`postgres`, `redis`, `minio`) via `docker compose`.
2. API + worker running from local build artifacts.
3. Node.js 22, macOS local machine.

## Import Throughput Harness (`D-07`)

Command:

```bash
API_BASE_URL=http://localhost:4000 BENCH_GAMES=500 node scripts/bench_import_throughput.mjs
```

Result:

```json
{
  "benchmark": "import-throughput",
  "importJobId": 6,
  "status": "completed",
  "elapsedMs": 2034,
  "parsed": 500,
  "inserted": 6,
  "duplicates": 494,
  "parseErrors": 0,
  "gamesPerMinute": 14749.26
}
```

Notes:

1. This synthetic corpus intentionally reuses a small opening/result space, so dedupe removes most records.
2. Throughput target tracking should use `parsed`/minute for parser+pipeline baseline and use a wider corpus for dedupe-light import runs.

## Query Latency Suite (`I-04`)

Command:

```bash
API_BASE_URL=http://localhost:4000 DATABASE_URL=postgresql://chessdb:chessdb@localhost:5432/chessdb BENCH_QUERY_GAMES=20000 BENCH_QUERY_REQUESTS=120 node scripts/bench_query_latency.mjs
```

Result:

```json
{
  "benchmark": "games-query-latency",
  "requestCount": 120,
  "seededGames": 20000,
  "p50Ms": 4.8,
  "p95Ms": 7.89,
  "targets": {
    "p50Ms": 120,
    "p95Ms": 500
  },
  "pass": true,
  "strictThresholds": false
}
```

Interpretation:

1. Current indexed search path is comfortably inside MVP latency targets on this dataset size.
2. This benchmark is repeatable via the script; enable strict mode (`BENCH_STRICT=true`) to fail CI gates when thresholds regress.
