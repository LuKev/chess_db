#!/usr/bin/env node

import {
  registerAndLogin,
  requestJson,
  resolveApiBaseUrl,
  resolveBenchCredentials,
} from "./lib/api_client.mjs";

const apiBaseUrl = resolveApiBaseUrl();
const { email: benchEmail, password: benchPassword } = resolveBenchCredentials({
  prefix: "bench-import",
});
const totalGames = Number(process.env.BENCH_GAMES ?? "5000");
const pollMs = Number(process.env.BENCH_POLL_MS ?? "2000");

if (!Number.isInteger(totalGames) || totalGames <= 0) {
  throw new Error("BENCH_GAMES must be a positive integer");
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

function buildPgnGame(index) {
  const id = index + 1;
  const day = String((index % 28) + 1).padStart(2, "0");
  const results = ["1-0", "0-1", "1/2-1/2"];
  const result = results[index % results.length];
  const openings = [
    "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6",
    "1. d4 d5 2. c4 e6 3. Nc3 Nf6",
    "1. c4 e5 2. Nc3 Nf6 3. g3 d5",
    "1. Nf3 d5 2. g3 c6 3. Bg2 Bg4",
    "1. e4 c5 2. Nf3 d6 3. d4 cxd4",
    "1. d4 Nf6 2. c4 g6 3. Nc3 Bg7",
  ];
  const moveLine = openings[index % openings.length];

  return [
    `[Event "BenchImport${id}"]`,
    `[Site "Local"]`,
    `[Date "2026.02.${day}"]`,
    `[Round "${id}"]`,
    `[White "BenchWhite${id}"]`,
    `[Black "BenchBlack${id}"]`,
    `[Result "${result}"]`,
    "",
    `${moveLine} ${result}`,
  ].join("\n");
}

function buildBenchmarkPgn(total) {
  const games = [];
  for (let i = 0; i < total; i += 1) {
    games.push(buildPgnGame(i));
  }
  return games.join("\n\n");
}

async function waitForImportCompletion(importId, cookie) {
  while (true) {
    const statusResponse = await requestJsonApi(`/api/imports/${importId}`, {
      method: "GET",
      headers: {
        cookie,
      },
    });

    if (statusResponse.response.status !== 200) {
      throw new Error(
        `Failed to poll import ${importId}: ${statusResponse.response.status} ${statusResponse.text}`
      );
    }

    const status = statusResponse.body.status;
    if (["completed", "partial", "failed"].includes(status)) {
      return statusResponse.body;
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

async function run() {
  const cookie = await authenticate();
  const uploadPgn = buildBenchmarkPgn(totalGames);
  const form = new FormData();
  form.append(
    "file",
    new Blob([uploadPgn], { type: "application/x-chess-pgn" }),
    `bench-${Date.now()}.pgn`
  );

  const startedAt = Date.now();
  const uploadResponse = await requestJsonApi("/api/imports", {
    method: "POST",
    headers: {
      cookie,
    },
    body: form,
  });

  if (uploadResponse.response.status !== 201 || !uploadResponse.body.id) {
    throw new Error(
      `Failed to create import job: ${uploadResponse.response.status} ${uploadResponse.text}`
    );
  }

  const importJobId = Number(uploadResponse.body.id);
  const finalState = await waitForImportCompletion(importJobId, cookie);
  const elapsedMs = Date.now() - startedAt;
  const elapsedMinutes = elapsedMs / 60_000;
  const parsed = Number(finalState.totals?.parsed ?? 0);
  const inserted = Number(finalState.totals?.inserted ?? 0);
  const gamesPerMinute = elapsedMinutes > 0 ? parsed / elapsedMinutes : 0;

  const report = {
    benchmark: "import-throughput",
    importJobId,
    status: finalState.status,
    elapsedMs,
    parsed,
    inserted,
    duplicates: Number(finalState.totals?.duplicates ?? 0),
    parseErrors: Number(finalState.totals?.parseErrors ?? 0),
    gamesPerMinute: Number(gamesPerMinute.toFixed(2)),
  };

  console.log(JSON.stringify(report, null, 2));

  if (finalState.status === "failed") {
    process.exit(1);
  }
}

run().catch((error) => {
  console.error(`[bench:import] ${String(error)}`);
  process.exit(1);
});
