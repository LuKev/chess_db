#!/usr/bin/env node

import pg from "pg";
import {
  registerAndLogin,
  requestJson,
  resolveApiBaseUrl,
  resolveBenchCredentials,
} from "./lib/api_client.mjs";

const { Pool } = pg;

const apiBaseUrl = resolveApiBaseUrl();
const databaseUrl = process.env.DATABASE_URL;
const { email: benchEmail, password: benchPassword } = resolveBenchCredentials({
  prefix: "bench-query",
});
const targetGames = Number(process.env.BENCH_QUERY_GAMES ?? "100000");
const requestCount = Number(process.env.BENCH_QUERY_REQUESTS ?? "200");
const p50TargetMs = Number(process.env.BENCH_P50_TARGET_MS ?? "120");
const p95TargetMs = Number(process.env.BENCH_P95_TARGET_MS ?? "500");
const strictThresholds = (process.env.BENCH_STRICT ?? "false") === "true";

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for query benchmark");
}
if (!Number.isInteger(targetGames) || targetGames <= 0) {
  throw new Error("BENCH_QUERY_GAMES must be a positive integer");
}
if (!Number.isInteger(requestCount) || requestCount <= 0) {
  throw new Error("BENCH_QUERY_REQUESTS must be a positive integer");
}

const requestJsonApi = (path, options = {}) =>
  requestJson(apiBaseUrl, path, options);

const BENCH_LINES = [
  {
    eco: "B44",
    line: ["e4", "c5", "Nf3", "Nc6"],
    pgn: "1. e4 c5 2. Nf3 Nc6",
  },
  {
    eco: "C65",
    line: ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6"],
    pgn: "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6",
  },
  {
    eco: "D37",
    line: ["d4", "d5", "c4", "e6", "Nc3", "Nf6"],
    pgn: "1. d4 d5 2. c4 e6 3. Nc3 Nf6",
  },
  {
    eco: "E60",
    line: ["d4", "Nf6", "c4", "g6", "Nc3", "Bg7"],
    pgn: "1. d4 Nf6 2. c4 g6 3. Nc3 Bg7",
  },
];

async function authenticate() {
  const cookie = await registerAndLogin({
    baseUrl: apiBaseUrl,
    email: benchEmail,
    password: benchPassword,
  });

  const me = await requestJsonApi("/api/auth/me", {
    method: "GET",
    headers: {
      cookie,
    },
  });
  if (me.response.status !== 200 || !me.body.user?.id) {
    throw new Error(`Failed to load benchmark user profile: ${me.response.status}`);
  }

  return {
    cookie,
    userId: Number(me.body.user.id),
  };
}

async function ensureBenchmarkArtifacts(pool, userId) {
  for (const line of BENCH_LINES) {
    await pool.query(
      `INSERT INTO game_moves (game_id, move_tree)
       SELECT g.id, $3::jsonb
       FROM games g
       WHERE g.user_id = $1
         AND g.eco = $2
         AND NOT EXISTS (
           SELECT 1
           FROM game_moves gm
           WHERE gm.game_id = g.id
         )`,
      [userId, line.eco, JSON.stringify({ mainline: line.line })]
    );

    await pool.query(
      `INSERT INTO game_pgn (game_id, pgn_text)
       SELECT g.id, $3
       FROM games g
       WHERE g.user_id = $1
         AND g.eco = $2
         AND NOT EXISTS (
           SELECT 1
           FROM game_pgn gp
           WHERE gp.game_id = g.id
         )`,
      [userId, line.eco, `[Event "BenchQuery"]\n\n${line.pgn} *`]
    );
  }
}

