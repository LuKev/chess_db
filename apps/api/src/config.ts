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
  S3_STARTUP_CHECK_STRICT: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  API_METRICS_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  API_METRICS_PATH: z.string().min(1).default("/metrics"),
  API_SENTRY_DSN: z.string().trim().optional(),
  API_SENTRY_ENV: z.string().trim().optional(),
  PUBLIC_API_ORIGIN: z.string().trim().optional(),
  PUBLIC_WEB_ORIGIN: z.string().trim().optional(),
  ENFORCE_PRODUCTION_TOPOLOGY: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  ENFORCE_CSRF_ORIGIN_CHECK: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  AUTH_RATE_LIMIT_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  AUTH_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(300),
  AUTH_RATE_LIMIT_LOGIN_IP_MAX: z.coerce.number().int().positive().default(20),
  AUTH_RATE_LIMIT_LOGIN_EMAIL_MAX: z.coerce.number().int().positive().default(10),
  AUTH_RATE_LIMIT_REGISTER_IP_MAX: z.coerce.number().int().positive().default(10),
  AUTH_RATE_LIMIT_PASSWORD_RESET_IP_MAX: z.coerce.number().int().positive().default(10),
  AUTH_RATE_LIMIT_PASSWORD_RESET_EMAIL_MAX: z.coerce.number().int().positive().default(5),
  AUTH_RATE_LIMIT_PASSWORD_RESET_CONFIRM_IP_MAX: z
    .coerce.number()
    .int()
    .positive()
    .default(10),
  SMTP_HOST: z.string().trim().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().trim().optional(),
  SMTP_PASS: z.string().trim().optional(),
  SMTP_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  PASSWORD_RESET_FROM: z.string().trim().optional(),
  PASSWORD_RESET_BASE_URL: z.string().trim().optional(),
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
  s3StartupCheckStrict: boolean;
  apiMetricsEnabled: boolean;
  apiMetricsPath: string;
  sentryDsn: string | null;
  sentryEnvironment: string;
  publicApiOrigin: string | null;
  publicWebOrigin: string | null;
  enforceProductionTopology: boolean;
  enforceCsrfOriginCheck: boolean;
  authRateLimitEnabled: boolean;
  authRateLimitWindowSeconds: number;
  authRateLimitLoginIpMax: number;
  authRateLimitLoginEmailMax: number;
  authRateLimitRegisterIpMax: number;
  authRateLimitPasswordResetIpMax: number;
  authRateLimitPasswordResetEmailMax: number;
  authRateLimitPasswordResetConfirmIpMax: number;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  smtpPass: string | null;
  smtpSecure: boolean;
  passwordResetFrom: string | null;
  passwordResetBaseUrl: string | null;
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
    s3StartupCheckStrict: parsed.data.S3_STARTUP_CHECK_STRICT,
    apiMetricsEnabled: parsed.data.API_METRICS_ENABLED,
    apiMetricsPath: parsed.data.API_METRICS_PATH,
    sentryDsn: parsed.data.API_SENTRY_DSN?.trim()
      ? parsed.data.API_SENTRY_DSN.trim()
      : null,
    sentryEnvironment:
      parsed.data.API_SENTRY_ENV?.trim() || parsed.data.NODE_ENV,
    publicApiOrigin: parsed.data.PUBLIC_API_ORIGIN?.trim()
      ? parsed.data.PUBLIC_API_ORIGIN.trim()
      : null,
    publicWebOrigin: parsed.data.PUBLIC_WEB_ORIGIN?.trim()
      ? parsed.data.PUBLIC_WEB_ORIGIN.trim()
      : null,
    enforceProductionTopology: parsed.data.ENFORCE_PRODUCTION_TOPOLOGY,
    enforceCsrfOriginCheck: parsed.data.ENFORCE_CSRF_ORIGIN_CHECK,
    authRateLimitEnabled: parsed.data.AUTH_RATE_LIMIT_ENABLED,
    authRateLimitWindowSeconds: parsed.data.AUTH_RATE_LIMIT_WINDOW_SECONDS,
    authRateLimitLoginIpMax: parsed.data.AUTH_RATE_LIMIT_LOGIN_IP_MAX,
    authRateLimitLoginEmailMax: parsed.data.AUTH_RATE_LIMIT_LOGIN_EMAIL_MAX,
    authRateLimitRegisterIpMax: parsed.data.AUTH_RATE_LIMIT_REGISTER_IP_MAX,
    authRateLimitPasswordResetIpMax: parsed.data.AUTH_RATE_LIMIT_PASSWORD_RESET_IP_MAX,
    authRateLimitPasswordResetEmailMax:
      parsed.data.AUTH_RATE_LIMIT_PASSWORD_RESET_EMAIL_MAX,
    authRateLimitPasswordResetConfirmIpMax:
      parsed.data.AUTH_RATE_LIMIT_PASSWORD_RESET_CONFIRM_IP_MAX,
    smtpHost: parsed.data.SMTP_HOST?.trim() ? parsed.data.SMTP_HOST.trim() : null,
    smtpPort: parsed.data.SMTP_PORT ?? null,
    smtpUser: parsed.data.SMTP_USER?.trim() ? parsed.data.SMTP_USER.trim() : null,
    smtpPass: parsed.data.SMTP_PASS?.trim() ? parsed.data.SMTP_PASS.trim() : null,
    smtpSecure: parsed.data.SMTP_SECURE,
    passwordResetFrom: parsed.data.PASSWORD_RESET_FROM?.trim()
      ? parsed.data.PASSWORD_RESET_FROM.trim()
      : null,
    passwordResetBaseUrl: parsed.data.PASSWORD_RESET_BASE_URL?.trim()
      ? parsed.data.PASSWORD_RESET_BASE_URL.trim()
      : null,
    uploadMaxBytes: parsed.data.UPLOAD_MAX_BYTES,
    autoMigrate: parsed.data.AUTO_MIGRATE,
  };
}
