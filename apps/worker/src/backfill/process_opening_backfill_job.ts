import type { Pool } from "pg";

type ProcessOpeningBackfillJobParams = {
  pool: Pool;
  userId: number;
};

export async function processOpeningBackfillJob(
  params: ProcessOpeningBackfillJobParams
): Promise<{ rebuiltRows: number }> {
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
    return {
      rebuiltRows: result.rowCount ?? 0,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

