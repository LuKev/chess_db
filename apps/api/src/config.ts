import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().min(1).default("0.0.0.0"),
  CORS_ORIGIN: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(16),
  SESSION_COOKIE_NAME: z.string().min(1).default("chessdb_session"),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24 * 7),
  REDIS_URL: z.string().min(1),
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(100 * 1024 * 1024),
  AUTO_MIGRATE: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
});

export type AppConfig = {
  nodeEnv: "development" | "test" | "production";
  port: number;
  host: string;
  corsOrigin: string;
  databaseUrl: string;
  sessionSecret: string;
  sessionCookieName: string;
  sessionTtlHours: number;
  redisUrl: string;
  s3Endpoint: string;
  s3Region: string;
  s3AccessKey: string;
  s3SecretKey: string;
  s3Bucket: string;
  s3ForcePathStyle: boolean;
  uploadMaxBytes: number;
  autoMigrate: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);

  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${message}`);
  }

  return {
    nodeEnv: parsed.data.NODE_ENV,
    port: parsed.data.PORT,
    host: parsed.data.HOST,
    corsOrigin: parsed.data.CORS_ORIGIN,
    databaseUrl: parsed.data.DATABASE_URL,
    sessionSecret: parsed.data.SESSION_SECRET,
    sessionCookieName: parsed.data.SESSION_COOKIE_NAME,
    sessionTtlHours: parsed.data.SESSION_TTL_HOURS,
    redisUrl: parsed.data.REDIS_URL,
    s3Endpoint: parsed.data.S3_ENDPOINT,
    s3Region: parsed.data.S3_REGION,
    s3AccessKey: parsed.data.S3_ACCESS_KEY,
    s3SecretKey: parsed.data.S3_SECRET_KEY,
    s3Bucket: parsed.data.S3_BUCKET,
    s3ForcePathStyle: parsed.data.S3_FORCE_PATH_STYLE,
    uploadMaxBytes: parsed.data.UPLOAD_MAX_BYTES,
    autoMigrate: parsed.data.AUTO_MIGRATE,
  };
}
