import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { requireUser } from "../auth.js";

const CreateTagSchema = z.object({
  name: z.string().trim().min(1).max(64),
  color: z
    .string()
    .trim()
    .regex(/^#?[0-9a-fA-F]{6}$/)
    .optional(),
});

function toId(value: number | string): number {
  if (typeof value === "number") {
    return value;
  }
  return Number(value);
}

export async function registerTagRoutes(
  app: FastifyInstance,
  pool: Pool
): Promise<void> {
  app.post("/api/tags", { preHandler: requireUser }, async (request, reply) => {
    const parsed = CreateTagSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid request body",
        details: parsed.error.flatten(),
      });
    }

    try {
      const result = await pool.query<{
        id: number | string;
        name: string;
        color: string | null;
        created_at: Date;
      }>(
        `INSERT INTO tags (user_id, name, color)
         VALUES ($1, $2, $3)
         RETURNING id, name, color, created_at`,
        [
          request.user!.id,
          parsed.data.name,
          parsed.data.color
            ? parsed.data.color.startsWith("#")
              ? parsed.data.color
              : `#${parsed.data.color}`
            : null,
        ]
      );

      const row = result.rows[0];
      return reply.status(201).send({
        id: toId(row.id),
        name: row.name,
        color: row.color,
        createdAt: row.created_at.toISOString(),
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        return reply.status(409).send({ error: "Tag name already exists" });
      }
      request.log.error(error);
      return reply.status(500).send({ error: "Failed to create tag" });
    }
  });

  app.get("/api/tags", { preHandler: requireUser }, async (request) => {
    const rows = await pool.query<{
      id: number | string;
      name: string;
      color: string | null;
      created_at: Date;
      game_count: string;
    }>(
      `SELECT
        t.id,
        t.name,
        t.color,
        t.created_at,
        COUNT(gt.game_id)::text AS game_count
      FROM tags t
      LEFT JOIN game_tags gt
        ON gt.tag_id = t.id
       AND gt.user_id = t.user_id
      WHERE t.user_id = $1
      GROUP BY t.id
      ORDER BY t.name ASC`,
      [request.user!.id]
    );

    return {
      items: rows.rows.map((row) => ({
        id: toId(row.id),
        name: row.name,
        color: row.color,
        gameCount: Number(row.game_count),
        createdAt: row.created_at.toISOString(),
      })),
    };
  });

  app.delete<{ Params: { id: string } }>(
    "/api/tags/:id",
    { preHandler: requireUser },
    async (request, reply) => {
      const tagId = Number(request.params.id);
      if (!Number.isInteger(tagId) || tagId <= 0) {
        return reply.status(400).send({ error: "Invalid tag id" });
      }

      const result = await pool.query(
        "DELETE FROM tags WHERE id = $1 AND user_id = $2",
        [tagId, request.user!.id]
      );

      if (!result.rowCount) {
        return reply.status(404).send({ error: "Tag not found" });
      }

      return reply.status(204).send();
    }
  );

  app.post<{ Params: { id: string; tagId: string } }>(
    "/api/games/:id/tags/:tagId",
    { preHandler: requireUser },
    async (request, reply) => {
      const gameId = Number(request.params.id);
      const tagId = Number(request.params.tagId);
      if (!Number.isInteger(gameId) || gameId <= 0 || !Number.isInteger(tagId) || tagId <= 0) {
        return reply.status(400).send({ error: "Invalid id" });
      }

      const game = await pool.query<{ id: number | string }>(
        "SELECT id FROM games WHERE id = $1 AND user_id = $2",
        [gameId, request.user!.id]
      );
      if (!game.rowCount) {
        return reply.status(404).send({ error: "Game not found" });
      }

      const tag = await pool.query<{ id: number | string }>(
        "SELECT id FROM tags WHERE id = $1 AND user_id = $2",
        [tagId, request.user!.id]
      );
      if (!tag.rowCount) {
        return reply.status(404).send({ error: "Tag not found" });
      }

      await pool.query(
        `INSERT INTO game_tags (game_id, tag_id, user_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (game_id, tag_id) DO NOTHING`,
        [gameId, tagId, request.user!.id]
      );

      return reply.status(201).send({
        gameId,
        tagId,
      });
    }
  );

  app.delete<{ Params: { id: string; tagId: string } }>(
    "/api/games/:id/tags/:tagId",
    { preHandler: requireUser },
    async (request, reply) => {
      const gameId = Number(request.params.id);
      const tagId = Number(request.params.tagId);
      if (!Number.isInteger(gameId) || gameId <= 0 || !Number.isInteger(tagId) || tagId <= 0) {
        return reply.status(400).send({ error: "Invalid id" });
      }

      const result = await pool.query(
        `DELETE FROM game_tags
         WHERE game_id = $1
           AND tag_id = $2
           AND user_id = $3`,
        [gameId, tagId, request.user!.id]
      );

      if (!result.rowCount) {
        return reply.status(404).send({ error: "Tag assignment not found" });
      }

      return reply.status(204).send();
    }
  );
}

