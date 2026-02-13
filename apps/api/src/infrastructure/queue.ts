import { Queue } from "bullmq";
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

function bullmqConnection(config: AppConfig) {
  // Avoid passing ioredis instances into BullMQ. In some deployment layouts (e.g. isolated installs),
  // BullMQ can end up with a different ioredis type than the app, which breaks TypeScript builds.
  return {
    url: config.redisUrl,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}

export function createImportQueue(config: AppConfig): ImportQueue {
  const queue = new Queue<ImportJobPayload>(IMPORT_QUEUE_NAME, {
    connection: bullmqConnection(config),
  });

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
    },
  };
}

export function createAnalysisQueue(config: AppConfig): AnalysisQueue {
  const queue = new Queue<AnalysisJobPayload>(ANALYSIS_QUEUE_NAME, {
    connection: bullmqConnection(config),
  });

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
    },
  };
}

export function createExportQueue(config: AppConfig): ExportQueue {
  const queue = new Queue<ExportJobPayload>(EXPORT_QUEUE_NAME, {
    connection: bullmqConnection(config),
  });

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
    },
  };
}

export function createPositionBackfillQueue(config: AppConfig): PositionBackfillQueue {
  const queue = new Queue<PositionBackfillPayload>(POSITION_BACKFILL_QUEUE_NAME, {
    connection: bullmqConnection(config),
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
    },
  };
}

export function createOpeningBackfillQueue(config: AppConfig): OpeningBackfillQueue {
  const queue = new Queue<OpeningBackfillPayload>(OPENING_BACKFILL_QUEUE_NAME, {
    connection: bullmqConnection(config),
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
    },
  };
}
