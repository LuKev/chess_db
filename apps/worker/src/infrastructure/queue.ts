import { Redis } from "ioredis";

export const IMPORT_QUEUE_NAME = "imports";
export const ANALYSIS_QUEUE_NAME = "analysis";
export const EXPORT_QUEUE_NAME = "exports";
export const POSITION_BACKFILL_QUEUE_NAME = "position_backfill";
export const OPENING_BACKFILL_QUEUE_NAME = "opening_aggregate_backfill";

export type ImportJobPayload = {
  importJobId: number;
  userId: number;
};

export type AnalysisJobPayload = {
  analysisRequestId: number;
  userId: number;
};

export type ExportJobPayload = {
  exportJobId: number;
  userId: number;
};

export type PositionBackfillPayload = {
  userId: number;
};

export type OpeningBackfillPayload = {
  userId: number;
};

export function createRedisConnection(redisUrl: string): Redis {
  return new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}
