import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { Readable } from "node:stream";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createPool, resetDatabase } from "../src/db.js";
import type {
  AnalysisQueue,
  ExportQueue,
  ImportQueue,
  OpeningBackfillQueue,
  PositionBackfillQueue,
} from "../src/infrastructure/queue.js";
import type { ObjectStorage } from "../src/infrastructure/storage.js";
import { runMigrations } from "../src/migrations.js";

const databaseUrl = process.env.DATABASE_URL;

function makeMultipartBody(params: {
  fieldName: string;
  fileName: string;
  contentType: string;
  content: string;
}): { body: Buffer; boundary: string } {
  const boundary = `----CodexBoundary${Date.now().toString(36)}`;
  const body = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${params.fieldName}"; filename="${params.fileName}"\r\n` +
      `Content-Type: ${params.contentType}\r\n\r\n` +
      `${params.content}\r\n` +
      `--${boundary}--\r\n`
  );

  return { body, boundary };
}

function extractCookie(setCookieHeader: string | string[] | undefined): string {
  if (!setCookieHeader) {
    throw new Error("Expected Set-Cookie header");
  }

  const raw = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  return raw.split(";")[0];
}

(databaseUrl ? describe.sequential : describe.skip)(
  "auth and tenant isolation",
  () => {
  let app: FastifyInstance;
  let pool: Pool;
  const enqueuedJobs: Array<{ importJobId: number; userId: number }> = [];
  const enqueuedAnalysis: Array<{ analysisRequestId: number; userId: number }> = [];
  const enqueuedExports: Array<{ exportJobId: number; userId: number }> = [];
  const uploadedObjects: Array<{ key: string; contentType: string }> = [];
  const objectStore = new Map<string, string>();

  beforeAll(async () => {
    const noOpQueue: ImportQueue = {
      enqueueImport: async (payload) => {
        enqueuedJobs.push(payload);
      },
      close: async () => {},
    };
    const noOpAnalysisQueue: AnalysisQueue = {
      enqueueAnalysis: async (payload) => {
        enqueuedAnalysis.push(payload);
      },
      close: async () => {},
    };
    const noOpExportQueue: ExportQueue = {
      enqueueExport: async (payload) => {
        enqueuedExports.push(payload);
      },
      close: async () => {},
    };
    const noOpPositionBackfillQueue: PositionBackfillQueue = {
      enqueuePositionBackfill: async () => {},
      close: async () => {},
    };
    const noOpOpeningBackfillQueue: OpeningBackfillQueue = {
      enqueueOpeningBackfill: async () => {},
      close: async () => {},
    };
    const noOpStorage: ObjectStorage = {
      ensureBucket: async () => {},
      uploadObject: async ({ key, contentType, body }) => {
        let bodyText = "";
        for await (const unusedChunk of body as AsyncIterable<unknown>) {
          if (typeof unusedChunk === "string") {
            bodyText += unusedChunk;
          } else if (unusedChunk instanceof Uint8Array) {
            bodyText += Buffer.from(unusedChunk).toString("utf8");
          } else {
            bodyText += String(unusedChunk);
          }
        }
        uploadedObjects.push({ key, contentType });
        objectStore.set(key, bodyText);
      },
      getObjectStream: async (key) => Readable.from([objectStore.get(key) ?? ""]),
      close: async () => {},
    };

    const config = loadConfig({
      NODE_ENV: "test",
      PORT: "4000",
      HOST: "127.0.0.1",
      CORS_ORIGIN: "http://localhost:3000",
      DATABASE_URL: databaseUrl!,
      SESSION_SECRET: "test-session-secret-12345",
      SESSION_COOKIE_NAME: "chessdb_session",
      SESSION_TTL_HOURS: "24",
      REDIS_URL: "redis://127.0.0.1:6379",
      S3_ENDPOINT: "http://127.0.0.1:9000",
      S3_REGION: "us-east-1",
      S3_ACCESS_KEY: "minio",
      S3_SECRET_KEY: "miniostorage",
      S3_BUCKET: "chessdb-test",
      S3_FORCE_PATH_STYLE: "true",
      UPLOAD_MAX_BYTES: "1000000",
      AUTO_MIGRATE: "false",
    });

    pool = createPool(config);
    await runMigrations(pool);
    app = await buildApp({
      config,
      pool,
      importQueue: noOpQueue,
      analysisQueue: noOpAnalysisQueue,
      exportQueue: noOpExportQueue,
      positionBackfillQueue: noOpPositionBackfillQueue,
      openingBackfillQueue: noOpOpeningBackfillQueue,
      objectStorage: noOpStorage,
      runMigrationsOnBoot: false,
    });
  });

  beforeEach(async () => {
    await resetDatabase(pool);
    enqueuedJobs.length = 0;
    enqueuedAnalysis.length = 0;
    enqueuedExports.length = 0;
    uploadedObjects.length = 0;
    objectStore.clear();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (pool) {
      await pool.end();
    }
  });

  it("exposes Prometheus metrics endpoint", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/metrics",
    });

    expect(response.statusCode).toBe(200);
    expect(String(response.headers["content-type"])).toContain("text/plain");
    expect(response.body).toContain("chessdb_api_requests_total");
  });

  it("register/login/me/logout flow works", async () => {
    const registerResponse = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "player.one@example.com",
        password: "s3curePassword!",
      },
    });

    expect(registerResponse.statusCode).toBe(201);
    const registerCookie = extractCookie(registerResponse.headers["set-cookie"]);
    const rawSetCookie = String(
      Array.isArray(registerResponse.headers["set-cookie"])
        ? registerResponse.headers["set-cookie"][0]
        : registerResponse.headers["set-cookie"]
    ).toLowerCase();
    expect(rawSetCookie).toContain("httponly");
    expect(rawSetCookie).toContain("samesite=lax");

    const meResponse = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: {
        cookie: registerCookie,
      },
    });

    expect(meResponse.statusCode).toBe(200);
    expect(meResponse.json().user.email).toBe("player.one@example.com");

    const logoutResponse = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: {
        cookie: registerCookie,
      },
    });

    expect(logoutResponse.statusCode).toBe(200);

    const meAfterLogout = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: {
        cookie: registerCookie,
      },
    });

    expect(meAfterLogout.statusCode).toBe(401);
  });

  it("writes audit events for auth actions", async () => {
    const register = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "audit-auth@example.com",
        password: "auditPassword123!",
      },
    });
    expect(register.statusCode).toBe(201);
    const cookie = extractCookie(register.headers["set-cookie"]);

    const logout = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { cookie },
    });
    expect(logout.statusCode).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 25));

    const events = await pool.query<{
      action: string;
      status_code: number;
    }>(
      `SELECT action, status_code
       FROM audit_events
       ORDER BY id ASC`
    );

    expect(
      events.rows.some((row) => row.action.startsWith("POST /api/auth/register"))
    ).toBe(true);
    expect(
      events.rows.some((row) => row.action.startsWith("POST /api/auth/logout"))
    ).toBe(true);
    expect(events.rows.every((row) => row.status_code >= 200)).toBe(true);
  });

  it("supports password reset request and confirm flow", async () => {
    const registerResponse = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "reset-user@example.com",
        password: "oldPassword123!",
      },
    });
    expect(registerResponse.statusCode).toBe(201);

    const requestReset = await app.inject({
      method: "POST",
      url: "/api/auth/password-reset/request",
      payload: {
        email: "reset-user@example.com",
      },
    });
    expect(requestReset.statusCode).toBe(200);

    const resetToken = requestReset.json().resetToken as string;
    expect(typeof resetToken).toBe("string");
    expect(resetToken.length).toBeGreaterThanOrEqual(32);

    const confirmReset = await app.inject({
      method: "POST",
      url: "/api/auth/password-reset/confirm",
      payload: {
        token: resetToken,
        newPassword: "newPassword456!",
      },
    });
    expect(confirmReset.statusCode).toBe(200);

    const oldLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: "reset-user@example.com",
        password: "oldPassword123!",
      },
    });
    expect(oldLogin.statusCode).toBe(401);

    const newLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: "reset-user@example.com",
        password: "newPassword456!",
      },
    });
    expect(newLogin.statusCode).toBe(200);
  });

  it("prevents cross-user game access", async () => {
    const userA = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "alpha@example.com",
        password: "passwordAlpha!",
      },
    });

    const userB = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "beta@example.com",
        password: "passwordBeta!",
      },
    });

    const cookieA = extractCookie(userA.headers["set-cookie"]);
    const cookieB = extractCookie(userB.headers["set-cookie"]);

    const createGame = await app.inject({
      method: "POST",
      url: "/api/games",
      headers: {
        cookie: cookieA,
      },
      payload: {
        white: "Alpha",
        black: "Opponent",
        result: "1-0",
        date: "2026-01-12",
        movesHash: "hash-alpha-game-1",
        pgn: "[Event \"Test\"]\n\n1. e4 e5 2. Nf3 Nc6 1-0",
        moveTree: {
          mainline: ["e4", "e5", "Nf3", "Nc6"],
        },
      },
    });

    expect(createGame.statusCode).toBe(201);
    const gameId = createGame.json().id as number;

    const ownerCanRead = await app.inject({
      method: "GET",
      url: `/api/games/${gameId}`,
      headers: {
        cookie: cookieA,
      },
    });

    expect(ownerCanRead.statusCode).toBe(200);
    expect(ownerCanRead.json().white).toBe("Alpha");

    const nonOwnerCannotRead = await app.inject({
      method: "GET",
      url: `/api/games/${gameId}`,
      headers: {
        cookie: cookieB,
      },
    });

    expect(nonOwnerCannotRead.statusCode).toBe(404);

    const nonOwnerList = await app.inject({
      method: "GET",
      url: "/api/games",
      headers: {
        cookie: cookieB,
      },
    });

    expect(nonOwnerList.statusCode).toBe(200);
    expect(nonOwnerList.json().items).toHaveLength(0);
  });

  it("persists saved filters per-user", async () => {
    const userA = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "filters-a@example.com",
        password: "passwordFiltersA!",
      },
    });

    const userB = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "filters-b@example.com",
        password: "passwordFiltersB!",
      },
    });

    const cookieA = extractCookie(userA.headers["set-cookie"]);
    const cookieB = extractCookie(userB.headers["set-cookie"]);

    const create = await app.inject({
      method: "POST",
      url: "/api/filters",
      headers: {
        cookie: cookieA,
      },
      payload: {
        name: "Rapid White Games",
        query: {
          player: "alpha",
          timeControl: "rapid",
          result: "1-0",
        },
      },
    });

    expect(create.statusCode).toBe(201);
    const filterId = create.json().id as number;
    const shareToken = create.json().shareToken as string;
    expect(typeof shareToken).toBe("string");
    expect(shareToken.length).toBeGreaterThanOrEqual(8);

    const listA = await app.inject({
      method: "GET",
      url: "/api/filters",
      headers: {
        cookie: cookieA,
      },
    });

    expect(listA.statusCode).toBe(200);
    expect(listA.json().items).toHaveLength(1);
    expect(typeof listA.json().items[0].shareToken).toBe("string");

    const listB = await app.inject({
      method: "GET",
      url: "/api/filters",
      headers: {
        cookie: cookieB,
      },
    });

    expect(listB.statusCode).toBe(200);
    expect(listB.json().items).toHaveLength(0);

    const sharedByOwner = await app.inject({
      method: "GET",
      url: `/api/filters/shared/${shareToken}`,
      headers: {
        cookie: cookieA,
      },
    });
    expect(sharedByOwner.statusCode).toBe(200);
    expect(sharedByOwner.json().name).toBe("Rapid White Games");

    const sharedByNonOwner = await app.inject({
      method: "GET",
      url: `/api/filters/shared/${shareToken}`,
      headers: {
        cookie: cookieB,
      },
    });
    expect(sharedByNonOwner.statusCode).toBe(404);

    const deleteFromWrongUser = await app.inject({
      method: "DELETE",
      url: `/api/filters/${filterId}`,
      headers: {
        cookie: cookieB,
      },
    });

    expect(deleteFromWrongUser.statusCode).toBe(404);

    const deleteFromOwner = await app.inject({
      method: "DELETE",
      url: `/api/filters/${filterId}`,
      headers: {
        cookie: cookieA,
      },
    });

    expect(deleteFromOwner.statusCode).toBe(204);

    const presets = await app.inject({
      method: "GET",
      url: "/api/filters/presets",
    });
    expect(presets.statusCode).toBe(200);
    expect(presets.json().items.length).toBeGreaterThan(0);
  });

  it("creates import jobs and enqueues processing", async () => {
    const user = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "importer@example.com",
        password: "passwordImporter!",
      },
    });
    const cookie = extractCookie(user.headers["set-cookie"]);

    const multipart = makeMultipartBody({
      fieldName: "file",
      fileName: "sample.pgn",
      contentType: "application/x-chess-pgn",
      content:
        "[Event \"Test\"]\n[White \"A\"]\n[Black \"B\"]\n[Result \"1-0\"]\n\n1. e4 e5 1-0\n",
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/imports",
      headers: {
        cookie,
        "content-type": `multipart/form-data; boundary=${multipart.boundary}`,
      },
      payload: multipart.body,
    });

    expect(response.statusCode).toBe(201);
    expect(enqueuedJobs).toHaveLength(1);
    expect(uploadedObjects).toHaveLength(1);
    expect(enqueuedJobs[0].userId).toBeGreaterThan(0);
    expect(enqueuedJobs[0].importJobId).toBeGreaterThan(0);

    const importJob = await app.inject({
      method: "GET",
      url: `/api/imports/${enqueuedJobs[0].importJobId}`,
      headers: { cookie },
    });

    expect(importJob.statusCode).toBe(200);
    expect(importJob.json().status).toBe("queued");
  });

  it("replays idempotent import creation without duplicating jobs", async () => {
    const user = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "import-idempotent@example.com",
        password: "passwordImporter!",
      },
    });
    const cookie = extractCookie(user.headers["set-cookie"]);
    const idempotencyKey = "import-idempotency-0001";

    const makeRequest = async () => {
      const multipart = makeMultipartBody({
        fieldName: "file",
        fileName: "sample.pgn",
        contentType: "application/x-chess-pgn",
        content:
          "[Event \"Test\"]\n[White \"A\"]\n[Black \"B\"]\n[Result \"1-0\"]\n\n1. e4 e5 1-0\n",
      });

      return app.inject({
        method: "POST",
        url: "/api/imports",
        headers: {
          cookie,
          "idempotency-key": idempotencyKey,
          "content-type": `multipart/form-data; boundary=${multipart.boundary}`,
        },
        payload: multipart.body,
      });
    };

    const first = await makeRequest();
    const second = await makeRequest();

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(first.json().id);
    expect(enqueuedJobs).toHaveLength(1);
  });

  it("creates and cancels analysis requests", async () => {
    const user = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "analysis-user@example.com",
        password: "passwordAnalysis!",
      },
    });
    const cookie = extractCookie(user.headers["set-cookie"]);

    const create = await app.inject({
      method: "POST",
      url: "/api/analysis",
      headers: { cookie },
      payload: {
        fen: "rn1qkbnr/pppb1ppp/3p4/4p3/3PP3/2N2N2/PPP2PPP/R1BQKB1R w KQkq - 0 5",
        depth: 10,
      },
    });

    expect(create.statusCode).toBe(201);
    expect(enqueuedAnalysis).toHaveLength(1);
    const analysisId = create.json().id as number;

    const read = await app.inject({
      method: "GET",
      url: `/api/analysis/${analysisId}`,
      headers: { cookie },
    });

    expect(read.statusCode).toBe(200);
    expect(read.json().status).toBe("queued");

    const cancel = await app.inject({
      method: "POST",
      url: `/api/analysis/${analysisId}/cancel`,
      headers: { cookie },
    });

    expect(cancel.statusCode).toBe(200);
    expect(cancel.json().status).toBe("cancelled");
  });

  it("replays idempotent analysis creation without duplicating jobs", async () => {
    const user = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "analysis-idempotent@example.com",
        password: "passwordAnalysis!",
      },
    });
    const cookie = extractCookie(user.headers["set-cookie"]);

    const first = await app.inject({
      method: "POST",
      url: "/api/analysis",
      headers: {
        cookie,
        "idempotency-key": "analysis-idempotency-0001",
      },
      payload: {
        fen: "rn1qkbnr/pppb1ppp/3p4/4p3/3PP3/2N2N2/PPP2PPP/R1BQKB1R w KQkq - 0 5",
        depth: 10,
      },
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/analysis",
      headers: {
        cookie,
        "idempotency-key": "analysis-idempotency-0001",
      },
      payload: {
        fen: "rn1qkbnr/pppb1ppp/3p4/4p3/3PP3/2N2N2/PPP2PPP/R1BQKB1R w KQkq - 0 5",
        depth: 10,
      },
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(first.json().id);
    expect(enqueuedAnalysis).toHaveLength(1);
  });

  it("supports PGN download and per-user annotations", async () => {
    const userA = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "viewer-a@example.com",
        password: "passwordViewerA!",
      },
    });
    const userB = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "viewer-b@example.com",
        password: "passwordViewerB!",
      },
    });
    const cookieA = extractCookie(userA.headers["set-cookie"]);
    const cookieB = extractCookie(userB.headers["set-cookie"]);

    const createGame = await app.inject({
      method: "POST",
      url: "/api/games",
      headers: { cookie: cookieA },
      payload: {
        white: "ViewerA",
        black: "ViewerB",
        result: "1-0",
        movesHash: "viewer-hash-1",
        pgn: "[Event \"Viewer\"]\n\n1. e4 e5 1-0",
        moveTree: {
          mainline: ["e4", "e5"],
        },
      },
    });

    expect(createGame.statusCode).toBe(201);
    const gameId = createGame.json().id as number;

    const pgnA = await app.inject({
      method: "GET",
      url: `/api/games/${gameId}/pgn`,
      headers: { cookie: cookieA },
    });
    expect(pgnA.statusCode).toBe(200);
    expect(pgnA.body).toContain("[Event \"Viewer\"]");

    const pgnB = await app.inject({
      method: "GET",
      url: `/api/games/${gameId}/pgn`,
      headers: { cookie: cookieB },
    });
    expect(pgnB.statusCode).toBe(404);

    const putAnnotations = await app.inject({
      method: "PUT",
      url: `/api/games/${gameId}/annotations`,
      headers: { cookie: cookieA },
      payload: {
        annotations: {
          comment: "Critical position after 1...e5",
        },
      },
    });
    expect(putAnnotations.statusCode).toBe(200);

    const getAnnotationsA = await app.inject({
      method: "GET",
      url: `/api/games/${gameId}/annotations`,
      headers: { cookie: cookieA },
    });
    expect(getAnnotationsA.statusCode).toBe(200);
    expect(getAnnotationsA.json().annotations.comment).toBe(
      "Critical position after 1...e5"
    );

    const getAnnotationsB = await app.inject({
      method: "GET",
      url: `/api/games/${gameId}/annotations`,
      headers: { cookie: cookieB },
    });
    expect(getAnnotationsB.statusCode).toBe(404);
  });

  it("applies per-user analysis queue rate limiting", async () => {
    const user = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "analysis-limit@example.com",
        password: "passwordLimit!",
      },
    });
    const cookie = extractCookie(user.headers["set-cookie"]);

    for (let i = 0; i < 3; i += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/api/analysis",
        headers: { cookie },
        payload: {
          fen: "rn1qkbnr/pppb1ppp/3p4/4p3/3PP3/2N2N2/PPP2PPP/R1BQKB1R w KQkq - 0 5",
          depth: 10,
        },
      });

      expect(response.statusCode).toBe(201);
    }

    const fourth = await app.inject({
      method: "POST",
      url: "/api/analysis",
      headers: { cookie },
      payload: {
        fen: "rn1qkbnr/pppb1ppp/3p4/4p3/3PP3/2N2N2/PPP2PPP/R1BQKB1R w KQkq - 0 5",
        depth: 10,
      },
    });

    expect(fourth.statusCode).toBe(429);
  });

  it("creates export jobs by ids and query", async () => {
    const user = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "export-user@example.com",
        password: "passwordExport!",
      },
    });
    const cookie = extractCookie(user.headers["set-cookie"]);

    const byIds = await app.inject({
      method: "POST",
      url: "/api/exports",
      headers: { cookie },
      payload: {
        mode: "ids",
        gameIds: [1, 2, 3],
        includeAnnotations: true,
      },
    });

    expect(byIds.statusCode).toBe(201);
    expect(enqueuedExports).toHaveLength(1);

    const byQuery = await app.inject({
      method: "POST",
      url: "/api/exports",
      headers: { cookie },
      payload: {
        mode: "query",
        query: {
          player: "Kasparov",
          eco: "B44",
        },
      },
    });

    expect(byQuery.statusCode).toBe(201);
    expect(enqueuedExports).toHaveLength(2);

    const exportStatus = await app.inject({
      method: "GET",
      url: `/api/exports/${byQuery.json().id as number}`,
      headers: { cookie },
    });

    expect(exportStatus.statusCode).toBe(200);
    expect(exportStatus.json().status).toBe("queued");

    const includeFlags = await pool.query<{
      include_annotations: boolean;
    }>(
      `SELECT include_annotations
       FROM export_jobs
       WHERE user_id = (SELECT id FROM users WHERE email = 'export-user@example.com')
       ORDER BY id ASC`
    );

    expect(includeFlags.rows[0].include_annotations).toBe(true);
    expect(includeFlags.rows[1].include_annotations).toBe(false);
  });

  it("replays idempotent export creation without duplicating jobs", async () => {
    const user = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "export-idempotent@example.com",
        password: "passwordExport!",
      },
    });
    const cookie = extractCookie(user.headers["set-cookie"]);

    const first = await app.inject({
      method: "POST",
      url: "/api/exports",
      headers: {
        cookie,
        "idempotency-key": "export-idempotency-0001",
      },
      payload: {
        mode: "query",
        query: {
          player: "Kasparov",
          eco: "B44",
        },
      },
    });
    const second = await app.inject({
      method: "POST",
      url: "/api/exports",
      headers: {
        cookie,
        "idempotency-key": "export-idempotency-0001",
      },
      payload: {
        mode: "query",
        query: {
          player: "Kasparov",
          eco: "B44",
        },
      },
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(first.json().id);
    expect(enqueuedExports).toHaveLength(1);
  });

  it("downloads completed export artifacts for the owning user", async () => {
    const userA = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "download-a@example.com",
        password: "passwordDownloadA!",
      },
    });
    const userB = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "download-b@example.com",
        password: "passwordDownloadB!",
      },
    });
    const cookieA = extractCookie(userA.headers["set-cookie"]);
    const cookieB = extractCookie(userB.headers["set-cookie"]);

    const userRow = await pool.query<{ id: string | number }>(
      "SELECT id FROM users WHERE email = 'download-a@example.com'"
    );
    const userId = Number(userRow.rows[0].id);

    const exportRow = await pool.query<{ id: string | number }>(
      `INSERT INTO export_jobs (
         user_id,
         status,
         mode,
         output_object_key,
         exported_games
       ) VALUES ($1, 'completed', 'query', 'exports/user-a/job-1.pgn', 2)
       RETURNING id`,
      [userId]
    );

    const exportId = Number(exportRow.rows[0].id);
    objectStore.set("exports/user-a/job-1.pgn", "[Event \"Export\"]\n\n1. e4 e5 1-0");

    const ownerDownload = await app.inject({
      method: "GET",
      url: `/api/exports/${exportId}/download`,
      headers: { cookie: cookieA },
    });

    expect(ownerDownload.statusCode).toBe(200);
    expect(ownerDownload.body).toContain("[Event \"Export\"]");

    const nonOwnerDownload = await app.inject({
      method: "GET",
      url: `/api/exports/${exportId}/download`,
      headers: { cookie: cookieB },
    });

    expect(nonOwnerDownload.statusCode).toBe(404);
  });

  it("lists dead-letter queue entries for the owning user", async () => {
    const userA = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "deadletter-a@example.com",
        password: "passwordDeadA!",
      },
    });
    const userB = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "deadletter-b@example.com",
        password: "passwordDeadB!",
      },
    });
    const cookieA = extractCookie(userA.headers["set-cookie"]);
    const cookieB = extractCookie(userB.headers["set-cookie"]);

    const userRows = await pool.query<{ email: string; id: string | number }>(
      `SELECT email, id
       FROM users
       WHERE email IN ('deadletter-a@example.com', 'deadletter-b@example.com')`
    );
    const userAId = Number(userRows.rows.find((row) => row.email === "deadletter-a@example.com")!.id);
    const userBId = Number(userRows.rows.find((row) => row.email === "deadletter-b@example.com")!.id);

    await pool.query(
      `INSERT INTO queue_dead_letters (
        queue_name,
        job_name,
        job_id,
        user_id,
        payload,
        attempts_made,
        max_attempts,
        failed_reason
      ) VALUES
      ('imports', 'import', 'import-123', $1, '{"importJobId":123}'::jsonb, 3, 3, 'boom'),
      ('analysis', 'analyze', 'analysis-555', $2, '{"analysisRequestId":555}'::jsonb, 3, 3, 'other user')`,
      [userAId, userBId]
    );

    const ownerList = await app.inject({
      method: "GET",
      url: "/api/ops/dead-letters?page=1&pageSize=10",
      headers: { cookie: cookieA },
    });
    expect(ownerList.statusCode).toBe(200);
    expect(ownerList.json().total).toBe(1);
    expect(ownerList.json().items[0].jobId).toBe("import-123");

    const otherList = await app.inject({
      method: "GET",
      url: "/api/ops/dead-letters?page=1&pageSize=10",
      headers: { cookie: cookieB },
    });
    expect(otherList.statusCode).toBe(200);
    expect(otherList.json().total).toBe(1);
    expect(otherList.json().items[0].jobId).toBe("analysis-555");
  });

  it("supports collections/tags, position search, opening tree, and stored engine lines", async () => {
    const user = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "feature-suite@example.com",
        password: "passwordFeatureSuite!",
      },
    });
    const cookie = extractCookie(user.headers["set-cookie"]);

    const createGame = await app.inject({
      method: "POST",
      url: "/api/games",
      headers: { cookie },
      payload: {
        white: "Feature White",
        black: "Feature Black",
        result: "1-0",
        movesHash: "feature-suite-hash-1",
        pgn: "[Event \"Feature\"]\n\n1. e4 e5 2. Nf3 Nc6 1-0",
        moveTree: {
          mainline: ["e4", "e5", "Nf3", "Nc6"],
        },
      },
    });
    expect(createGame.statusCode).toBe(201);
    const gameId = createGame.json().id as number;

    const tag = await app.inject({
      method: "POST",
      url: "/api/tags",
      headers: { cookie },
      payload: {
        name: "Sharp",
        color: "#ff0000",
      },
    });
    expect(tag.statusCode).toBe(201);
    const tagId = tag.json().id as number;

    const assignTag = await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/tags/${tagId}`,
      headers: { cookie },
    });
    expect(assignTag.statusCode).toBe(201);

    const collection = await app.inject({
      method: "POST",
      url: "/api/collections",
      headers: { cookie },
      payload: {
        name: "Prep",
      },
    });
    expect(collection.statusCode).toBe(201);
    const collectionId = collection.json().id as number;

    const addToCollection = await app.inject({
      method: "POST",
      url: `/api/collections/${collectionId}/games`,
      headers: { cookie },
      payload: {
        gameIds: [gameId],
      },
    });
    expect(addToCollection.statusCode).toBe(200);

    const filteredByTag = await app.inject({
      method: "GET",
      url: `/api/games?tagId=${tagId}`,
      headers: { cookie },
    });
    expect(filteredByTag.statusCode).toBe(200);
    expect(filteredByTag.json().items).toHaveLength(1);

    const filteredByCollection = await app.inject({
      method: "GET",
      url: `/api/games?collectionId=${collectionId}`,
      headers: { cookie },
    });
    expect(filteredByCollection.statusCode).toBe(200);
    expect(filteredByCollection.json().items).toHaveLength(1);

    const initialFen = "rn1qkbnr/pppb1ppp/3p4/4p3/3PP3/2N2N2/PPP2PPP/R1BQKB1R w KQkq - 0 5";
    const analysis = await app.inject({
      method: "POST",
      url: "/api/analysis",
      headers: { cookie },
      payload: {
        fen: initialFen,
        depth: 8,
      },
    });
    expect(analysis.statusCode).toBe(201);

    const positionSearch = await app.inject({
      method: "POST",
      url: "/api/search/position",
      headers: { cookie },
      payload: {
        fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      },
    });
    expect(positionSearch.statusCode).toBe(200);
    expect(positionSearch.json().items.length).toBeGreaterThan(0);

    const openingTree = await app.inject({
      method: "GET",
      url: "/api/openings/tree?fen=rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1&depth=2",
      headers: { cookie },
    });
    expect(openingTree.statusCode).toBe(200);

    const saveLine = await app.inject({
      method: "POST",
      url: "/api/analysis/store",
      headers: { cookie },
      payload: {
        gameId,
        ply: 2,
        fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
        depth: 16,
        pvUci: ["g1f3", "b8c6"],
        evalCp: 24,
      },
    });
    expect(saveLine.statusCode).toBe(201);
    const lineId = saveLine.json().id as number;

    const getLines = await app.inject({
      method: "GET",
      url: `/api/games/${gameId}/engine-lines?ply=2`,
      headers: { cookie },
    });
    expect(getLines.statusCode).toBe(200);
    expect(getLines.json().items).toHaveLength(1);

    const deleteLine = await app.inject({
      method: "DELETE",
      url: `/api/engine-lines/${lineId}`,
      headers: { cookie },
    });
    expect(deleteLine.statusCode).toBe(204);
  });
  }
);
