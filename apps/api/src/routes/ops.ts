import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { requireUser } from "../auth.js";

const DeadLetterQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

export async function registerOpsRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  app.get("/api/ops/dead-letters", { preHandler: requireUser }, async (request, reply) => {
    const parsed = DeadLetterQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid query params",
        details: parsed.error.flatten(),
      });
    }

    const offset = (parsed.data.page - 1) * parsed.data.pageSize;
    const countResult = await pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM queue_dead_letters
       WHERE user_id = $1`,
      [request.user!.id]
    );

    const rows = await pool.query<{
      id: number | string;
      queue_name: string;
      job_name: string;
      job_id: string | null;
      attempts_made: number;
      max_attempts: number;
      failed_reason: string | null;
      created_at: Date;
    }>(
      `SELECT
        id,
        queue_name,
        job_name,
        job_id,
        attempts_made,
        max_attempts,
        failed_reason,
        created_at
       FROM queue_dead_letters
       WHERE user_id = $1
       ORDER BY id DESC
       LIMIT $2 OFFSET $3`,
      [request.user!.id, parsed.data.pageSize, offset]
    );

    return {
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      total: Number(countResult.rows[0].total),
      items: rows.rows.map((row) => ({
        id: typeof row.id === "number" ? row.id : Number(row.id),
        queueName: row.queue_name,
        jobName: row.job_name,
        jobId: row.job_id,
        attemptsMade: row.attempts_made,
        maxAttempts: row.max_attempts,
        failedReason: row.failed_reason,
        createdAt: row.created_at.toISOString(),
      })),
    };
  });
}
