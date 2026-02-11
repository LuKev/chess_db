import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { requireUser } from "../auth.js";
import type { AnalysisQueue } from "../infrastructure/queue.js";

const CreateAnalysisSchema = z.object({
  fen: z.string().trim().min(1).max(2048),
  depth: z.number().int().min(1).max(40).default(18),
  nodes: z.number().int().positive().max(50_000_000).optional(),
  timeMs: z.number().int().positive().max(120_000).optional(),
});

function toId(value: number | string): number {
  if (typeof value === "number") {
    return value;
  }
  return Number(value);
}

export async function registerAnalysisRoutes(
  app: FastifyInstance,
  pool: Pool,
  queue: AnalysisQueue
): Promise<void> {
  app.post("/api/analysis", { preHandler: requireUser }, async (request, reply) => {
    const parsed = CreateAnalysisSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid request body",
        details: parsed.error.flatten(),
      });
    }

    const payload = parsed.data;
    const inFlightCount = await pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM engine_requests
       WHERE user_id = $1
         AND status IN ('queued', 'running')`,
      [request.user!.id]
    );

    if (Number(inFlightCount.rows[0].total) >= 3) {
      return reply.status(429).send({
        error: "Too many in-flight analysis requests. Please wait for current jobs to finish.",
      });
    }

    const createResult = await pool.query<{ id: number | string }>(
      `INSERT INTO engine_requests (user_id, status, fen, depth, nodes, time_ms)
       VALUES ($1, 'queued', $2, $3, $4, $5)
       RETURNING id`,
      [request.user!.id, payload.fen, payload.depth, payload.nodes ?? null, payload.timeMs ?? null]
    );

    const analysisRequestId = toId(createResult.rows[0].id);

    try {
      await queue.enqueueAnalysis({
        analysisRequestId,
        userId: request.user!.id,
      });

      return reply.status(201).send({
        id: analysisRequestId,
        status: "queued",
      });
    } catch (error) {
      request.log.error(error);
      await pool.query(
        `UPDATE engine_requests
         SET status = 'failed',
             error_message = 'Failed to enqueue analysis request',
             updated_at = NOW()
         WHERE id = $1`,
        [analysisRequestId]
      );

      return reply.status(500).send({ error: "Failed to enqueue analysis request" });
    }
  });

  app.get<{ Params: { id: string } }>(
    "/api/analysis/:id",
    { preHandler: requireUser },
    async (request, reply) => {
      const analysisRequestId = Number(request.params.id);
      if (!Number.isInteger(analysisRequestId) || analysisRequestId <= 0) {
        return reply.status(400).send({ error: "Invalid analysis id" });
      }

      const result = await pool.query<{
        id: number | string;
        status: string;
        fen: string;
        depth: number | null;
        nodes: number | null;
        time_ms: number | null;
        best_move: string | null;
        principal_variation: string | null;
        eval_cp: number | null;
        eval_mate: number | null;
        error_message: string | null;
        created_at: Date;
        updated_at: Date;
      }>(
        `SELECT
          id,
          status,
          fen,
          depth,
          nodes,
          time_ms,
          best_move,
          principal_variation,
          eval_cp,
          eval_mate,
          error_message,
          created_at,
          updated_at
        FROM engine_requests
        WHERE id = $1 AND user_id = $2`,
        [analysisRequestId, request.user!.id]
      );

      if (!result.rowCount) {
        return reply.status(404).send({ error: "Analysis request not found" });
      }

      const row = result.rows[0];
      return {
        id: toId(row.id),
        status: row.status,
        fen: row.fen,
        limits: {
          depth: row.depth,
          nodes: row.nodes,
          timeMs: row.time_ms,
        },
        result: {
          bestMove: row.best_move,
          pv: row.principal_variation,
          evalCp: row.eval_cp,
          evalMate: row.eval_mate,
        },
        error: row.error_message,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      };
    }
  );

  app.get<{ Params: { id: string } }>(
    "/api/analysis/:id/stream",
    { preHandler: requireUser },
    async (request, reply) => {
      const analysisRequestId = Number(request.params.id);
      if (!Number.isInteger(analysisRequestId) || analysisRequestId <= 0) {
        return reply.status(400).send({ error: "Invalid analysis id" });
      }

      reply.raw.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });

      let stopped = false;

      const sendState = async (): Promise<void> => {
        const result = await pool.query<{
          id: number | string;
          status: string;
          best_move: string | null;
          principal_variation: string | null;
          eval_cp: number | null;
          eval_mate: number | null;
          error_message: string | null;
          updated_at: Date;
        }>(
          `SELECT
            id,
            status,
            best_move,
            principal_variation,
            eval_cp,
            eval_mate,
            error_message,
            updated_at
          FROM engine_requests
          WHERE id = $1 AND user_id = $2`,
          [analysisRequestId, request.user!.id]
        );

        if (!result.rowCount) {
          reply.raw.write(
            `event: error\ndata: ${JSON.stringify({ error: "Analysis request not found" })}\n\n`
          );
          stopped = true;
          return;
        }

        const row = result.rows[0];
        reply.raw.write(
          `data: ${JSON.stringify({
            id: toId(row.id),
            status: row.status,
            result: {
              bestMove: row.best_move,
              pv: row.principal_variation,
              evalCp: row.eval_cp,
              evalMate: row.eval_mate,
            },
            error: row.error_message,
            updatedAt: row.updated_at.toISOString(),
          })}\n\n`
        );

        if (["completed", "failed", "cancelled"].includes(row.status)) {
          stopped = true;
        }
      };

      const interval = setInterval(() => {
        void sendState().catch((error) => {
          app.log.error(error);
          stopped = true;
        });
      }, 1000);

      request.raw.on("close", () => {
        stopped = true;
      });

      while (!stopped) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      clearInterval(interval);
      if (!reply.raw.writableEnded) {
        reply.raw.end();
      }
      return reply;
    }
  );

  app.post<{ Params: { id: string } }>(
    "/api/analysis/:id/cancel",
    { preHandler: requireUser },
    async (request, reply) => {
      const analysisRequestId = Number(request.params.id);
      if (!Number.isInteger(analysisRequestId) || analysisRequestId <= 0) {
        return reply.status(400).send({ error: "Invalid analysis id" });
      }

      const result = await pool.query<{
        status: string;
      }>(
        `UPDATE engine_requests
         SET cancel_requested = TRUE,
             status = CASE WHEN status = 'queued' THEN 'cancelled' ELSE status END,
             updated_at = NOW()
         WHERE id = $1 AND user_id = $2
         RETURNING status`,
        [analysisRequestId, request.user!.id]
      );

      if (!result.rowCount) {
        return reply.status(404).send({ error: "Analysis request not found" });
      }

      return {
        id: analysisRequestId,
        status: result.rows[0].status,
      };
    }
  );
}
