import type { Pool } from "pg";
import {
  markPendingImportJobsCompleted,
  markPendingImportJobsFailed,
  markPendingImportJobsRunning,
  markUserIndexCompleted,
  markUserIndexFailed,
  markUserIndexRunning,
} from "./status.js";

type ProcessOpeningBackfillJobParams = {
  pool: Pool;
  userId: number;
};

export async function processOpeningBackfillJob(
  params: ProcessOpeningBackfillJobParams
): Promise<{ rebuiltRows: number }> {
  try {
    await markUserIndexRunning(params.pool, {
      userId: params.userId,
      kind: "opening",
    });
    await markPendingImportJobsRunning(params.pool, {
      userId: params.userId,
      kind: "opening",
    });

    const client = await params.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM opening_stats WHERE user_id = $1", [params.userId]);

      const result = await client.query(
        `INSERT INTO opening_stats (
          user_id,
          position_fen_norm,
          move_uci,
          next_fen_norm,
          games,
          white_wins,
          black_wins,
          draws,
          avg_elo,
          performance,
          transpositions,
          updated_at
        )
        SELECT
          gp.user_id,
          gp.fen_norm AS position_fen_norm,
          gp.next_move_uci AS move_uci,
          MIN(gp.next_fen_norm) AS next_fen_norm,
          COUNT(*)::int AS games,
          SUM(CASE WHEN g.result = '1-0' THEN 1 ELSE 0 END)::int AS white_wins,
          SUM(CASE WHEN g.result = '0-1' THEN 1 ELSE 0 END)::int AS black_wins,
          SUM(CASE WHEN g.result = '1/2-1/2' THEN 1 ELSE 0 END)::int AS draws,
          ROUND(AVG(
            CASE
              WHEN g.white_elo IS NOT NULL AND g.black_elo IS NOT NULL
              THEN (g.white_elo + g.black_elo) / 2.0
              ELSE NULL
            END
          )::numeric, 2) AS avg_elo,
          ROUND(AVG(
            CASE
              WHEN g.result = '1-0' THEN 100.0
              WHEN g.result = '1/2-1/2' THEN 50.0
              WHEN g.result = '0-1' THEN 0.0
              ELSE NULL
            END
          )::numeric, 2) AS performance,
          GREATEST(COUNT(DISTINCT gp.next_fen_norm) - 1, 0)::int AS transpositions,
          NOW()
        FROM game_positions gp
        JOIN games g
          ON g.id = gp.game_id
         AND g.user_id = gp.user_id
        WHERE gp.user_id = $1
          AND gp.next_move_uci IS NOT NULL
        GROUP BY gp.user_id, gp.fen_norm, gp.next_move_uci`,
        [params.userId]
      );

      await client.query("COMMIT");

      const totalGamesResult = await params.pool.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total
         FROM games
         WHERE user_id = $1`,
        [params.userId]
      );
      const totalGames = Number(totalGamesResult.rows[0]?.total ?? "0");

      await markUserIndexCompleted(params.pool, {
        userId: params.userId,
        kind: "opening",
        indexedGames: totalGames,
      });
      await markPendingImportJobsCompleted(params.pool, {
        userId: params.userId,
        kind: "opening",
      });

      return {
        rebuiltRows: result.rowCount ?? 0,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    const message = String(error);
    await markUserIndexFailed(params.pool, {
      userId: params.userId,
      kind: "opening",
      error: message,
    });
    await markPendingImportJobsFailed(params.pool, {
      userId: params.userId,
      kind: "opening",
      error: message,
    });
    throw error;
  }
}
