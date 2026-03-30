import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { requireUser } from "../auth.js";
import type { AnalysisQueue, AutoAnnotationQueue, GameAnalysisQueue } from "../infrastructure/queue.js";
import { normalizeFen } from "../chess/fen.js";
import { parseIdempotencyKey } from "../http/idempotency.js";

const CreateAnalysisSchema = z.object({
  fen: z.string().trim().min(1).max(2048),
  depth: z.number().int().min(1).max(40).default(18),
  nodes: z.number().int().positive().max(50_000_000).optional(),
  timeMs: z.number().int().positive().max(120_000).optional(),
  engine: z.string().trim().min(1).max(64).default("stockfish"),
  multipv: z.number().int().min(1).max(20).default(1),
  gameId: z.number().int().positive().optional(),
  ply: z.number().int().min(0).optional(),
  autoStore: z.boolean().default(false),
  source: z.string().trim().min(1).max(64).default("manual"),
});

const StoreAnalysisSchema = z.object({
  gameId: z.number().int().positive(),
  ply: z.number().int().min(0),
  fen: z.string().trim().min(1).max(2048),
  engine: z.string().trim().min(1).max(64).default("stockfish"),
  depth: z.number().int().min(1).max(60).optional(),
  multipv: z.number().int().min(1).max(20).optional(),
  pvUci: z.array(z.string().trim().min(2).max(8)).default([]),
  pvSan: z.array(z.string().trim().min(1).max(32)).default([]),
  evalCp: z.number().int().optional(),
  evalMate: z.number().int().optional(),
  nodes: z.number().int().nonnegative().optional(),
  timeMs: z.number().int().nonnegative().optional(),
  source: z.string().trim().min(1).max(64).default("manual"),
});

const CreateGameAnalysisSchema = z.object({
  depth: z.number().int().min(1).max(40).default(18),
  nodes: z.number().int().positive().max(50_000_000).optional(),
  timeMs: z.number().int().positive().max(120_000).optional(),
  engine: z.string().trim().min(1).max(64).default("stockfish"),
  multipv: z.number().int().min(1).max(20).default(1),
  startPly: z.number().int().min(0).default(0),
  endPly: z.number().int().min(0).optional(),
});

