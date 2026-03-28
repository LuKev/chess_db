import type { Pool } from "pg";
import { extractMainlineSans } from "../backfill/indexing.js";
import { buildPositionIndex } from "../chess/index_positions.js";
import {
  loadCachedAnalysisLines,
  persistableLinesFromAnalysis,
  replaceEngineLinesForPosition,
} from "./persistence.js";
import { runStockfishAnalysis } from "./stockfish.js";

type ProcessGameAnalysisJobParams = {
  pool: Pool;
  gameAnalysisJobId: number;
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

async function isCancelled(pool: Pool, gameAnalysisJobId: number): Promise<boolean> {
  const result = await pool.query<{ cancel_requested: boolean; status: string }>(
    `SELECT cancel_requested, status
     FROM game_analysis_jobs
     WHERE id = $1`,
    [gameAnalysisJobId]
  );

  if (!result.rowCount) {
    return true;
  }

  return result.rows[0].cancel_requested || result.rows[0].status === "cancelled";
}

export async function processGameAnalysisJob(
  params: ProcessGameAnalysisJobParams
): Promise<void> {
  const jobRow = await params.pool.query<{
    id: number | string;
    user_id: number | string;
    game_id: number | string;
    status: string;
    cancel_requested: boolean;
    engine: string;
    depth: number | null;
    nodes: number | null;
    time_ms: number | null;
    multipv: number;
    start_ply: number;
    end_ply: number | null;
    starting_fen: string | null;
    move_tree: Record<string, unknown>;
  }>(
    `SELECT
      j.id,
      j.user_id,
      j.game_id,
      j.status,
      j.cancel_requested,
      j.engine,
      j.depth,
      j.nodes,
      j.time_ms,
      j.multipv,
      j.start_ply,
      j.end_ply,
      g.starting_fen,
      gm.move_tree
    FROM game_analysis_jobs j
    JOIN games g ON g.id = j.game_id
    JOIN game_moves gm ON gm.game_id = g.id
    WHERE j.id = $1`,
    [params.gameAnalysisJobId]
  );

  if (!jobRow.rowCount) {
    throw new Error(`Game analysis job ${params.gameAnalysisJobId} not found`);
  }

  const job = jobRow.rows[0];
  if (toId(job.user_id) !== params.userId) {
    throw new Error(`Game analysis job user mismatch for ${params.gameAnalysisJobId}`);
  }

  if (job.cancel_requested || job.status === "cancelled") {
    await params.pool.query(
      `UPDATE game_analysis_jobs
       SET status = 'cancelled',
           updated_at = NOW()
       WHERE id = $1`,
      [params.gameAnalysisJobId]
    );
    return;
  }

  await params.pool.query(
    `UPDATE game_analysis_jobs
     SET status = 'running',
         processed_positions = 0,
         stored_lines = 0,
         error_message = NULL,
         updated_at = NOW()
     WHERE id = $1`,
    [params.gameAnalysisJobId]
  );

  const positions = buildPositionIndex(job.starting_fen, extractMainlineSans(job.move_tree ?? {}));
  const eligiblePositions = positions.filter(
    (position) => position.ply >= job.start_ply && (job.end_ply === null || position.ply <= job.end_ply)
  );

  let processedPositions = 0;
  let storedLines = 0;

  try {
    for (const position of eligiblePositions) {
      const fullFen = `${position.fenNorm} ${position.halfmove} ${position.fullmove}`;

      if (await isCancelled(params.pool, params.gameAnalysisJobId)) {
        await params.pool.query(
          `UPDATE game_analysis_jobs
           SET status = 'cancelled',
               processed_positions = $2,
               stored_lines = $3,
               updated_at = NOW()
           WHERE id = $1`,
          [params.gameAnalysisJobId, processedPositions, storedLines]
        );
        return;
      }

      const cachedLines = await loadCachedAnalysisLines<{
        multipv_rank: number;
        pv_uci: string[] | null;
        pv_san: string[] | null;
        eval_cp: number | null;
        eval_mate: number | null;
        nodes: number | null;
        time_ms: number | null;
      }>({
        pool: params.pool,
        userId: params.userId,
        fenNorm: position.fenNorm,
        engine: job.engine,
        depth: job.depth,
        multipv: job.multipv,
        query: `SELECT DISTINCT ON (COALESCE(multipv, 1))
            COALESCE(multipv, 1) AS multipv_rank,
            pv_uci,
            pv_san,
            eval_cp,
            eval_mate,
            nodes,
            time_ms
          FROM engine_lines
          WHERE user_id = $1
            AND fen_norm = $2
            AND engine = $3
            AND ($4::int IS NULL OR depth >= $4::int)
            AND COALESCE(multipv, 1) <= $5::int
          ORDER BY COALESCE(multipv, 1), depth DESC NULLS LAST, created_at DESC`,
        mapRow: (row) => ({
          multipv: row.multipv_rank,
          pvUci: row.pv_uci ?? [],
          pvSan: row.pv_san ?? [],
          evalCp: row.eval_cp,
          evalMate: row.eval_mate,
          nodes: row.nodes,
          timeMs: row.time_ms,
        }),
      });

      const lines =
        cachedLines.length >= job.multipv
          ? cachedLines.slice(0, job.multipv)
          : await (async () => {
              const result = await runStockfishAnalysis({
                stockfishBinary: params.stockfishBinary,
                fen: fullFen,
                engine: job.engine,
                multipv: job.multipv,
                limits: {
                  depth: job.depth,
                  nodes: job.nodes,
                  timeMs: job.time_ms,
                },
                onCancelPoll: async () => isCancelled(params.pool, params.gameAnalysisJobId),
                onInfo: async () => {},
                cancelPollMs: params.cancelPollMs,
              });

              if ("cancelled" in result) {
                return [];
              }

              return persistableLinesFromAnalysis(
                fullFen,
                result.lines,
                {
                  nodes: job.nodes,
                  timeMs: job.time_ms,
                }
              );
            })();

      if (lines.length === 0) {
        await params.pool.query(
          `UPDATE game_analysis_jobs
           SET status = 'cancelled',
               processed_positions = $2,
               stored_lines = $3,
               updated_at = NOW()
           WHERE id = $1`,
          [params.gameAnalysisJobId, processedPositions, storedLines]
        );
        return;
      }

      storedLines += await replaceEngineLinesForPosition({
        pool: params.pool,
        userId: params.userId,
        gameId: toId(job.game_id),
        ply: position.ply,
        fen: fullFen,
        engine: job.engine,
        depth: job.depth,
        source: "game-analysis",
        lines,
      });

      processedPositions += 1;
      await params.pool.query(
        `UPDATE game_analysis_jobs
         SET processed_positions = $2,
             stored_lines = $3,
             updated_at = NOW()
         WHERE id = $1`,
        [params.gameAnalysisJobId, processedPositions, storedLines]
      );
    }

    await params.pool.query(
      `UPDATE game_analysis_jobs
       SET status = 'completed',
           processed_positions = $2,
           stored_lines = $3,
           updated_at = NOW()
       WHERE id = $1`,
      [params.gameAnalysisJobId, processedPositions, storedLines]
    );
  } catch (error) {
    await params.pool.query(
      `UPDATE game_analysis_jobs
       SET status = 'failed',
           processed_positions = $2,
           stored_lines = $3,
           error_message = $4,
           updated_at = NOW()
       WHERE id = $1`,
      [params.gameAnalysisJobId, processedPositions, storedLines, String(error).slice(0, 1000)]
    );
    throw error;
  }
}
