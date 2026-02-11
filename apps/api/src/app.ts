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
  createOpeningBackfillQueue,
  createPositionBackfillQueue,
  type OpeningBackfillQueue,
  type PositionBackfillQueue,
} from "./infrastructure/queue.js";
import {
  createObjectStorage,
  type ObjectStorage,
} from "./infrastructure/storage.js";
import { createPasswordResetMailer } from "./infrastructure/mailer.js";
import { runMigrations } from "./migrations.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerFilterRoutes } from "./routes/filters.js";
import { registerGameRoutes } from "./routes/games.js";
import { registerImportRoutes } from "./routes/imports.js";
import { registerAnalysisRoutes } from "./routes/analysis.js";
import { registerExportRoutes } from "./routes/exports.js";
import { registerSearchRoutes } from "./routes/search.js";
import { registerOpeningRoutes } from "./routes/openings.js";
import { registerCollectionRoutes } from "./routes/collections.js";
import { registerTagRoutes } from "./routes/tags.js";
import { registerBackfillRoutes } from "./routes/backfill.js";
import { createApiMetrics, registerApiMetrics } from "./observability/metrics.js";
import { captureException } from "./observability/sentry.js";

export type BuildAppOptions = {
  config?: AppConfig;
  pool?: Pool;
  importQueue?: ImportQueue;
  analysisQueue?: AnalysisQueue;
  exportQueue?: ExportQueue;
  positionBackfillQueue?: PositionBackfillQueue;
  openingBackfillQueue?: OpeningBackfillQueue;
  objectStorage?: ObjectStorage;
  runMigrationsOnBoot?: boolean;
};

function siteFromHost(hostname: string): string {
  const host = hostname.toLowerCase();
  if (host === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return host;
  }
  const parts = host.split(".").filter(Boolean);
  if (parts.length < 2) {
    return host;
  }
  return `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
}

function validateProductionTopology(config: AppConfig): void {
  if (config.nodeEnv !== "production" || !config.enforceProductionTopology) {
    return;
  }

  if (!config.publicApiOrigin || !config.publicWebOrigin) {
    throw new Error(
      "PUBLIC_API_ORIGIN and PUBLIC_WEB_ORIGIN are required in production when topology validation is enabled."
    );
  }

  const apiOrigin = new URL(config.publicApiOrigin);
  const webOrigin = new URL(config.publicWebOrigin);
  const corsOrigin = new URL(config.corsOrigin);

  if (apiOrigin.protocol !== "https:" || webOrigin.protocol !== "https:") {
    throw new Error("PUBLIC_API_ORIGIN and PUBLIC_WEB_ORIGIN must use https in production.");
  }

  if (corsOrigin.origin !== webOrigin.origin) {
    throw new Error("CORS_ORIGIN must exactly match PUBLIC_WEB_ORIGIN in production.");
  }

  const apiSite = siteFromHost(apiOrigin.hostname);
  const webSite = siteFromHost(webOrigin.hostname);
  if (apiSite !== webSite) {
    throw new Error(
      `Cookie topology mismatch: API site (${apiSite}) and web site (${webSite}) differ.`
    );
  }
}

export async function buildApp(
  options: BuildAppOptions = {}
): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  validateProductionTopology(config);
  const pool = options.pool ?? createPool(config);
  const ownsPool = !options.pool;
  const importQueue = options.importQueue ?? createImportQueue(config);
  const analysisQueue = options.analysisQueue ?? createAnalysisQueue(config);
  const exportQueue = options.exportQueue ?? createExportQueue(config);
  const positionBackfillQueue =
    options.positionBackfillQueue ?? createPositionBackfillQueue(config);
  const openingBackfillQueue =
    options.openingBackfillQueue ?? createOpeningBackfillQueue(config);
  const objectStorage = options.objectStorage ?? createObjectStorage(config);
  const passwordResetMailer = createPasswordResetMailer(config);
  const ownsImportQueue = !options.importQueue;
  const ownsAnalysisQueue = !options.analysisQueue;
  const ownsExportQueue = !options.exportQueue;
  const ownsPositionBackfillQueue = !options.positionBackfillQueue;
  const ownsOpeningBackfillQueue = !options.openingBackfillQueue;
  const ownsObjectStorage = !options.objectStorage;

  if (options.runMigrationsOnBoot ?? config.autoMigrate) {
    await runMigrations(pool);
  }
  await objectStorage.ensureBucket();

  const app = Fastify({ logger: true });
  const apiMetrics = config.apiMetricsEnabled ? createApiMetrics() : null;

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

  if (apiMetrics) {
    registerApiMetrics(app, apiMetrics, config.apiMetricsPath);
  }

  await registerAuthRoutes(app, pool, config, passwordResetMailer);
  await registerGameRoutes(app, pool);
  await registerFilterRoutes(app, pool);
  await registerImportRoutes(app, pool, config, importQueue, objectStorage);
  await registerAnalysisRoutes(app, pool, analysisQueue);
  await registerExportRoutes(app, pool, exportQueue, objectStorage);
  await registerSearchRoutes(app, pool);
  await registerOpeningRoutes(app, pool);
  await registerCollectionRoutes(app, pool);
  await registerTagRoutes(app, pool);
  await registerBackfillRoutes(app, positionBackfillQueue, openingBackfillQueue);

  app.setErrorHandler((error, request, reply) => {
    captureException(error);
    request.log.error(error);

    if (reply.sent) {
      return;
    }

    const statusCode =
      typeof (error as { statusCode?: unknown }).statusCode === "number"
        ? (error as { statusCode: number }).statusCode
        : 500;
    const publicMessage =
      typeof (error as { message?: unknown }).message === "string"
        ? (error as { message: string }).message
        : "Request failed";

    reply.status(statusCode).send({
      error: statusCode >= 500 ? "Internal server error" : publicMessage,
    });
  });

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
    if (ownsPositionBackfillQueue) {
      await positionBackfillQueue.close();
    }
    if (ownsOpeningBackfillQueue) {
      await openingBackfillQueue.close();
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
