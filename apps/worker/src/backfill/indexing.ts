import type { PoolClient } from "pg";
import { buildPositionIndex } from "../chess/index_positions.js";

type MoveNode = {
  notation?: {
    notation?: string;
  };
};

function isMoveNode(value: unknown): value is MoveNode {
  return Boolean(value) && typeof value === "object";
}

export function extractMainlineSans(moveTree: Record<string, unknown>): string[] {
  const direct = moveTree.mainline;
  if (Array.isArray(direct) && direct.every((value) => typeof value === "string")) {
    return direct as string[];
  }

  const maybeMoves = moveTree.moves;
  if (!Array.isArray(maybeMoves)) {
    return [];
  }

  const sans: string[] = [];
  for (const move of maybeMoves) {
    if (!isMoveNode(move)) {
      continue;
    }
    const san = move.notation?.notation;
    if (typeof san === "string" && san.trim().length > 0) {
      sans.push(san.trim());
    }
  }
  return sans;
}

export async function indexGamePositionsAndOpenings(
  client: PoolClient,
  params: {
    userId: number;
    gameId: number;
    startingFen: string | null;
    mainlineSans: string[];
    result: string;
    whiteElo: number | null;
    blackElo: number | null;
  }
): Promise<void> {
  await client.query(
    "DELETE FROM game_positions WHERE user_id = $1 AND game_id = $2",
    [params.userId, params.gameId]
  );

  const indexed = buildPositionIndex(params.startingFen, params.mainlineSans);
  const whiteScore =
    params.result === "1-0"
      ? 1
      : params.result === "0-1"
        ? 0
        : params.result === "1/2-1/2"
          ? 0.5
          : null;
  const avgElo =
    params.whiteElo && params.blackElo
      ? (params.whiteElo + params.blackElo) / 2
      : null;

  for (const position of indexed) {
    await client.query(
      `INSERT INTO game_positions (
        user_id,
        game_id,
        ply,
        fen_norm,
        stm,
        castling,
        ep_square,
        halfmove,
        fullmove,
        material_key,
        next_move_uci,
        next_fen_norm
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
      )
      ON CONFLICT (user_id, game_id, ply)
      DO UPDATE SET
        fen_norm = EXCLUDED.fen_norm,
        stm = EXCLUDED.stm,
        castling = EXCLUDED.castling,
        ep_square = EXCLUDED.ep_square,
        halfmove = EXCLUDED.halfmove,
        fullmove = EXCLUDED.fullmove,
        material_key = EXCLUDED.material_key,
        next_move_uci = EXCLUDED.next_move_uci,
        next_fen_norm = EXCLUDED.next_fen_norm`,
      [
        params.userId,
        params.gameId,
        position.ply,
        position.fenNorm,
        position.stm,
        position.castling,
        position.epSquare,
        position.halfmove,
        position.fullmove,
        position.materialKey,
        position.nextMoveUci,
        position.nextFenNorm,
      ]
    );

    if (!position.nextMoveUci) {
      continue;
    }

    await client.query(
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
      ) VALUES (
        $1, $2, $3, $4, 1, $5, $6, $7, $8, $9, 0, NOW()
      )
      ON CONFLICT (user_id, position_fen_norm, move_uci)
      DO UPDATE SET
        next_fen_norm = COALESCE(opening_stats.next_fen_norm, EXCLUDED.next_fen_norm),
        games = opening_stats.games + 1,
        white_wins = opening_stats.white_wins + EXCLUDED.white_wins,
        black_wins = opening_stats.black_wins + EXCLUDED.black_wins,
        draws = opening_stats.draws + EXCLUDED.draws,
        avg_elo = CASE
          WHEN EXCLUDED.avg_elo IS NULL THEN opening_stats.avg_elo
          WHEN opening_stats.avg_elo IS NULL THEN EXCLUDED.avg_elo
          ELSE ROUND(
            ((opening_stats.avg_elo * opening_stats.games) + EXCLUDED.avg_elo)
              / (opening_stats.games + 1),
            2
          )
        END,
        performance = CASE
          WHEN EXCLUDED.performance IS NULL THEN opening_stats.performance
          WHEN opening_stats.performance IS NULL THEN EXCLUDED.performance
          ELSE ROUND(
            ((opening_stats.performance * opening_stats.games) + EXCLUDED.performance)
              / (opening_stats.games + 1),
            2
          )
        END,
        transpositions = opening_stats.transpositions
          + CASE
              WHEN opening_stats.next_fen_norm IS NOT NULL
               AND EXCLUDED.next_fen_norm IS NOT NULL
               AND opening_stats.next_fen_norm <> EXCLUDED.next_fen_norm
              THEN 1
              ELSE 0
            END,
        updated_at = NOW()`,
      [
        params.userId,
        position.fenNorm,
        position.nextMoveUci,
        position.nextFenNorm,
        params.result === "1-0" ? 1 : 0,
        params.result === "0-1" ? 1 : 0,
        params.result === "1/2-1/2" ? 1 : 0,
        avgElo,
        whiteScore === null ? null : whiteScore * 100,
      ]
    );
  }
}