async function ensureBenchmarkDataset(pool, userId) {
  const existingResult = await pool.query(
    `SELECT COUNT(*)::text AS total
     FROM games
     WHERE user_id = $1`,
    [userId]
  );
  const existing = Number(existingResult.rows[0].total);

  if (existing >= targetGames) {
    await ensureBenchmarkArtifacts(pool, userId);
    return existing;
  }

  const toInsert = targetGames - existing;

  await pool.query(
    `INSERT INTO games (
      user_id,
      white,
      white_norm,
      black,
      black_norm,
      result,
      event,
      event_norm,
      site,
      eco,
      time_control,
      rated,
      played_on,
      ply_count,
      starting_fen,
      moves_hash
    )
    SELECT
      $1,
      CASE WHEN gs % 2 = 0 THEN 'Kasparov, Garry' ELSE 'Carlsen, Magnus' END,
      CASE WHEN gs % 2 = 0 THEN 'kasparov, garry' ELSE 'carlsen, magnus' END,
      CASE WHEN gs % 3 = 0 THEN 'Karpov, Anatoly' ELSE 'Anand, Viswanathan' END,
      CASE WHEN gs % 3 = 0 THEN 'karpov, anatoly' ELSE 'anand, viswanathan' END,
      CASE WHEN gs % 5 = 0 THEN '1-0' WHEN gs % 5 = 1 THEN '0-1' ELSE '1/2-1/2' END,
      CASE WHEN gs % 2 = 0 THEN 'World Championship' ELSE 'Candidates' END,
      CASE WHEN gs % 2 = 0 THEN 'world championship' ELSE 'candidates' END,
      CASE WHEN gs % 2 = 0 THEN 'Moscow' ELSE 'London' END,
      CASE WHEN gs % 4 = 0 THEN 'B44' WHEN gs % 4 = 1 THEN 'C65' WHEN gs % 4 = 2 THEN 'D37' ELSE 'E60' END,
      CASE WHEN gs % 2 = 0 THEN '40/7200:20/3600' ELSE '600+0' END,
      (gs % 2 = 0),
      DATE '2010-01-01' + ((gs + $3) % 5000),
      60 + (gs % 80),
      'startpos',
      'bench-hash-' || ($3 + gs)::text
    FROM generate_series(1, $2) AS gs
    ON CONFLICT DO NOTHING`,
    [userId, toInsert, existing]
  );

  await ensureBenchmarkArtifacts(pool, userId);

  const totalResult = await pool.query(
    `SELECT COUNT(*)::text AS total
     FROM games
     WHERE user_id = $1`,
    [userId]
  );

  return Number(totalResult.rows[0].total);
}

function percentile(values, ratio) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.floor(sorted.length * ratio)
  );
  return sorted[index];
}

function sampleQueries() {
  return [
    "/api/games?page=1&pageSize=50&sort=date_desc",
    "/api/games?page=1&pageSize=50&sort=white&player=Kasparov",
    "/api/games?page=1&pageSize=50&sort=eco&eco=B44&result=1-0",
    "/api/games?page=1&pageSize=50&event=World%20Championship&site=Moscow",
    "/api/games?page=1&pageSize=50&timeControl=600%2B0&rated=false",
    "/api/games?page=1&pageSize=50&fromDate=2015-01-01&toDate=2024-12-31",
  ];
}

async function run() {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const { cookie, userId } = await authenticate();
    const seededGames = await ensureBenchmarkDataset(pool, userId);
    const queries = sampleQueries();
    const timings = [];

    for (let i = 0; i < requestCount; i += 1) {
      const query = queries[i % queries.length];
      const startedAt = performance.now();
      const response = await fetch(`${apiBaseUrl}${query}`, {
        method: "GET",
        headers: { cookie },
      });
      const elapsedMs = performance.now() - startedAt;
      timings.push(elapsedMs);

      if (response.status !== 200) {
        const body = await response.text();
        throw new Error(`Query request failed (${response.status}): ${body}`);
      }
      await response.arrayBuffer();
    }

    const p50 = percentile(timings, 0.5);
    const p95 = percentile(timings, 0.95);
    const report = {
      benchmark: "games-query-latency",
      requestCount,
      seededGames,
      p50Ms: Number(p50.toFixed(2)),
      p95Ms: Number(p95.toFixed(2)),
      targets: {
        p50Ms: p50TargetMs,
        p95Ms: p95TargetMs,
      },
      pass: p50 <= p50TargetMs && p95 <= p95TargetMs,
      strictThresholds,
    };

    console.log(JSON.stringify(report, null, 2));

    if (strictThresholds && !report.pass) {
      process.exit(1);
    }
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error(`[bench:queries] ${String(error)}`);
  process.exit(1);
});
