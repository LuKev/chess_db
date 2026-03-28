import type { Pool } from "pg";
import {
  persistableLinesFromAnalysis,
  replaceEngineLinesForPosition,
  serializeResultLines,
} from "./persistence.js";
import { runStockfishAnalysis } from "./stockfish.js";

type ProcessAnalysisJobParams = {
  pool: Pool;
  analysisRequestId: number;
  userId: number;
  stockfishBinary: string;
  cancelPollMs: number;
};

function toId(value: number | string): number {
  if (typeof value === "number") {
    return value;
  }
  return Number(value);
}

async function isCancelRequested(pool: Pool, analysisRequestId: number): Promise<boolean> {
  const row = await pool.query<{ cancel_requested: boolean; status: string }>(
    `SELECT cancel_requested, status
     FROM engine_requests
     WHERE id = $1`,
    [analysisRequestId]
  );

  if (!row.rowCount) {
    return true;
  }

  return row.rows[0].cancel_requested || row.rows[0].status === "cancelled";
}

export async function processAnalysisJob(
  params: ProcessAnalysisJobParams
): Promise<void> {
  const requestRow = await params.pool.query<{
    id: number | string;
    user_id: number | string;
    status: string;
    cancel_requested: boolean;
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
  }>(
    `SELECT
      id,
      user_id,
      status,
      cancel_requested,
      fen,
      engine,
      multipv,
      depth,
      nodes,
      time_ms,
      game_id,
      ply,
      auto_store,
      source
    FROM engine_requests
    WHERE id = $1`,
    [params.analysisRequestId]
  );

  if (!requestRow.rowCount) {
    throw new Error(`Analysis request ${params.analysisRequestId} not found`);
  }

  const request = requestRow.rows[0];
  if (toId(request.user_id) !== params.userId) {
    throw new Error(`Analysis request user mismatch for ${params.analysisRequestId}`);
  }

  if (request.cancel_requested || request.status === "cancelled") {
    await params.pool.query(
      `UPDATE engine_requests
       SET status = 'cancelled',
           updated_at = NOW()
       WHERE id = $1`,
      [params.analysisRequestId]
    );
    return;
  }

  await params.pool.query(
    `UPDATE engine_requests
     SET status = 'running', updated_at = NOW()
     WHERE id = $1`,
    [params.analysisRequestId]
  );

  try {
    let lastInfoPersistMs = 0;
    const result = await runStockfishAnalysis({
      stockfishBinary: params.stockfishBinary,
      fen: request.fen,
      engine: request.engine,
      multipv: request.multipv ?? 1,
      limits: {
        depth: request.depth,
        nodes: request.nodes,
        timeMs: request.time_ms,
      },
      onCancelPoll: async () => isCancelRequested(params.pool, params.analysisRequestId),
      onInfo: async (lines) => {
        const now = Date.now();
        if (now - lastInfoPersistMs < 500) {
          return;
        }
        lastInfoPersistMs = now;
        const primary = lines.find((line) => line.multipv === 1) ?? lines[0] ?? null;

        await params.pool.query(
          `UPDATE engine_requests
           SET principal_variation = $2,
               eval_cp = $3,
               eval_mate = $4,
               result_lines = $5::jsonb,
               updated_at = NOW()
           WHERE id = $1 AND status = 'running'`,
          [
            params.analysisRequestId,
            primary?.pv ?? null,
            primary?.evalCp ?? null,
            primary?.evalMate ?? null,
            JSON.stringify(serializeResultLines(lines)),
          ]
        );
      },
      cancelPollMs: params.cancelPollMs,
    });

    if ("cancelled" in result) {
      await params.pool.query(
        `UPDATE engine_requests
         SET status = 'cancelled',
             updated_at = NOW()
         WHERE id = $1`,
        [params.analysisRequestId]
      );
      return;
    }

    await params.pool.query(
      `UPDATE engine_requests
       SET status = 'completed',
           best_move = $2,
           principal_variation = $3,
           eval_cp = $4,
           eval_mate = $5,
           result_lines = $6::jsonb,
           updated_at = NOW()
       WHERE id = $1`,
      [
        params.analysisRequestId,
        result.bestMove,
        result.lines[0]?.pv ?? null,
        result.lines[0]?.evalCp ?? null,
        result.lines[0]?.evalMate ?? null,
        JSON.stringify(serializeResultLines(result.lines)),
      ]
    );

    if (request.auto_store && request.game_id !== null && request.ply !== null) {
      await replaceEngineLinesForPosition({
        pool: params.pool,
        userId: params.userId,
        gameId: toId(request.game_id),
        ply: request.ply,
        fen: request.fen,
        engine: request.engine,
        depth: request.depth,
        source: request.source,
        lines: persistableLinesFromAnalysis(request.fen, result.lines, {
          nodes: request.nodes,
          timeMs: request.time_ms,
        }),
      });
    }
  } catch (error) {
    await params.pool.query(
      `UPDATE engine_requests
       SET status = 'failed',
           error_message = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [params.analysisRequestId, String(error).slice(0, 1000)]
    );

    throw error;
  }
}
