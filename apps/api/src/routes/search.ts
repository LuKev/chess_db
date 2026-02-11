import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { requireUser } from "../auth.js";
import { buildMaterialLikeQueryFromFen, normalizeFen } from "../chess/fen.js";
import { buildMoveSnippet, extractMainlineSans } from "../chess/move_tree.js";

const PositionSearchSchema = z.object({
  fen: z.string().trim().min(1),
  page: z.number().int().positive().default(1).optional(),
  pageSize: z.number().int().positive().max(200).default(50).optional(),
});

const PositionMaterialSearchSchema = z.object({
  fen: z.string().trim().optional(),
  materialKey: z.string().trim().optional(),
  sideToMove: z.enum(["w", "b"]).optional(),
  page: z.number().int().positive().default(1).optional(),
  pageSize: z.number().int().positive().max(200).default(50).optional(),
});

function toId(value: number | string): number {
  if (typeof value === "number") {
    return value;
  }
  return Number(value);
}

export async function registerSearchRoutes(
  app: FastifyInstance,
  pool: Pool
): Promise<void> {
  app.post("/api/search/position", { preHandler: requireUser }, async (request, reply) => {
    const parsed = PositionSearchSchema.safeParse(request.body);
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

    const page = parsed.data.page ?? 1;
    const pageSize = parsed.data.pageSize ?? 50;
    const offset = (page - 1) * pageSize;

    const countResult = await pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM game_positions gp
       WHERE gp.user_id = $1
         AND gp.fen_norm = $2`,
      [request.user!.id, fenNorm]
    );

    const rows = await pool.query<{
      game_id: number | string;
      ply: number;
      stm: "w" | "b";
      event: string | null;
      white: string;
      black: string;
      result: string;
      move_tree: Record<string, unknown>;
    }>(
      `SELECT
        gp.game_id,
        gp.ply,
        gp.stm,
        g.event,
        g.white,
        g.black,
        g.result,
        gm.move_tree
      FROM game_positions gp
      JOIN games g ON g.id = gp.game_id
      JOIN game_moves gm ON gm.game_id = gp.game_id
      WHERE gp.user_id = $1
        AND gp.fen_norm = $2
      ORDER BY gp.game_id DESC, gp.ply ASC
      LIMIT $3 OFFSET $4`,
      [request.user!.id, fenNorm, pageSize, offset]
    );

    return {
      page,
      pageSize,
      total: Number(countResult.rows[0].total),
      fenNorm,
      items: rows.rows.map((row) => {
        const mainline = extractMainlineSans(row.move_tree ?? {});
        const snippet = buildMoveSnippet(mainline, row.ply);
        return {
          gameId: toId(row.game_id),
          ply: row.ply,
          sideToMove: row.stm,
          white: row.white,
          black: row.black,
          result: row.result,
          event: row.event,
          snippet,
        };
      }),
    };
  });

  app.post(
    "/api/search/position/material",
    { preHandler: requireUser },
    async (request, reply) => {
      const parsed = PositionMaterialSearchSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid request body",
          details: parsed.error.flatten(),
        });
      }

      const page = parsed.data.page ?? 1;
      const pageSize = parsed.data.pageSize ?? 50;
      const offset = (page - 1) * pageSize;
      const materialKey =
        parsed.data.materialKey ??
        (parsed.data.fen ? buildMaterialLikeQueryFromFen(parsed.data.fen) : null);

      if (!materialKey) {
        return reply.status(400).send({
          error: "Provide either materialKey or fen for material search",
        });
      }

      const whereClauses = [
        "gp.user_id = $1",
        "gp.material_key = $2",
      ];
      const params: unknown[] = [request.user!.id, materialKey];

      if (parsed.data.sideToMove) {
        params.push(parsed.data.sideToMove);
        whereClauses.push(`gp.stm = $${params.length}`);
      }
      const whereSql = whereClauses.join(" AND ");

      const countResult = await pool.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total
         FROM game_positions gp
         WHERE ${whereSql}`,
        params
      );

      params.push(pageSize);
      params.push(offset);
      const rows = await pool.query<{
        game_id: number | string;
        ply: number;
        stm: "w" | "b";
        fen_norm: string;
      }>(
        `SELECT game_id, ply, stm, fen_norm
         FROM game_positions gp
         WHERE ${whereSql}
         ORDER BY game_id DESC, ply ASC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );

      return {
        page,
        pageSize,
        total: Number(countResult.rows[0].total),
        materialKey,
        items: rows.rows.map((row) => ({
          gameId: toId(row.game_id),
          ply: row.ply,
          sideToMove: row.stm,
          fenNorm: row.fen_norm,
        })),
      };
    }
  );
}

