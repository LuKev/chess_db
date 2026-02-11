import { Redis } from "ioredis";

type CheckLimitParams = {
  scope: string;
  key: string;
  maxAttempts: number;
  windowSeconds: number;
};

export type AuthRateLimitCheckResult = {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
};

export type AuthRateLimiter = {
  checkLimit(params: CheckLimitParams): Promise<AuthRateLimitCheckResult>;
  close(): Promise<void>;
};

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

export function createAuthRateLimiter(redisUrl: string): AuthRateLimiter {
  const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  return {
    async checkLimit(params: CheckLimitParams): Promise<AuthRateLimitCheckResult> {
      const rateKey = `auth-rate:${params.scope}:${normalizeKey(params.key)}`;

      const pipeline = connection.multi();
      pipeline.incr(rateKey);
      pipeline.ttl(rateKey);
      const execResult = await pipeline.exec();

      if (!execResult || execResult.length < 2) {
        throw new Error("Failed to read rate limit state from Redis");
      }

      const countRaw = execResult[0][1];
      const ttlRaw = execResult[1][1];
      const count = typeof countRaw === "number" ? countRaw : Number(countRaw);
      let ttl = typeof ttlRaw === "number" ? ttlRaw : Number(ttlRaw);

      if (count === 1) {
        await connection.expire(rateKey, params.windowSeconds);
        ttl = params.windowSeconds;
      }

      if (!Number.isFinite(ttl) || ttl <= 0) {
        ttl = params.windowSeconds;
      }

      const remaining = Math.max(0, params.maxAttempts - count);
      const allowed = count <= params.maxAttempts;

      return {
        allowed,
        retryAfterSeconds: allowed ? 0 : ttl,
        remaining,
      };
    },
    async close(): Promise<void> {
      await connection.quit();
    },
  };
}
