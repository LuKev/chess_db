import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createPool, resetDatabase } from "../src/db.js";
import type {
  AnalysisQueue,
  ExportQueue,
  ImportQueue,
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
    const noOpStorage: ObjectStorage = {
      ensureBucket: async () => {},
      uploadObject: async ({ key, contentType, body }) => {
        for await (const unusedChunk of body as AsyncIterable<unknown>) {
          // Drain stream to emulate storage upload consumption in tests.
          void unusedChunk;
        }
        uploadedObjects.push({ key, contentType });
      },
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
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (pool) {
      await pool.end();
    }
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

    const listA = await app.inject({
      method: "GET",
      url: "/api/filters",
      headers: {
        cookie: cookieA,
      },
    });

    expect(listA.statusCode).toBe(200);
    expect(listA.json().items).toHaveLength(1);

    const listB = await app.inject({
      method: "GET",
      url: "/api/filters",
      headers: {
        cookie: cookieB,
      },
    });

    expect(listB.statusCode).toBe(200);
    expect(listB.json().items).toHaveLength(0);

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
  });
  }
);
