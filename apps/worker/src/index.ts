import "dotenv/config";
import { Worker } from "bullmq";
import { loadWorkerConfig } from "./config.js";
import { createPool } from "./db.js";
import {
  ANALYSIS_QUEUE_NAME,
  type AnalysisJobPayload,
  createRedisConnection,
  EXPORT_QUEUE_NAME,
  type ExportJobPayload,
  IMPORT_QUEUE_NAME,
  type ImportJobPayload,
} from "./infrastructure/queue.js";
import { createObjectStorage } from "./infrastructure/storage.js";
import { processAnalysisJob } from "./analysis/process_analysis_job.js";
import { processExportJob } from "./exports/process_export_job.js";
import { processImportJob } from "./imports/process_import_job.js";

const config = loadWorkerConfig();
const pool = createPool(config);
const storage = createObjectStorage(config);
const importRedisConnection = createRedisConnection(config.redisUrl);
const analysisRedisConnection = createRedisConnection(config.redisUrl);
const exportRedisConnection = createRedisConnection(config.redisUrl);

console.log("[worker] started");

const importWorker = new Worker<ImportJobPayload>(
  IMPORT_QUEUE_NAME,
  async (job) => {
    await processImportJob({
      pool,
      storage,
      importJobId: job.data.importJobId,
      userId: job.data.userId,
    });
  },
  {
    connection: importRedisConnection,
    concurrency: config.workerConcurrency,
  }
);

const analysisWorker = new Worker<AnalysisJobPayload>(
  ANALYSIS_QUEUE_NAME,
  async (job) => {
    await processAnalysisJob({
      pool,
      analysisRequestId: job.data.analysisRequestId,
      userId: job.data.userId,
      stockfishBinary: config.stockfishBinary,
      cancelPollMs: config.analysisCancelPollMs,
    });
  },
  {
    connection: analysisRedisConnection,
    concurrency: Math.max(1, Math.floor(config.workerConcurrency / 2)),
  }
);

const exportWorker = new Worker<ExportJobPayload>(
  EXPORT_QUEUE_NAME,
  async (job) => {
    await processExportJob({
      pool,
      storage,
      exportJobId: job.data.exportJobId,
      userId: job.data.userId,
    });
  },
  {
    connection: exportRedisConnection,
    concurrency: Math.max(1, Math.floor(config.workerConcurrency / 2)),
  }
);

importWorker.on("completed", (job) => {
  console.log(`[worker] completed import job ${job.id}`);
});

importWorker.on("failed", (job, error) => {
  console.error(`[worker] failed import job ${job?.id}: ${String(error)}`);
});

analysisWorker.on("completed", (job) => {
  console.log(`[worker] completed analysis job ${job.id}`);
});

analysisWorker.on("failed", (job, error) => {
  console.error(`[worker] failed analysis job ${job?.id}: ${String(error)}`);
});

exportWorker.on("completed", (job) => {
  console.log(`[worker] completed export job ${job.id}`);
});

exportWorker.on("failed", (job, error) => {
  console.error(`[worker] failed export job ${job?.id}: ${String(error)}`);
});

const heartbeat = setInterval(() => {
  console.log(`[worker] heartbeat ${new Date().toISOString()}`);
}, config.heartbeatMs);

async function shutdown(signal: string): Promise<void> {
  console.log(`[worker] received ${signal}, shutting down`);
  clearInterval(heartbeat);
  await importWorker.close();
  await analysisWorker.close();
  await exportWorker.close();
  await importRedisConnection.quit();
  await analysisRedisConnection.quit();
  await exportRedisConnection.quit();
  await storage.close();
  await pool.end();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
