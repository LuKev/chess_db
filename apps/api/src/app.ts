import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { attachUserFromSession } from "./auth.js";
import type { AppConfig } from "./config.js";
import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import {
  createAnalysisQueue,
  createExportQueue,
  createImportQueue,
  type AnalysisQueue,
  type ExportQueue,
  type ImportQueue,
} from "./infrastructure/queue.js";
import {
  createObjectStorage,
  type ObjectStorage,
} from "./infrastructure/storage.js";
import { runMigrations } from "./migrations.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerFilterRoutes } from "./routes/filters.js";
import { registerGameRoutes } from "./routes/games.js";
import { registerImportRoutes } from "./routes/imports.js";
import { registerAnalysisRoutes } from "./routes/analysis.js";
import { registerExportRoutes } from "./routes/exports.js";

export type BuildAppOptions = {
  config?: AppConfig;
  pool?: Pool;
  importQueue?: ImportQueue;
  analysisQueue?: AnalysisQueue;
  exportQueue?: ExportQueue;
  objectStorage?: ObjectStorage;
  runMigrationsOnBoot?: boolean;
};

export async function buildApp(
  options: BuildAppOptions = {}
): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const pool = options.pool ?? createPool(config);
  const ownsPool = !options.pool;
  const importQueue = options.importQueue ?? createImportQueue(config);
  const analysisQueue = options.analysisQueue ?? createAnalysisQueue(config);
  const exportQueue = options.exportQueue ?? createExportQueue(config);
  const objectStorage = options.objectStorage ?? createObjectStorage(config);
  const ownsImportQueue = !options.importQueue;
  const ownsAnalysisQueue = !options.analysisQueue;
  const ownsExportQueue = !options.exportQueue;
  const ownsObjectStorage = !options.objectStorage;

  if (options.runMigrationsOnBoot ?? config.autoMigrate) {
    await runMigrations(pool);
  }

  const app = Fastify({ logger: true });

  await app.register(cookie, { secret: config.sessionSecret });
  await app.register(cors, {
    origin: config.corsOrigin,
    credentials: true,
  });
  await app.register(multipart, {
    limits: {
      files: 1,
      fileSize: config.uploadMaxBytes,
    },
  });

  app.addHook("onRequest", async (request) => {
    await attachUserFromSession(request, pool, config);
  });

  app.get("/health", async () => {
    return {
      ok: true,
      service: "api",
      timestamp: new Date().toISOString(),
    };
  });

  app.get("/api/v1/health", async () => {
    return {
      ok: true,
      service: "api",
      version: "v1",
    };
  });

  await registerAuthRoutes(app, pool, config);
  await registerGameRoutes(app, pool);
  await registerFilterRoutes(app, pool);
  await registerImportRoutes(app, pool, config, importQueue, objectStorage);
  await registerAnalysisRoutes(app, pool, analysisQueue);
  await registerExportRoutes(app, pool, exportQueue, objectStorage);

  app.addHook("onClose", async () => {
    if (ownsImportQueue) {
      await importQueue.close();
    }
    if (ownsAnalysisQueue) {
      await analysisQueue.close();
    }
    if (ownsExportQueue) {
      await exportQueue.close();
    }
    if (ownsObjectStorage) {
      await objectStorage.close();
    }
    if (ownsPool) {
      await pool.end();
    }
  });

  return app;
}
