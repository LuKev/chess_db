import "dotenv/config";
import { Queue, Worker, type Job } from "bullmq";
import { loadWorkerConfig } from "./config.js";
import { createPool } from "./db.js";
import {
  ANALYSIS_QUEUE_NAME,
  type AnalysisJobPayload,
  createBullmqConnection,
  EXPORT_QUEUE_NAME,
  type ExportJobPayload,
  IMPORT_QUEUE_NAME,
  type ImportJobPayload,
  OPENING_BACKFILL_QUEUE_NAME,
  type OpeningBackfillPayload,
  POSITION_BACKFILL_QUEUE_NAME,
  type PositionBackfillPayload,
} from "./infrastructure/queue.js";
import { createObjectStorage } from "./infrastructure/storage.js";
import { processAnalysisJob } from "./analysis/process_analysis_job.js";
import { processExportJob } from "./exports/process_export_job.js";
import { processImportJob } from "./imports/process_import_job.js";
import { processOpeningBackfillJob } from "./backfill/process_opening_backfill_job.js";
import { processPositionBackfillJob } from "./backfill/process_position_backfill_job.js";
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
try {
  await storage.ensureBucket();
} catch (error) {
  if (config.s3StartupCheckStrict) {
    throw error;
  }
  console.warn(
    `[worker] proceeding without strict S3 startup check (import/export jobs may fail): ${String(error)}`
  );
  captureException(error);
}
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

const bullmqConnection = createBullmqConnection(config.redisUrl);

const importQueueStats = new Queue(IMPORT_QUEUE_NAME, {
  connection: bullmqConnection,
});
const analysisQueueStats = new Queue(ANALYSIS_QUEUE_NAME, {
  connection: bullmqConnection,
});
const exportQueueStats = new Queue(EXPORT_QUEUE_NAME, {
  connection: bullmqConnection,
});
const positionBackfillQueueStats = new Queue(POSITION_BACKFILL_QUEUE_NAME, {
  connection: bullmqConnection,
});
const openingBackfillQueueStats = new Queue(OPENING_BACKFILL_QUEUE_NAME, {
  connection: bullmqConnection,
});

console.log(
  `[worker] started (metrics: http://${config.metricsHost}:${config.metricsPort}/metrics)`
);

function userIdFromPayload(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const value = (payload as { userId?: unknown }).userId;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

async function recordDeadLetter(params: {
  queueName: string;
  job: Job | undefined;
  error: unknown;
}): Promise<void> {
  if (!params.job) {
    return;
  }

  const maxAttempts =
    typeof params.job.opts.attempts === "number" && params.job.opts.attempts > 0
      ? params.job.opts.attempts
      : 1;
  const attemptsMade = params.job.attemptsMade;
  if (attemptsMade < maxAttempts) {
    return;
  }

  try {
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
      ) VALUES (
        $1, $2, $3, $4, $5::jsonb, $6, $7, $8
      )`,
      [
        params.queueName,
        params.job.name,
        params.job.id ? String(params.job.id) : null,
        userIdFromPayload(params.job.data),
        JSON.stringify(params.job.data ?? {}),
        attemptsMade,
        maxAttempts,
        String(params.error).slice(0, 2000),
      ]
    );
  } catch (insertError) {
    console.error(`[worker] failed to persist dead-letter event: ${String(insertError)}`);
    captureException(insertError);
  }
}

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
    connection: bullmqConnection,
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
    connection: bullmqConnection,
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
    connection: bullmqConnection,
    concurrency: Math.max(1, Math.floor(config.workerConcurrency / 2)),
  }
);

const positionBackfillWorker = new Worker<PositionBackfillPayload>(
  POSITION_BACKFILL_QUEUE_NAME,
  async (job) => {
    await runInstrumentedJob(POSITION_BACKFILL_QUEUE_NAME, async () => {
      await processPositionBackfillJob({
        pool,
        userId: job.data.userId,
      });
    });
  },
  {
    connection: bullmqConnection,
    concurrency: 1,
  }
);

const openingBackfillWorker = new Worker<OpeningBackfillPayload>(
  OPENING_BACKFILL_QUEUE_NAME,
  async (job) => {
    await runInstrumentedJob(OPENING_BACKFILL_QUEUE_NAME, async () => {
      await processOpeningBackfillJob({
        pool,
        userId: job.data.userId,
      });
    });
  },
  {
    connection: bullmqConnection,
    concurrency: 1,
  }
);

importWorker.on("completed", (job) => {
  console.log(`[worker] completed import job ${job.id}`);
});

importWorker.on("failed", (job, error) => {
  console.error(`[worker] failed import job ${job?.id}: ${String(error)}`);
  captureException(error);
  void recordDeadLetter({
    queueName: IMPORT_QUEUE_NAME,
    job,
    error,
  });
});

analysisWorker.on("completed", (job) => {
  console.log(`[worker] completed analysis job ${job.id}`);
});

analysisWorker.on("failed", (job, error) => {
  console.error(`[worker] failed analysis job ${job?.id}: ${String(error)}`);
  captureException(error);
  void recordDeadLetter({
    queueName: ANALYSIS_QUEUE_NAME,
    job,
    error,
  });
});

exportWorker.on("completed", (job) => {
  console.log(`[worker] completed export job ${job.id}`);
});

exportWorker.on("failed", (job, error) => {
  console.error(`[worker] failed export job ${job?.id}: ${String(error)}`);
  captureException(error);
  void recordDeadLetter({
    queueName: EXPORT_QUEUE_NAME,
    job,
    error,
  });
});

positionBackfillWorker.on("completed", (job) => {
  console.log(`[worker] completed position backfill job ${job.id}`);
});

positionBackfillWorker.on("failed", (job, error) => {
  console.error(`[worker] failed position backfill job ${job?.id}: ${String(error)}`);
  captureException(error);
  void recordDeadLetter({
    queueName: POSITION_BACKFILL_QUEUE_NAME,
    job,
    error,
  });
});

openingBackfillWorker.on("completed", (job) => {
  console.log(`[worker] completed opening backfill job ${job.id}`);
});

openingBackfillWorker.on("failed", (job, error) => {
  console.error(`[worker] failed opening backfill job ${job?.id}: ${String(error)}`);
  captureException(error);
  void recordDeadLetter({
    queueName: OPENING_BACKFILL_QUEUE_NAME,
    job,
    error,
  });
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
  const positionBackfillDepth =
    (await positionBackfillQueueStats.getWaitingCount()) +
    (await positionBackfillQueueStats.getActiveCount()) +
    (await positionBackfillQueueStats.getDelayedCount());
  const openingBackfillDepth =
    (await openingBackfillQueueStats.getWaitingCount()) +
    (await openingBackfillQueueStats.getActiveCount()) +
    (await openingBackfillQueueStats.getDelayedCount());

  updateQueueDepthMetric(metrics, IMPORT_QUEUE_NAME, importDepth);
  updateQueueDepthMetric(metrics, ANALYSIS_QUEUE_NAME, analysisDepth);
  updateQueueDepthMetric(metrics, EXPORT_QUEUE_NAME, exportDepth);
  updateQueueDepthMetric(metrics, POSITION_BACKFILL_QUEUE_NAME, positionBackfillDepth);
  updateQueueDepthMetric(metrics, OPENING_BACKFILL_QUEUE_NAME, openingBackfillDepth);
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
  await positionBackfillWorker.close();
  await openingBackfillWorker.close();

  await importQueueStats.close();
  await analysisQueueStats.close();
  await exportQueueStats.close();
  await positionBackfillQueueStats.close();
  await openingBackfillQueueStats.close();

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
