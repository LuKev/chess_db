import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { requireUser } from "../auth.js";
import { normalizeFen } from "../chess/fen.js";

const OpeningTreeQuerySchema = z.object({
  fen: z.string().trim().min(1),
  depth: z.coerce.number().int().min(1).max(6).default(2),
});

type OpeningMoveRow = {
  move_uci: string;
  next_fen_norm: string | null;
  games: number;
  white_wins: number;
  black_wins: number;
  draws: number;
  avg_elo: string | number | null;
  performance: string | number | null;
  transpositions: number;
};

async function loadOpeningMoves(
  pool: Pool,
  params: { userId: number; fenNorm: string }
): Promise<OpeningMoveRow[]> {
  const rows = await pool.query<OpeningMoveRow>(
    `SELECT
      move_uci,
      next_fen_norm,
      games,
      white_wins,
      black_wins,
      draws,
      avg_elo,
      performance,
      transpositions
    FROM opening_stats
    WHERE user_id = $1
      AND position_fen_norm = $2
    ORDER BY games DESC, move_uci ASC`,
    [params.userId, params.fenNorm]
  );
  return rows.rows;
}

async function buildOpeningNode(
  pool: Pool,
  params: {
    userId: number;
    fenNorm: string;
    depth: number;
    visited: Set<string>;
  }
): Promise<Record<string, unknown>> {
  const moves = await loadOpeningMoves(pool, {
    userId: params.userId,
    fenNorm: params.fenNorm,
  });
  const totalGames = moves.reduce((sum, row) => sum + row.games, 0);

  const serializedMoves = await Promise.all(
    moves.map(async (row) => {
      const scorePct =
        row.games > 0
          ? ((row.white_wins + row.draws * 0.5) / row.games) * 100
          : null;
      const popularityPct =
        totalGames > 0
          ? (row.games / totalGames) * 100
          : null;

      let children: Record<string, unknown>[] = [];
      if (
        params.depth > 1 &&
        row.next_fen_norm &&
        !params.visited.has(row.next_fen_norm)
      ) {
        const nextVisited = new Set(params.visited);
        nextVisited.add(row.next_fen_norm);
        const child = await buildOpeningNode(pool, {
          userId: params.userId,
          fenNorm: row.next_fen_norm,
          depth: params.depth - 1,
          visited: nextVisited,
        });
        children = [child];
      }

      return {
        moveUci: row.move_uci,
        nextFenNorm: row.next_fen_norm,
        games: row.games,
        whiteWins: row.white_wins,
        blackWins: row.black_wins,
        draws: row.draws,
        scorePct,
        popularityPct,
        avgOpponentStrength:
          row.avg_elo === null ? null : Number(row.avg_elo),
        performance:
          row.performance === null ? null : Number(row.performance),
        transpositions: row.transpositions,
        children,
      };
    })
  );

  return {
    fenNorm: params.fenNorm,
    totalGames,
    moves: serializedMoves,
  };
}

export async function registerOpeningRoutes(
  app: FastifyInstance,
  pool: Pool
): Promise<void> {
  app.get("/api/openings/tree", { preHandler: requireUser }, async (request, reply) => {
    const parsed = OpeningTreeQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid query params",
        details: parsed.error.flatten(),
      });
    }

    let fenNorm: string;
    try {
      fenNorm = normalizeFen(parsed.data.fen).fenNorm;
    } catch (error) {
      return reply.status(400).send({ error: String(error) });
    }

    const tree = await buildOpeningNode(pool, {
      userId: request.user!.id,
      fenNorm,
      depth: parsed.data.depth,
      visited: new Set([fenNorm]),
    });

    return {
      fenNorm,
      depth: parsed.data.depth,
      tree,
    };
  });
}

