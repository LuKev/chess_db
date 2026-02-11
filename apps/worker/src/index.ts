import "dotenv/config";
import { Queue, Worker } from "bullmq";
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
import {
  createWorkerMetrics,
  recordJobMetric,
  startWorkerMetricsServer,
  updateHeartbeatMetric,
  updateQueueDepthMetric,
} from "./observability/metrics.js";
import {
  captureException,
  flushSentry,
  initSentry,
} from "./observability/sentry.js";

const config = loadWorkerConfig();
initSentry({
  dsn: config.sentryDsn,
  environment: config.sentryEnvironment,
});

const pool = createPool(config);
const storage = createObjectStorage(config);
const metrics = createWorkerMetrics();
const metricsServer = startWorkerMetricsServer({
  metrics,
  host: config.metricsHost,
  port: config.metricsPort,
  onError: (error) => {
    console.error(`[worker] metrics error: ${String(error)}`);
    captureException(error);
  },
});

const importRedisConnection = createRedisConnection(config.redisUrl);
const analysisRedisConnection = createRedisConnection(config.redisUrl);
const exportRedisConnection = createRedisConnection(config.redisUrl);
const importStatsConnection = createRedisConnection(config.redisUrl);
const analysisStatsConnection = createRedisConnection(config.redisUrl);
const exportStatsConnection = createRedisConnection(config.redisUrl);

const importQueueStats = new Queue(IMPORT_QUEUE_NAME, {
  connection: importStatsConnection,
});
const analysisQueueStats = new Queue(ANALYSIS_QUEUE_NAME, {
  connection: analysisStatsConnection,
});
const exportQueueStats = new Queue(EXPORT_QUEUE_NAME, {
  connection: exportStatsConnection,
});

console.log(
  `[worker] started (metrics: http://${config.metricsHost}:${config.metricsPort}/metrics)`
);

async function runInstrumentedJob(
  queueName: string,
  handler: () => Promise<void>
): Promise<void> {
  const startedAt = Date.now();

  try {
    await handler();
    recordJobMetric(metrics, queueName, "completed", Date.now() - startedAt);
  } catch (error) {
    recordJobMetric(metrics, queueName, "failed", Date.now() - startedAt);
    captureException(error);
    throw error;
  }
}

const importWorker = new Worker<ImportJobPayload>(
  IMPORT_QUEUE_NAME,
  async (job) => {
    await runInstrumentedJob(IMPORT_QUEUE_NAME, async () => {
      await processImportJob({
        pool,
        storage,
        importJobId: job.data.importJobId,
        userId: job.data.userId,
      });
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
    await runInstrumentedJob(ANALYSIS_QUEUE_NAME, async () => {
      await processAnalysisJob({
        pool,
        analysisRequestId: job.data.analysisRequestId,
        userId: job.data.userId,
        stockfishBinary: config.stockfishBinary,
        cancelPollMs: config.analysisCancelPollMs,
      });
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
    await runInstrumentedJob(EXPORT_QUEUE_NAME, async () => {
      await processExportJob({
        pool,
        storage,
        exportJobId: job.data.exportJobId,
        userId: job.data.userId,
      });
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
  captureException(error);
});

analysisWorker.on("completed", (job) => {
  console.log(`[worker] completed analysis job ${job.id}`);
});

analysisWorker.on("failed", (job, error) => {
  console.error(`[worker] failed analysis job ${job?.id}: ${String(error)}`);
  captureException(error);
});

exportWorker.on("completed", (job) => {
  console.log(`[worker] completed export job ${job.id}`);
});

exportWorker.on("failed", (job, error) => {
  console.error(`[worker] failed export job ${job?.id}: ${String(error)}`);
  captureException(error);
});

async function refreshQueueDepthMetrics(): Promise<void> {
  const importDepth =
    (await importQueueStats.getWaitingCount()) +
    (await importQueueStats.getActiveCount()) +
    (await importQueueStats.getDelayedCount());
  const analysisDepth =
    (await analysisQueueStats.getWaitingCount()) +
    (await analysisQueueStats.getActiveCount()) +
    (await analysisQueueStats.getDelayedCount());
  const exportDepth =
    (await exportQueueStats.getWaitingCount()) +
    (await exportQueueStats.getActiveCount()) +
    (await exportQueueStats.getDelayedCount());

  updateQueueDepthMetric(metrics, IMPORT_QUEUE_NAME, importDepth);
  updateQueueDepthMetric(metrics, ANALYSIS_QUEUE_NAME, analysisDepth);
  updateQueueDepthMetric(metrics, EXPORT_QUEUE_NAME, exportDepth);
}

await refreshQueueDepthMetrics();

const queueDepthInterval = setInterval(() => {
  void refreshQueueDepthMetrics().catch((error) => {
    console.error(`[worker] queue depth refresh failed: ${String(error)}`);
    captureException(error);
  });
}, 5_000);

const heartbeat = setInterval(() => {
  updateHeartbeatMetric(metrics);
  console.log(`[worker] heartbeat ${new Date().toISOString()}`);
}, config.heartbeatMs);

updateHeartbeatMetric(metrics);

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  console.log(`[worker] received ${signal}, shutting down`);
  clearInterval(heartbeat);
  clearInterval(queueDepthInterval);

  await importWorker.close();
  await analysisWorker.close();
  await exportWorker.close();

  await importQueueStats.close();
  await analysisQueueStats.close();
  await exportQueueStats.close();

  await importRedisConnection.quit();
  await analysisRedisConnection.quit();
  await exportRedisConnection.quit();
  await importStatsConnection.quit();
  await analysisStatsConnection.quit();
  await exportStatsConnection.quit();
  await storage.close();
  await pool.end();

  await new Promise<void>((resolve, reject) => {
    metricsServer.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });

  await flushSentry();
  process.exit(0);
}

process.on("uncaughtException", (error) => {
  console.error(`[worker] uncaught exception: ${String(error)}`);
  captureException(error);
});

process.on("unhandledRejection", (reason) => {
  console.error(`[worker] unhandled rejection: ${String(reason)}`);
  captureException(reason);
});

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
