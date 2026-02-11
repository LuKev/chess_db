import { Queue } from "bullmq";
import { Redis } from "ioredis";
import type { AppConfig } from "../config.js";

export const IMPORT_QUEUE_NAME = "imports";
export const ANALYSIS_QUEUE_NAME = "analysis";
export const EXPORT_QUEUE_NAME = "exports";
export const POSITION_BACKFILL_QUEUE_NAME = "position_backfill";
export const OPENING_BACKFILL_QUEUE_NAME = "opening_aggregate_backfill";

export type ImportJobPayload = {
  importJobId: number;
  userId: number;
};

export type ImportQueue = {
  enqueueImport(payload: ImportJobPayload): Promise<void>;
  close(): Promise<void>;
};

export type AnalysisJobPayload = {
  analysisRequestId: number;
  userId: number;
};

export type AnalysisQueue = {
  enqueueAnalysis(payload: AnalysisJobPayload): Promise<void>;
  close(): Promise<void>;
};

export type ExportJobPayload = {
  exportJobId: number;
  userId: number;
};

export type ExportQueue = {
  enqueueExport(payload: ExportJobPayload): Promise<void>;
  close(): Promise<void>;
};

export type PositionBackfillPayload = {
  userId: number;
};

export type PositionBackfillQueue = {
  enqueuePositionBackfill(payload: PositionBackfillPayload): Promise<void>;
  close(): Promise<void>;
};

export type OpeningBackfillPayload = {
  userId: number;
};

export type OpeningBackfillQueue = {
  enqueueOpeningBackfill(payload: OpeningBackfillPayload): Promise<void>;
  close(): Promise<void>;
};

export function createImportQueue(config: AppConfig): ImportQueue {
  const connection = new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  const queue = new Queue<ImportJobPayload>(IMPORT_QUEUE_NAME, { connection });

  return {
    async enqueueImport(payload: ImportJobPayload): Promise<void> {
      await queue.add("import", payload, {
        jobId: `import-${payload.importJobId}`,
        attempts: config.queueJobAttempts,
        backoff: {
          type: "exponential",
          delay: config.queueJobBackoffMs,
        },
        removeOnComplete: 200,
        removeOnFail: 200,
      });
    },
    async close(): Promise<void> {
      await queue.close();
      await connection.quit();
    },
  };
}

export function createAnalysisQueue(config: AppConfig): AnalysisQueue {
  const connection = new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  const queue = new Queue<AnalysisJobPayload>(ANALYSIS_QUEUE_NAME, { connection });

  return {
    async enqueueAnalysis(payload: AnalysisJobPayload): Promise<void> {
      await queue.add("analyze", payload, {
        jobId: `analysis-${payload.analysisRequestId}`,
        attempts: config.queueJobAttempts,
        backoff: {
          type: "exponential",
          delay: config.queueJobBackoffMs,
        },
        removeOnComplete: 200,
        removeOnFail: 200,
      });
    },
    async close(): Promise<void> {
      await queue.close();
      await connection.quit();
    },
  };
}

export function createExportQueue(config: AppConfig): ExportQueue {
  const connection = new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  const queue = new Queue<ExportJobPayload>(EXPORT_QUEUE_NAME, { connection });

  return {
    async enqueueExport(payload: ExportJobPayload): Promise<void> {
      await queue.add("export", payload, {
        jobId: `export-${payload.exportJobId}`,
        attempts: config.queueJobAttempts,
        backoff: {
          type: "exponential",
          delay: config.queueJobBackoffMs,
        },
        removeOnComplete: 200,
        removeOnFail: 200,
      });
    },
    async close(): Promise<void> {
      await queue.close();
      await connection.quit();
    },
  };
}

export function createPositionBackfillQueue(config: AppConfig): PositionBackfillQueue {
  const connection = new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  const queue = new Queue<PositionBackfillPayload>(POSITION_BACKFILL_QUEUE_NAME, {
    connection,
  });

  return {
    async enqueuePositionBackfill(payload: PositionBackfillPayload): Promise<void> {
      await queue.add("position-backfill", payload, {
        jobId: `position-backfill-${payload.userId}`,
        removeOnComplete: 50,
        removeOnFail: 50,
      });
    },
    async close(): Promise<void> {
      await queue.close();
      await connection.quit();
    },
  };
}

export function createOpeningBackfillQueue(config: AppConfig): OpeningBackfillQueue {
  const connection = new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  const queue = new Queue<OpeningBackfillPayload>(OPENING_BACKFILL_QUEUE_NAME, {
    connection,
  });

  return {
    async enqueueOpeningBackfill(payload: OpeningBackfillPayload): Promise<void> {
      await queue.add("opening-backfill", payload, {
        jobId: `opening-backfill-${payload.userId}`,
        removeOnComplete: 50,
        removeOnFail: 50,
      });
    },
    async close(): Promise<void> {
      await queue.close();
      await connection.quit();
    },
  };
}
