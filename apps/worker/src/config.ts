export type WorkerConfig = {
  heartbeatMs: number;
  workerConcurrency: number;
  metricsHost: string;
  metricsPort: number;
  databaseUrl: string;
  redisUrl: string;
  s3Endpoint: string;
  s3Region: string;
  s3AccessKey: string;
  s3SecretKey: string;
  s3Bucket: string;
  s3ForcePathStyle: boolean;
  s3StartupCheckStrict: boolean;
  stockfishBinary: string;
  analysisCancelPollMs: number;
  sentryDsn: string | null;
  sentryEnvironment: string;
};

export function loadWorkerConfig(
  env: NodeJS.ProcessEnv = process.env
): WorkerConfig {
  const rawHeartbeat = env.WORKER_HEARTBEAT_MS ?? "30000";
  const heartbeatMs = Number(rawHeartbeat);
  const rawConcurrency = env.WORKER_CONCURRENCY ?? "2";
  const workerConcurrency = Number(rawConcurrency);
  const metricsHost = env.WORKER_METRICS_HOST ?? "0.0.0.0";
  const rawMetricsPort = env.WORKER_METRICS_PORT ?? "9465";
  const metricsPort = Number(rawMetricsPort);
  const databaseUrl = env.DATABASE_URL;
  const redisUrl = env.REDIS_URL;
  const s3Endpoint = env.S3_ENDPOINT;
  const s3Region = env.S3_REGION ?? "us-east-1";
  const s3AccessKey = env.S3_ACCESS_KEY;
  const s3SecretKey = env.S3_SECRET_KEY;
  const s3Bucket = env.S3_BUCKET;
  const s3ForcePathStyle = (env.S3_FORCE_PATH_STYLE ?? "true") === "true";
  const s3StartupCheckStrict = (env.S3_STARTUP_CHECK_STRICT ?? "true") === "true";
  const stockfishBinary = env.STOCKFISH_BINARY ?? "stockfish";
  const rawAnalysisCancelPollMs = env.ANALYSIS_CANCEL_POLL_MS ?? "500";
  const analysisCancelPollMs = Number(rawAnalysisCancelPollMs);
  const sentryDsn = env.WORKER_SENTRY_DSN?.trim() || null;
  const sentryEnvironment = env.WORKER_SENTRY_ENV?.trim() || env.NODE_ENV || "development";

  if (!Number.isInteger(heartbeatMs) || heartbeatMs <= 0) {
    throw new Error(
      `Invalid WORKER_HEARTBEAT_MS value: ${rawHeartbeat}. Must be a positive integer.`
    );
  }
  if (!Number.isInteger(workerConcurrency) || workerConcurrency <= 0) {
    throw new Error(
      `Invalid WORKER_CONCURRENCY value: ${rawConcurrency}. Must be a positive integer.`
    );
  }
  if (!Number.isInteger(metricsPort) || metricsPort <= 0 || metricsPort > 65535) {
    throw new Error(
      `Invalid WORKER_METRICS_PORT value: ${rawMetricsPort}. Must be an integer between 1 and 65535.`
    );
  }
  if (!databaseUrl) {
    throw new Error("Missing DATABASE_URL");
  }
  if (!redisUrl) {
    throw new Error("Missing REDIS_URL");
  }
  if (!s3Endpoint || !s3AccessKey || !s3SecretKey || !s3Bucket) {
    throw new Error(
      "Missing one or more required S3 settings (S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET)."
    );
  }
  if (!Number.isInteger(analysisCancelPollMs) || analysisCancelPollMs <= 0) {
    throw new Error(
      `Invalid ANALYSIS_CANCEL_POLL_MS value: ${rawAnalysisCancelPollMs}. Must be a positive integer.`
    );
  }

  return {
    heartbeatMs,
    workerConcurrency,
    metricsHost,
    metricsPort,
    databaseUrl,
    redisUrl,
    s3Endpoint,
    s3Region,
    s3AccessKey,
    s3SecretKey,
    s3Bucket,
    s3ForcePathStyle,
    s3StartupCheckStrict,
    stockfishBinary,
    analysisCancelPollMs,
    sentryDsn,
    sentryEnvironment,
  };
}
