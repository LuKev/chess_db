import argon2 from "argon2";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import type { AuthRateLimiter } from "../infrastructure/auth_rate_limiter.js";
import type { PasswordResetMailer } from "../infrastructure/mailer.js";
import {
  createSession,
  invalidateSession,
  requireUser,
} from "../auth.js";

const CredentialsSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8).max(256),
});

const PasswordResetRequestSchema = z.object({
  email: z.string().trim().email(),
});

const PasswordResetConfirmSchema = z.object({
  token: z.string().trim().min(32).max(256),
  newPassword: z.string().min(8).max(256),
});

const PASSWORD_RESET_TTL_MINUTES = 60;

function toId(value: number | string): number {
  if (typeof value === "number") {
    return value;
  }

  return Number(value);
}

function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function clientIp(request: FastifyRequest): string {
  const forwardedFor = request.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.trim().length > 0) {
    return forwardedFor.split(",")[0].trim();
  }
  return request.ip;
}

async function enforceRateLimit(params: {
  app: FastifyInstance;
  reply: FastifyReply;
  limiter: AuthRateLimiter | null;
  scope: string;
  key: string;
  maxAttempts: number;
  windowSeconds: number;
  message: string;
}): Promise<boolean> {
  if (!params.limiter) {
    return false;
  }

  try {
    const result = await params.limiter.checkLimit({
      scope: params.scope,
      key: params.key,
      maxAttempts: params.maxAttempts,
      windowSeconds: params.windowSeconds,
    });

    if (result.allowed) {
      return false;
    }

    params.reply.header("Retry-After", String(result.retryAfterSeconds));
    await params.reply.status(429).send({ error: params.message });
    return true;
  } catch (error) {
    params.app.log.warn({ error }, "Auth rate limiter unavailable");
    return false;
  }
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  pool: Pool,
  config: AppConfig,
  mailer: PasswordResetMailer,
  authRateLimiter: AuthRateLimiter | null
): Promise<void> {
  app.post("/api/auth/register", async (request, reply) => {
    const parsed = CredentialsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid request body",
        details: parsed.error.flatten(),
      });
    }

    const email = parsed.data.email.toLowerCase();
    const ip = clientIp(request);
    const registerRateLimited = await enforceRateLimit({
      app,
      reply,
      limiter: authRateLimiter,
      scope: "register-ip",
      key: ip,
      maxAttempts: config.authRateLimitRegisterIpMax,
      windowSeconds: config.authRateLimitWindowSeconds,
      message: "Too many registration attempts. Please try again later.",
    });
    if (registerRateLimited) {
      return;
    }

    const passwordHash = await argon2.hash(parsed.data.password, {
      type: argon2.argon2id,
    });

    try {
      const userResult = await pool.query<{
        id: number | string;
        email: string;
        created_at: Date;
      }>(
        `INSERT INTO users (email, password_hash)
         VALUES ($1, $2)
         RETURNING id, email, created_at`,
        [email, passwordHash]
      );

      const userId = toId(userResult.rows[0].id);
      const session = await createSession(pool, config, userId);
      reply.setCookie(config.sessionCookieName, session.token, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: config.nodeEnv === "production",
        expires: session.expiresAt,
      });

      return reply.status(201).send({
        user: {
          id: userId,
          email: userResult.rows[0].email,
          createdAt: userResult.rows[0].created_at.toISOString(),
        },
      });
    } catch (error) {
      if (String(error).includes("duplicate key")) {
        return reply.status(409).send({ error: "Email already registered" });
      }

      request.log.error(error);
      return reply.status(500).send({ error: "Failed to register" });
    }
  });

  app.post("/api/auth/login", async (request, reply) => {
    const parsed = CredentialsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid request body",
        details: parsed.error.flatten(),
      });
    }

    const email = parsed.data.email.toLowerCase();
    const ip = clientIp(request);
    const loginIpLimited = await enforceRateLimit({
      app,
      reply,
      limiter: authRateLimiter,
      scope: "login-ip",
      key: ip,
      maxAttempts: config.authRateLimitLoginIpMax,
      windowSeconds: config.authRateLimitWindowSeconds,
      message: "Too many login attempts. Please try again later.",
    });
    if (loginIpLimited) {
      return;
    }
    const loginEmailLimited = await enforceRateLimit({
      app,
      reply,
      limiter: authRateLimiter,
      scope: "login-email",
      key: email,
      maxAttempts: config.authRateLimitLoginEmailMax,
      windowSeconds: config.authRateLimitWindowSeconds,
      message: "Too many login attempts for this account. Please try again later.",
    });
    if (loginEmailLimited) {
      return;
    }

    const userResult = await pool.query<{
      id: number | string;
      email: string;
      password_hash: string;
      created_at: Date;
    }>(
      `SELECT id, email, password_hash, created_at
       FROM users
       WHERE email = $1`,
      [email]
    );

    if (!userResult.rowCount) {
      return reply.status(401).send({ error: "Invalid email or password" });
    }

    const user = userResult.rows[0];
    const isValid = await argon2.verify(user.password_hash, parsed.data.password);
    if (!isValid) {
      return reply.status(401).send({ error: "Invalid email or password" });
    }

    const userId = toId(user.id);
    const session = await createSession(pool, config, userId);
    reply.setCookie(config.sessionCookieName, session.token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: config.nodeEnv === "production",
      expires: session.expiresAt,
    });

    return {
      user: {
        id: userId,
        email: user.email,
        createdAt: user.created_at.toISOString(),
      },
    };
  });

  app.get("/api/auth/me", { preHandler: requireUser }, async (request) => {
    return { user: request.user };
  });

  app.post("/api/auth/logout", { preHandler: requireUser }, async (request, reply) => {
    const token = request.cookies[config.sessionCookieName];
    if (token) {
      await invalidateSession(pool, config, token);
    }

    reply.clearCookie(config.sessionCookieName, {
      path: "/",
      sameSite: "lax",
      secure: config.nodeEnv === "production",
    });
    return { ok: true };
  });

  app.post("/api/auth/password-reset/request", async (request, reply) => {
    const parsed = PasswordResetRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid request body",
        details: parsed.error.flatten(),
      });
    }

    const email = parsed.data.email.toLowerCase();
    const ip = clientIp(request);
    const resetIpLimited = await enforceRateLimit({
      app,
      reply,
      limiter: authRateLimiter,
      scope: "password-reset-request-ip",
      key: ip,
      maxAttempts: config.authRateLimitPasswordResetIpMax,
      windowSeconds: config.authRateLimitWindowSeconds,
      message: "Too many password reset attempts. Please try again later.",
    });
    if (resetIpLimited) {
      return;
    }
    const resetEmailLimited = await enforceRateLimit({
      app,
      reply,
      limiter: authRateLimiter,
      scope: "password-reset-request-email",
      key: email,
      maxAttempts: config.authRateLimitPasswordResetEmailMax,
      windowSeconds: config.authRateLimitWindowSeconds,
      message: "Too many password reset attempts for this account. Please try again later.",
    });
    if (resetEmailLimited) {
      return;
    }

    const userResult = await pool.query<{ id: number | string }>(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );

    let resetToken: string | null = null;
    if (userResult.rowCount) {
      const userId = toId(userResult.rows[0].id);
      resetToken = randomBytes(32).toString("hex");
      const tokenHash = hashResetToken(resetToken);
      await pool.query(
        `DELETE FROM password_reset_tokens
         WHERE user_id = $1 OR expires_at < NOW()`,
        [userId]
      );
      await pool.query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 minute'))`,
        [userId, tokenHash, PASSWORD_RESET_TTL_MINUTES]
      );

      try {
        await mailer.sendPasswordResetEmail({
          email,
          token: resetToken,
        });
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({
          error: "Failed to send password reset email",
        });
      }
    }

    const response: { ok: boolean; resetToken?: string } = { ok: true };
    if (config.nodeEnv !== "production" && resetToken) {
      response.resetToken = resetToken;
    }

    return response;
  });

  app.post("/api/auth/password-reset/confirm", async (request, reply) => {
    const parsed = PasswordResetConfirmSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid request body",
        details: parsed.error.flatten(),
      });
    }

    const ip = clientIp(request);
    const confirmLimited = await enforceRateLimit({
      app,
      reply,
      limiter: authRateLimiter,
      scope: "password-reset-confirm-ip",
      key: ip,
      maxAttempts: config.authRateLimitPasswordResetConfirmIpMax,
      windowSeconds: config.authRateLimitWindowSeconds,
      message: "Too many password reset confirmations. Please try again later.",
    });
    if (confirmLimited) {
      return;
    }

    const tokenHash = hashResetToken(parsed.data.token);
    const tokenResult = await pool.query<{
      id: number | string;
      user_id: number | string;
    }>(
      `SELECT id, user_id
       FROM password_reset_tokens
       WHERE token_hash = $1
         AND used_at IS NULL
         AND expires_at > NOW()`,
      [tokenHash]
    );

    if (!tokenResult.rowCount) {
      return reply.status(400).send({ error: "Invalid or expired reset token" });
    }

    const resetTokenId = toId(tokenResult.rows[0].id);
    const userId = toId(tokenResult.rows[0].user_id);
    const newPasswordHash = await argon2.hash(parsed.data.newPassword, {
      type: argon2.argon2id,
    });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE users
         SET password_hash = $2
         WHERE id = $1`,
        [userId, newPasswordHash]
      );
      await client.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
      await client.query(
        `UPDATE password_reset_tokens
         SET used_at = NOW()
         WHERE id = $1`,
        [resetTokenId]
      );
      await client.query(
        `DELETE FROM password_reset_tokens
         WHERE user_id = $1
           AND id <> $2`,
        [userId, resetTokenId]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      request.log.error(error);
      return reply.status(500).send({ error: "Failed to reset password" });
    } finally {
      client.release();
    }

    return { ok: true };
  });
}
