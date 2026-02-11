import { createHmac, randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import type { AppConfig } from "./config.js";

export type AuthUser = {
  id: number;
  email: string;
  createdAt: string;
};

function toId(value: number | string): number {
  if (typeof value === "number") {
    return value;
  }

  return Number(value);
}

function hashSessionToken(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token).digest("hex");
}

export async function createSession(
  pool: Pool,
  config: AppConfig,
  userId: number
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashSessionToken(token, config.sessionSecret);
  const expiresAt = new Date(
    Date.now() + config.sessionTtlHours * 60 * 60 * 1000
  );

  await pool.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt]
  );

  return { token, expiresAt };
}

export async function resolveSessionUser(
  pool: Pool,
  config: AppConfig,
  token: string
): Promise<{ user: AuthUser; tokenHash: string } | null> {
  const tokenHash = hashSessionToken(token, config.sessionSecret);

  const result = await pool.query<{
    id: number | string;
    email: string;
    created_at: Date;
  }>(
    `SELECT u.id, u.email, u.created_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
    [tokenHash]
  );

  if (!result.rowCount) {
    return null;
  }

  return {
    tokenHash,
    user: {
      id: toId(result.rows[0].id),
      email: result.rows[0].email,
      createdAt: result.rows[0].created_at.toISOString(),
    },
  };
}

export async function invalidateSession(
  pool: Pool,
  config: AppConfig,
  token: string
): Promise<void> {
  const tokenHash = hashSessionToken(token, config.sessionSecret);
  await pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
}

export async function attachUserFromSession(
  request: FastifyRequest,
  pool: Pool,
  config: AppConfig
): Promise<void> {
  const token = request.cookies[config.sessionCookieName];
  if (!token) {
    return;
  }

  const session = await resolveSessionUser(pool, config, token);
  if (!session) {
    return;
  }

  request.user = session.user;
  request.sessionTokenHash = session.tokenHash;
}

export async function requireUser(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (!request.user) {
    await reply.status(401).send({ error: "Authentication required" });
  }
}
