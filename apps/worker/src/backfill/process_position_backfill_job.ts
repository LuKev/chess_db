import type { Pool } from "pg";
import {
  extractMainlineSans,
  indexGamePositionsAndOpenings,
} from "./indexing.js";

type ProcessPositionBackfillJobParams = {
  pool: Pool;
  userId: number;
};

function toId(value: number | string): number {
  if (typeof value === "number") {
    return value;
  }
  return Number(value);
}

export async function processPositionBackfillJob(
  params: ProcessPositionBackfillJobParams
): Promise<{ scanned: number; indexed: number }> {
  const rows = await params.pool.query<{
    id: number | string;
    starting_fen: string | null;
    result: string;
    white_elo: number | null;
    black_elo: number | null;
    move_tree: Record<string, unknown>;
  }>(
    `SELECT
      g.id,
      g.starting_fen,
      g.result,
      g.white_elo,
      g.black_elo,
      gm.move_tree
    FROM games g
    JOIN game_moves gm ON gm.game_id = g.id
    WHERE g.user_id = $1
      AND NOT EXISTS (
        SELECT 1
        FROM game_positions gp
        WHERE gp.user_id = g.user_id
          AND gp.game_id = g.id
          AND gp.ply = 0
      )
    ORDER BY g.id ASC`,
    [params.userId]
  );

  let indexed = 0;
  for (const row of rows.rows) {
    const gameId = toId(row.id);
    const sans = extractMainlineSans(row.move_tree ?? {});
    const client = await params.pool.connect();
    try {
      await client.query("BEGIN");
      await indexGamePositionsAndOpenings(client, {
        userId: params.userId,
        gameId,
        startingFen: row.starting_fen,
        mainlineSans: sans,
        result: row.result,
        whiteElo: row.white_elo,
        blackElo: row.black_elo,
      });
      await client.query("COMMIT");
      indexed += 1;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    scanned: rows.rowCount ?? 0,
    indexed,
  };
}

