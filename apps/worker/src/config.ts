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

function requiredEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing ${key}`);
  }
  return value;
}

function parsePositiveIntEnv(
  env: NodeJS.ProcessEnv,
  key: string,
  defaultValue: number
): number {
  const raw = env[key] ?? String(defaultValue);
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `Invalid ${key} value: ${raw}. Must be a positive integer.`
    );
  }
  return value;
}

function parsePortEnv(
  env: NodeJS.ProcessEnv,
  key: string,
  defaultValue: number
): number {
  const raw = env[key] ?? String(defaultValue);
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    throw new Error(
      `Invalid ${key} value: ${raw}. Must be an integer between 1 and 65535.`
    );
  }
  return value;
}

function parseBoolEnv(
  env: NodeJS.ProcessEnv,
  key: string,
  defaultValue: boolean
): boolean {
  const raw = env[key];
  if (raw === undefined) {
    return defaultValue;
  }

  const normalized = raw.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }

  throw new Error(`Invalid ${key} value: ${raw}. Must be true or false.`);
}

function optionalTrimmedEnv(
  env: NodeJS.ProcessEnv,
  key: string
): string | null {
  const value = env[key]?.trim();
  return value ? value : null;
}

export function loadWorkerConfig(
  env: NodeJS.ProcessEnv = process.env
): WorkerConfig {
  const heartbeatMs = parsePositiveIntEnv(env, "WORKER_HEARTBEAT_MS", 30000);
  const workerConcurrency = parsePositiveIntEnv(env, "WORKER_CONCURRENCY", 2);
  const metricsHost = env.WORKER_METRICS_HOST ?? "0.0.0.0";
  const metricsPort = parsePortEnv(env, "WORKER_METRICS_PORT", 9465);
  const databaseUrl = requiredEnv(env, "DATABASE_URL");
  const redisUrl = requiredEnv(env, "REDIS_URL");
  const s3Endpoint = requiredEnv(env, "S3_ENDPOINT");
  const s3Region = env.S3_REGION ?? "us-east-1";
  const s3AccessKey = requiredEnv(env, "S3_ACCESS_KEY");
  const s3SecretKey = requiredEnv(env, "S3_SECRET_KEY");
  const s3Bucket = requiredEnv(env, "S3_BUCKET");
  const s3ForcePathStyle = parseBoolEnv(env, "S3_FORCE_PATH_STYLE", true);
  const s3StartupCheckStrict = parseBoolEnv(
    env,
    "S3_STARTUP_CHECK_STRICT",
    true
  );
  const stockfishBinary = env.STOCKFISH_BINARY ?? "stockfish";
  const analysisCancelPollMs = parsePositiveIntEnv(
    env,
    "ANALYSIS_CANCEL_POLL_MS",
    500
  );
  const sentryDsn = optionalTrimmedEnv(env, "WORKER_SENTRY_DSN");
  const sentryEnvironment =
    env.WORKER_SENTRY_ENV?.trim() || env.NODE_ENV || "development";

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