const CreateAutoAnnotationSchema = z.object({
  depth: z.number().int().min(1).max(30).default(14),
  timeMs: z.number().int().positive().max(60_000).optional(),
  engine: z.string().trim().min(1).max(64).default("stockfish"),
  overwriteExisting: z.boolean().default(false),
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
  queue: AnalysisQueue,
  gameAnalysisQueue: GameAnalysisQueue,
  autoAnnotationQueue: AutoAnnotationQueue
): Promise<void> {
  const parseResultLines = (
    raw: unknown,
    fallback: {
      bestMove: string | null;
      pv: string | null;
      evalCp: number | null;
      evalMate: number | null;
      multipv?: number | null;
    }
  ): Array<{
    multipv: number;
    bestMove: string | null;
    pv: string | null;
    evalCp: number | null;
    evalMate: number | null;
  }> => {
    const parsed = Array.isArray(raw)
      ? raw
          .map((entry) => {
            if (!entry || typeof entry !== "object") {
              return null;
            }
            const value = entry as Record<string, unknown>;
            return {
              multipv:
                typeof value.multipv === "number" && Number.isInteger(value.multipv) && value.multipv > 0
                  ? value.multipv
                  : 1,
              bestMove: typeof value.bestMove === "string" ? value.bestMove : null,
              pv: typeof value.pv === "string" ? value.pv : null,
              evalCp: typeof value.evalCp === "number" ? value.evalCp : null,
              evalMate: typeof value.evalMate === "number" ? value.evalMate : null,
            };
          })
          .filter(
            (
              value
            ): value is {
              multipv: number;
              bestMove: string | null;
              pv: string | null;
              evalCp: number | null;
              evalMate: number | null;
            } => value !== null
          )
      : [];

    if (parsed.length > 0) {
      return parsed.sort((a, b) => a.multipv - b.multipv);
    }

    if (!fallback.bestMove && !fallback.pv && fallback.evalCp === null && fallback.evalMate === null) {
      return [];
    }

    return [
      {
        multipv: fallback.multipv ?? 1,
        bestMove: fallback.bestMove,
        pv: fallback.pv,
        evalCp: fallback.evalCp,
        evalMate: fallback.evalMate,
      },
    ];
  };

  app.post("/api/analysis", { preHandler: requireUser }, async (request, reply) => {
    const parsed = CreateAnalysisSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid request body",
        details: parsed.error.flatten(),
      });
    }

    const payload = parsed.data;
    if (payload.autoStore && (payload.gameId === undefined || payload.ply === undefined)) {
      return reply.status(400).send({ error: "autoStore requires gameId and ply" });
    }
    const parsedIdempotency = parseIdempotencyKey(request.headers["idempotency-key"]);
    if (parsedIdempotency.error) {
      return reply.status(400).send({ error: parsedIdempotency.error });
    }
    const idempotencyKey = parsedIdempotency.key;
    if (idempotencyKey) {
      const existing = await pool.query<{ id: number | string; status: string }>(
        `SELECT id, status
         FROM engine_requests
         WHERE user_id = $1
           AND idempotency_key = $2
         ORDER BY id DESC
         LIMIT 1`,
        [request.user!.id, idempotencyKey]
      );
      if (existing.rowCount) {
        const row = existing.rows[0];
        return reply.status(200).send({
          id: toId(row.id),
          status: row.status,
          idempotentReplay: true,
        });
      }
    }

    let fenNorm: string;
    try {
      fenNorm = normalizeFen(payload.fen).fenNorm;
    } catch (error) {
      return reply.status(400).send({ error: String(error) });
    }

    if (payload.gameId !== undefined) {
      const gameOwnership = await pool.query<{ id: number | string }>(
        "SELECT id FROM games WHERE id = $1 AND user_id = $2",
        [payload.gameId, request.user!.id]
      );
      if (!gameOwnership.rowCount) {
        return reply.status(404).send({ error: "Game not found" });
      }
    }

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

    const cachedLine = await pool.query<{
      multipv_rank: number;
      pv_uci: string[] | null;
      eval_cp: number | null;
      eval_mate: number | null;
      depth: number | null;
      nodes: number | null;
      time_ms: number | null;
      pv_san: string[] | null;
    }>(
      `SELECT DISTINCT ON (COALESCE(multipv, 1))
        COALESCE(multipv, 1) AS multipv_rank,
        pv_uci,
        pv_san,
        eval_cp,
        eval_mate,
        depth,
        nodes,
        time_ms
      FROM engine_lines
      WHERE user_id = $1
        AND fen_norm = $2
        AND engine = $3
        AND ($4::int IS NULL OR depth >= $4::int)
        AND COALESCE(multipv, 1) <= $5::int
      ORDER BY COALESCE(multipv, 1), depth DESC NULLS LAST, created_at DESC`,
      [request.user!.id, fenNorm, payload.engine, payload.depth ?? null, payload.multipv]
    );

    if ((cachedLine.rowCount ?? 0) >= payload.multipv) {
      const cachedLines = cachedLine.rows
        .map((row) => ({
          multipv: row.multipv_rank,
          bestMove: row.pv_uci?.[0] ?? null,
          pv: (row.pv_uci ?? []).join(" "),
          evalCp: row.eval_cp,
          evalMate: row.eval_mate,
          depth: row.depth,
          nodes: row.nodes,
          timeMs: row.time_ms,
        }))
        .sort((a, b) => a.multipv - b.multipv)
        .slice(0, payload.multipv);
      const primary = cachedLines[0];
      let analysisRequestId: number;
      try {
        const createResult = await pool.query<{ id: number | string }>(
          `INSERT INTO engine_requests (
            user_id,
            status,
            fen,
            engine,
            multipv,
            depth,
            nodes,
            time_ms,
            game_id,
            ply,
            auto_store,
            source,
            best_move,
            principal_variation,
            eval_cp,
            eval_mate,
            result_lines,
            idempotency_key
          ) VALUES (
            $1, 'completed', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16
          )
          RETURNING id`,
          [
            request.user!.id,
            payload.fen,
            payload.engine,
            payload.multipv,
            primary?.depth ?? payload.depth,
            primary?.nodes ?? payload.nodes ?? null,
            primary?.timeMs ?? payload.timeMs ?? null,
            payload.gameId ?? null,
            payload.ply ?? null,
            payload.autoStore,
            payload.source,
            primary?.bestMove ?? null,
            primary?.pv ?? null,
            primary?.evalCp ?? null,
            primary?.evalMate ?? null,
            JSON.stringify(
              cachedLines.map((line) => ({
                multipv: line.multipv,
                bestMove: line.bestMove,
                pv: line.pv,
                evalCp: line.evalCp,
                evalMate: line.evalMate,
              }))
            ),
            idempotencyKey,
          ]
        );
        analysisRequestId = toId(createResult.rows[0].id);
      } catch (error) {
        if ((error as { code?: string }).code === "23505" && idempotencyKey) {
          const existing = await pool.query<{ id: number | string; status: string }>(
            `SELECT id, status
             FROM engine_requests
             WHERE user_id = $1
               AND idempotency_key = $2
             ORDER BY id DESC
             LIMIT 1`,
            [request.user!.id, idempotencyKey]
          );
          if (existing.rowCount) {
            const row = existing.rows[0];
            return reply.status(200).send({
              id: toId(row.id),
              status: row.status,
              idempotentReplay: true,
            });
          }
        }
        throw error;
      }
      return reply.status(201).send({
        id: analysisRequestId,
        status: "completed",
        cached: true,
      });
    }

    let analysisRequestId: number;
    try {
      const createResult = await pool.query<{ id: number | string }>(
        `INSERT INTO engine_requests (
          user_id,
          status,
          fen,
          engine,
          multipv,
          depth,
          nodes,
          time_ms,
          game_id,
          ply,
          auto_store,
          source,
          idempotency_key
        )
         VALUES ($1, 'queued', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id`,
        [
          request.user!.id,
          payload.fen,
          payload.engine,
          payload.multipv,
          payload.depth,
          payload.nodes ?? null,
          payload.timeMs ?? null,
          payload.gameId ?? null,
          payload.ply ?? null,
          payload.autoStore,
          payload.source,
          idempotencyKey,
        ]
      );
      analysisRequestId = toId(createResult.rows[0].id);
    } catch (error) {
      if ((error as { code?: string }).code === "23505" && idempotencyKey) {
        const existing = await pool.query<{ id: number | string; status: string }>(
          `SELECT id, status
           FROM engine_requests
           WHERE user_id = $1
             AND idempotency_key = $2
           ORDER BY id DESC
           LIMIT 1`,
          [request.user!.id, idempotencyKey]
        );
        if (existing.rowCount) {
          const row = existing.rows[0];
          return reply.status(200).send({
            id: toId(row.id),
            status: row.status,
            idempotentReplay: true,
          });
        }
      }
      throw error;
    }

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

  app.post(
    "/api/analysis/store",
    { preHandler: requireUser },
    async (request, reply) => {
      const parsed = StoreAnalysisSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid request body",
          details: parsed.error.flatten(),
        });
      }

      let fenNorm: string;
      try {
        fenNorm = normalizeFen(parsed.data.fen).fenNorm;
      } catch (error) {
        return reply.status(400).send({ error: String(error) });
      }

      const gameOwnership = await pool.query<{ id: number | string }>(
        "SELECT id FROM games WHERE id = $1 AND user_id = $2",
        [parsed.data.gameId, request.user!.id]
      );
      if (!gameOwnership.rowCount) {
        return reply.status(404).send({ error: "Game not found" });
      }

      const result = await pool.query<{ id: number | string; created_at: Date }>(
        `INSERT INTO engine_lines (
          user_id,
          game_id,
          ply,
          fen_norm,
          engine,
          depth,
          multipv,
          pv_uci,
          pv_san,
          eval_cp,
          eval_mate,
          nodes,
          time_ms,
          source
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8::text[], $9::text[], $10, $11, $12, $13, $14
        )
        RETURNING id, created_at`,
        [
          request.user!.id,
          parsed.data.gameId,
          parsed.data.ply,
          fenNorm,
          parsed.data.engine,
          parsed.data.depth ?? null,
          parsed.data.multipv ?? null,
          parsed.data.pvUci,
          parsed.data.pvSan,
          parsed.data.evalCp ?? null,
          parsed.data.evalMate ?? null,
          parsed.data.nodes ?? null,
          parsed.data.timeMs ?? null,
          parsed.data.source,
        ]
      );

      return reply.status(201).send({
        id: toId(result.rows[0].id),
        createdAt: result.rows[0].created_at.toISOString(),
      });
    }
  );

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
        engine: string;
        multipv: number;
        depth: number | null;
        nodes: number | null;
        time_ms: number | null;
        game_id: number | string | null;
        ply: number | null;
        auto_store: boolean;
        source: string;
        best_move: string | null;
        principal_variation: string | null;
        eval_cp: number | null;
        eval_mate: number | null;
        result_lines: unknown;
        error_message: string | null;
        created_at: Date;
        updated_at: Date;
      }>(
        `SELECT
          id,
          status,
          fen,
          engine,
          multipv,
          depth,
          nodes,
          time_ms,
          game_id,
          ply,
          auto_store,
          source,
          best_move,
          principal_variation,
          eval_cp,
          eval_mate,
          result_lines,
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
      const resultLines = parseResultLines(row.result_lines, {
        bestMove: row.best_move,
        pv: row.principal_variation,
        evalCp: row.eval_cp,
        evalMate: row.eval_mate,
        multipv: row.multipv,
      });
      return {
        id: toId(row.id),
        status: row.status,
        fen: row.fen,
        engine: row.engine,
        multipv: row.multipv,
        context: {
          gameId: row.game_id === null ? null : toId(row.game_id),
          ply: row.ply,
          autoStore: row.auto_store,
          source: row.source,
        },
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
          lines: resultLines,
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
          multipv: number;
          best_move: string | null;
          principal_variation: string | null;
          eval_cp: number | null;
          eval_mate: number | null;
          result_lines: unknown;
          error_message: string | null;
          updated_at: Date;
        }>(
          `SELECT
            id,
            status,
            multipv,
            best_move,
            principal_variation,
            eval_cp,
            eval_mate,
            result_lines,
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
        const resultLines = parseResultLines(row.result_lines, {
          bestMove: row.best_move,
          pv: row.principal_variation,
          evalCp: row.eval_cp,
          evalMate: row.eval_mate,
          multipv: row.multipv,
        });
        reply.raw.write(
          `data: ${JSON.stringify({
            id: toId(row.id),
            status: row.status,
            result: {
              bestMove: row.best_move,
              pv: row.principal_variation,
              evalCp: row.eval_cp,
              evalMate: row.eval_mate,
              lines: resultLines,
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

  app.post<{ Params: { id: string } }>(
    "/api/games/:id/analysis-jobs",
    { preHandler: requireUser },
    async (request, reply) => {
      const gameId = Number(request.params.id);
      if (!Number.isInteger(gameId) || gameId <= 0) {
        return reply.status(400).send({ error: "Invalid game id" });
      }

      const parsed = CreateGameAnalysisSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid request body",
          details: parsed.error.flatten(),
        });
      }

      if (parsed.data.endPly !== undefined && parsed.data.endPly < parsed.data.startPly) {
        return reply.status(400).send({ error: "endPly must be greater than or equal to startPly" });
      }

      const gameOwnership = await pool.query<{ id: number | string }>(
        "SELECT id FROM games WHERE id = $1 AND user_id = $2",
        [gameId, request.user!.id]
      );
      if (!gameOwnership.rowCount) {
        return reply.status(404).send({ error: "Game not found" });
      }

      const createResult = await pool.query<{ id: number | string }>(
        `INSERT INTO game_analysis_jobs (
          user_id,
          game_id,
          status,
          engine,
          depth,
          nodes,
          time_ms,
          multipv,
          start_ply,
          end_ply
        ) VALUES (
          $1, $2, 'queued', $3, $4, $5, $6, $7, $8, $9
        )
        RETURNING id`,
        [
          request.user!.id,
          gameId,
          parsed.data.engine,
          parsed.data.depth,
          parsed.data.nodes ?? null,
          parsed.data.timeMs ?? null,
          parsed.data.multipv,
          parsed.data.startPly,
          parsed.data.endPly ?? null,
        ]
      );

      const gameAnalysisJobId = toId(createResult.rows[0].id);

      try {
        await gameAnalysisQueue.enqueueGameAnalysis({
          gameAnalysisJobId,
          userId: request.user!.id,
        });
      } catch (error) {
        request.log.error(error);
        await pool.query(
          `UPDATE game_analysis_jobs
           SET status = 'failed',
               error_message = 'Failed to enqueue game analysis job',
               updated_at = NOW()
           WHERE id = $1`,
          [gameAnalysisJobId]
        );
        return reply.status(500).send({ error: "Failed to enqueue game analysis job" });
      }

      return reply.status(201).send({
        id: gameAnalysisJobId,
        status: "queued",
      });
    }
  );

  app.get<{ Params: { id: string } }>(
    "/api/games/:id/analysis-jobs",
    { preHandler: requireUser },
    async (request, reply) => {
      const gameId = Number(request.params.id);
      if (!Number.isInteger(gameId) || gameId <= 0) {
        return reply.status(400).send({ error: "Invalid game id" });
      }

      const gameOwnership = await pool.query<{ id: number | string }>(
        "SELECT id FROM games WHERE id = $1 AND user_id = $2",
        [gameId, request.user!.id]
      );
      if (!gameOwnership.rowCount) {
        return reply.status(404).send({ error: "Game not found" });
      }

      const result = await pool.query<{
        id: number | string;
        status: string;
        engine: string;
        depth: number | null;
        nodes: number | null;
        time_ms: number | null;
        multipv: number;
        start_ply: number;
        end_ply: number | null;
        processed_positions: number;
        stored_lines: number;
        error_message: string | null;
        cancel_requested: boolean;
        created_at: Date;
        updated_at: Date;
      }>(
        `SELECT
          id,
          status,
          engine,
          depth,
          nodes,
          time_ms,
          multipv,
          start_ply,
          end_ply,
          processed_positions,
          stored_lines,
          error_message,
          cancel_requested,
          created_at,
          updated_at
        FROM game_analysis_jobs
        WHERE game_id = $1
          AND user_id = $2
        ORDER BY id DESC
        LIMIT 20`,
        [gameId, request.user!.id]
      );

      return {
        gameId,
        items: result.rows.map((row) => ({
          id: toId(row.id),
          status: row.status,
          engine: row.engine,
          depth: row.depth,
          nodes: row.nodes,
          timeMs: row.time_ms,
          multipv: row.multipv,
          startPly: row.start_ply,
          endPly: row.end_ply,
          processedPositions: row.processed_positions,
          storedLines: row.stored_lines,
          cancelRequested: row.cancel_requested,
          error: row.error_message,
          createdAt: row.created_at.toISOString(),
          updatedAt: row.updated_at.toISOString(),
        })),
      };
    }
  );

  app.post<{ Params: { id: string; jobId: string } }>(
    "/api/games/:id/analysis-jobs/:jobId/cancel",
    { preHandler: requireUser },
    async (request, reply) => {
      const gameId = Number(request.params.id);
      const gameAnalysisJobId = Number(request.params.jobId);
      if (!Number.isInteger(gameId) || gameId <= 0 || !Number.isInteger(gameAnalysisJobId) || gameAnalysisJobId <= 0) {
        return reply.status(400).send({ error: "Invalid analysis job id" });
      }

      const result = await pool.query<{ status: string }>(
        `UPDATE game_analysis_jobs
         SET cancel_requested = TRUE,
             status = CASE WHEN status = 'queued' THEN 'cancelled' ELSE status END,
             updated_at = NOW()
         WHERE id = $1
           AND game_id = $2
           AND user_id = $3
         RETURNING status`,
        [gameAnalysisJobId, gameId, request.user!.id]
      );

      if (!result.rowCount) {
        return reply.status(404).send({ error: "Game analysis job not found" });
      }

      return {
        id: gameAnalysisJobId,
        status: result.rows[0].status,
      };
    }
  );

  app.post<{ Params: { id: string } }>(
    "/api/games/:id/auto-annotations",
    { preHandler: requireUser },
    async (request, reply) => {
      const gameId = Number(request.params.id);
      if (!Number.isInteger(gameId) || gameId <= 0) {
        return reply.status(400).send({ error: "Invalid game id" });
      }
      const parsed = CreateAutoAnnotationSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid request body",
          details: parsed.error.flatten(),
        });
      }
      const gameOwnership = await pool.query<{ id: number | string }>(
        "SELECT id FROM games WHERE id = $1 AND user_id = $2",
        [gameId, request.user!.id]
      );
      if (!gameOwnership.rowCount) {
        return reply.status(404).send({ error: "Game not found" });
      }

      const created = await pool.query<{ id: number | string }>(
        `INSERT INTO auto_annotation_jobs (
          user_id, game_id, status, engine, depth, time_ms, overwrite_existing
        ) VALUES (
          $1, $2, 'queued', $3, $4, $5, $6
        )
        RETURNING id`,
        [
          request.user!.id,
          gameId,
          parsed.data.engine,
          parsed.data.depth,
          parsed.data.timeMs ?? null,
          parsed.data.overwriteExisting,
        ]
      );
      const autoAnnotationJobId = toId(created.rows[0].id);
      try {
        await autoAnnotationQueue.enqueueAutoAnnotation({
          autoAnnotationJobId,
          userId: request.user!.id,
        });
      } catch (error) {
        request.log.error(error);
        await pool.query(
          `UPDATE auto_annotation_jobs
           SET status = 'failed',
               error_message = 'Failed to enqueue auto annotation job',
               updated_at = NOW()
           WHERE id = $1`,
          [autoAnnotationJobId]
        );
        return reply.status(500).send({ error: "Failed to enqueue auto annotation job" });
      }
      return reply.status(201).send({
        id: autoAnnotationJobId,
        status: "queued",
      });
    }
  );

  app.get<{ Params: { id: string } }>(
    "/api/games/:id/auto-annotations",
    { preHandler: requireUser },
    async (request, reply) => {
      const gameId = Number(request.params.id);
      if (!Number.isInteger(gameId) || gameId <= 0) {
        return reply.status(400).send({ error: "Invalid game id" });
      }
      const gameOwnership = await pool.query<{ id: number | string }>(
        "SELECT id FROM games WHERE id = $1 AND user_id = $2",
        [gameId, request.user!.id]
      );
      if (!gameOwnership.rowCount) {
        return reply.status(404).send({ error: "Game not found" });
      }
      const result = await pool.query<{
        id: number | string;
        status: string;
        engine: string;
        depth: number | null;
        time_ms: number | null;
        processed_plies: number;
        annotated_plies: number;
        overwrite_existing: boolean;
        cancel_requested: boolean;
        error_message: string | null;
        created_at: Date;
        updated_at: Date;
      }>(
        `SELECT
          id, status, engine, depth, time_ms, processed_plies, annotated_plies,
          overwrite_existing, cancel_requested, error_message, created_at, updated_at
         FROM auto_annotation_jobs
         WHERE game_id = $1 AND user_id = $2
         ORDER BY id DESC
         LIMIT 20`,
        [gameId, request.user!.id]
      );
      return {
        gameId,
        items: result.rows.map((row) => ({
          id: toId(row.id),
          status: row.status,
          engine: row.engine,
          depth: row.depth,
          timeMs: row.time_ms,
          processedPlies: row.processed_plies,
          annotatedPlies: row.annotated_plies,
          overwriteExisting: row.overwrite_existing,
          cancelRequested: row.cancel_requested,
          error: row.error_message,
          createdAt: row.created_at.toISOString(),
          updatedAt: row.updated_at.toISOString(),
        })),
      };
    }
  );

  app.post<{ Params: { id: string; jobId: string } }>(
    "/api/games/:id/auto-annotations/:jobId/cancel",
    { preHandler: requireUser },
    async (request, reply) => {
      const gameId = Number(request.params.id);
      const autoAnnotationJobId = Number(request.params.jobId);
      if (!Number.isInteger(gameId) || gameId <= 0 || !Number.isInteger(autoAnnotationJobId) || autoAnnotationJobId <= 0) {
        return reply.status(400).send({ error: "Invalid auto annotation job id" });
      }
      const result = await pool.query<{ status: string }>(
        `UPDATE auto_annotation_jobs
         SET cancel_requested = TRUE,
             status = CASE WHEN status = 'queued' THEN 'cancelled' ELSE status END,
             updated_at = NOW()
         WHERE id = $1
           AND game_id = $2
           AND user_id = $3
         RETURNING status`,
        [autoAnnotationJobId, gameId, request.user!.id]
      );
      if (!result.rowCount) {
        return reply.status(404).send({ error: "Auto annotation job not found" });
      }
      return {
        id: autoAnnotationJobId,
        status: result.rows[0].status,
      };
    }
  );
}
