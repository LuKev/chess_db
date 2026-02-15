#!/usr/bin/env node

import {
  registerAndLogin,
  requestJson,
  resolveApiBaseUrl,
  resolveBenchCredentials,
} from "./lib/api_client.mjs";

const apiBaseUrl = resolveApiBaseUrl();
const { email: benchEmail, password: benchPassword } = resolveBenchCredentials({
  prefix: "bench-slo",
});
const seedGamesTarget = Number(process.env.BENCH_SLO_GAMES ?? "300");
const requestCount = Number(process.env.BENCH_SLO_REQUESTS ?? "180");
const strictThresholds = (process.env.BENCH_STRICT ?? "false") === "true";

const targets = {
  metadata: {
    p50: Number(process.env.BENCH_METADATA_P50_TARGET_MS ?? "120"),
    p95: Number(process.env.BENCH_METADATA_P95_TARGET_MS ?? "500"),
  },
  position: {
    p50: Number(process.env.BENCH_POSITION_P50_TARGET_MS ?? "250"),
    p95: Number(process.env.BENCH_POSITION_P95_TARGET_MS ?? "700"),
  },
  opening: {
    p50: Number(process.env.BENCH_OPENING_P50_TARGET_MS ?? "250"),
    p95: Number(process.env.BENCH_OPENING_P95_TARGET_MS ?? "700"),
  },
};

if (!Number.isInteger(seedGamesTarget) || seedGamesTarget <= 0) {
  throw new Error("BENCH_SLO_GAMES must be a positive integer");
}
if (!Number.isInteger(requestCount) || requestCount <= 0) {
  throw new Error("BENCH_SLO_REQUESTS must be a positive integer");
}

const requestJsonApi = (path, options = {}) =>
  requestJson(apiBaseUrl, path, options);

async function authenticate() {
  return registerAndLogin({
    baseUrl: apiBaseUrl,
    email: benchEmail,
    password: benchPassword,
  });
}

const OPENING_LINES = [
  {
    eco: "C65",
    line: ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6"],
    pgn: "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6",
  },
  {
    eco: "B90",
    line: ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6"],
    pgn: "1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6",
  },
  {
    eco: "D37",
    line: ["d4", "d5", "c4", "e6", "Nc3", "Nf6", "Nf3", "Be7"],
    pgn: "1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Nf3 Be7",
  },
  {
    eco: "E60",
    line: ["d4", "Nf6", "c4", "g6", "Nc3", "Bg7", "e4", "d6"],
    pgn: "1. d4 Nf6 2. c4 g6 3. Nc3 Bg7 4. e4 d6",
  },
];

function buildSeedGame(index) {
  const line = OPENING_LINES[index % OPENING_LINES.length];
  const day = String((index % 28) + 1).padStart(2, "0");
  const result = index % 3 === 0 ? "1-0" : index % 3 === 1 ? "0-1" : "1/2-1/2";

  return {
    white: `BenchWhite${index}`,
    black: `BenchBlack${index}`,
    result,
    eco: line.eco,
    event: index % 2 === 0 ? "SLO Bench" : "Latency Cup",
    site: index % 2 === 0 ? "Online" : "Club",
    date: `2026-02-${day}`,
    movesHash: `slo-seed-${Date.now()}-${index}`,
    pgn: `[Event "SLO Bench"]\n\n${line.pgn} ${result}`,
    moveTree: {
      mainline: line.line,
    },
  };
}

async function ensureSeedGames(cookie) {
  const list = await requestJsonApi("/api/games?page=1&pageSize=1&sort=date_desc", {
    method: "GET",
    headers: { cookie },
  });

  if (list.response.status !== 200) {
    throw new Error(`Failed to load games for seeding: ${list.response.status} ${list.text}`);
  }

  const existing = Number(list.body.total ?? 0);
  if (existing >= seedGamesTarget) {
    return existing;
  }

  const toCreate = seedGamesTarget - existing;
  for (let i = 0; i < toCreate; i += 1) {
    const payload = buildSeedGame(existing + i + 1);
    const create = await requestJsonApi("/api/games", {
      method: "POST",
      headers: {
        cookie,
      },
      body: JSON.stringify(payload),
    });

    if (create.response.status !== 201) {
      throw new Error(`Failed to seed game: ${create.response.status} ${create.text}`);
    }
  }

  return seedGamesTarget;
}

function percentile(values, ratio) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * ratio));
  return sorted[index];
}

async function runTimedRequests({
  name,
  requestFactory,
  count,
  target,
}) {
  const timings = [];

  for (let i = 0; i < count; i += 1) {
    const startedAt = performance.now();
    const response = await requestFactory(i);
    const elapsedMs = performance.now() - startedAt;
    timings.push(elapsedMs);

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`${name} request failed (${response.status}): ${body}`);
    }
    await response.arrayBuffer();
  }

  const p50 = percentile(timings, 0.5);
  const p95 = percentile(timings, 0.95);
  return {
    name,
    requestCount: count,
    p50Ms: Number(p50.toFixed(2)),
    p95Ms: Number(p95.toFixed(2)),
    targets: {
      p50Ms: target.p50,
      p95Ms: target.p95,
    },
    pass: p50 <= target.p50 && p95 <= target.p95,
  };
}

async function run() {
  const cookie = await authenticate();
  const seededGames = await ensureSeedGames(cookie);

  const metadataQueries = [
    "/api/games?page=1&pageSize=50&sort=date_desc",
    "/api/games?page=1&pageSize=50&sort=white&player=benchwhite",
    "/api/games?page=1&pageSize=50&sort=eco&eco=C65",
    "/api/games?page=1&pageSize=50&event=SLO%20Bench",
    "/api/games?page=1&pageSize=50&site=Online",
  ];

  const startFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

  const metadata = await runTimedRequests({
    name: "metadata",
    count: requestCount,
    target: targets.metadata,
    requestFactory: async (index) => {
      const query = metadataQueries[index % metadataQueries.length];
      return fetch(`${apiBaseUrl}${query}`, {
        method: "GET",
        headers: { cookie },
      });
    },
  });

  const position = await runTimedRequests({
    name: "position",
    count: requestCount,
    target: targets.position,
    requestFactory: async () =>
      fetch(`${apiBaseUrl}/api/search/position`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({
          fen: startFen,
          page: 1,
          pageSize: 30,
        }),
      }),
  });

  const opening = await runTimedRequests({
    name: "opening",
    count: requestCount,
    target: targets.opening,
    requestFactory: async () =>
      fetch(`${apiBaseUrl}/api/openings/tree?fen=${encodeURIComponent(startFen)}&depth=2`, {
        method: "GET",
        headers: { cookie },
      }),
  });

  const report = {
    benchmark: "api-slo-latency",
    apiBaseUrl,
    seededGames,
    strictThresholds,
    endpoints: {
      metadata,
      position,
      opening,
    },
    pass: metadata.pass && position.pass && opening.pass,
  };

  console.log(JSON.stringify(report, null, 2));

  if (strictThresholds && !report.pass) {
    process.exit(1);
  }
}

run().catch((error) => {
  console.error(`[bench:api:slo] ${String(error)}`);
  process.exit(1);
});
