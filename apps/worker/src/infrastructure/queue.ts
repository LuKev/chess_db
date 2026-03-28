export const IMPORT_QUEUE_NAME = "imports";
export const ANALYSIS_QUEUE_NAME = "analysis";
export const EXPORT_QUEUE_NAME = "exports";
export const POSITION_BACKFILL_QUEUE_NAME = "position_backfill";
export const OPENING_BACKFILL_QUEUE_NAME = "opening_aggregate_backfill";
export const GAME_ANALYSIS_QUEUE_NAME = "game_analysis";
export const AUTO_ANNOTATION_QUEUE_NAME = "auto_annotation";

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

export type GameAnalysisJobPayload = {
  gameAnalysisJobId: number;
  userId: number;
};

export type AutoAnnotationJobPayload = {
  autoAnnotationJobId: number;
  userId: number;
};

export type PositionBackfillPayload = {
  userId: number;
};

export type PositionBackfillQueue = {
  enqueuePositionBackfill(payload: PositionBackfillPayload): Promise<void>;
};

export type OpeningBackfillPayload = {
  userId: number;
};

export type OpeningBackfillQueue = {
  enqueueOpeningBackfill(payload: OpeningBackfillPayload): Promise<void>;
};

export type GameAnalysisQueue = {
  enqueueGameAnalysis(payload: GameAnalysisJobPayload): Promise<void>;
};

export type AutoAnnotationQueue = {
  enqueueAutoAnnotation(payload: AutoAnnotationJobPayload): Promise<void>;
};

export function createBullmqConnection(redisUrl: string) {
  // Avoid passing ioredis instances into BullMQ. In some deployment layouts (e.g. isolated installs),
  // BullMQ can end up with a different ioredis type than the app, which breaks TypeScript builds.
  return {
    url: redisUrl,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}
