import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { requireUser } from "../auth.js";

const CreateCollectionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
});

const UpdateCollectionSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
});

const CollectionGamesSchema = z.object({
  gameIds: z.array(z.number().int().positive()).min(1).max(10_000),
});

function toId(value: number | string): number {
  if (typeof value === "number") {
    return value;
  }
  return Number(value);
}

async function assertCollectionOwnership(
  pool: Pool,
  collectionId: number,
  userId: number
): Promise<boolean> {
  const row = await pool.query<{ id: number | string }>(
    "SELECT id FROM collections WHERE id = $1 AND user_id = $2",
    [collectionId, userId]
  );
  return Boolean(row.rowCount);
}

export async function registerCollectionRoutes(
  app: FastifyInstance,
  pool: Pool
): Promise<void> {
  app.post("/api/collections", { preHandler: requireUser }, async (request, reply) => {
    const parsed = CreateCollectionSchema.safeParse(request.body);
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
        description: string | null;
        created_at: Date;
        updated_at: Date;
      }>(
        `INSERT INTO collections (user_id, name, description)
         VALUES ($1, $2, $3)
         RETURNING id, name, description, created_at, updated_at`,
        [request.user!.id, parsed.data.name, parsed.data.description ?? null]
      );

      const row = result.rows[0];
      return reply.status(201).send({
        id: toId(row.id),
        name: row.name,
        description: row.description,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        return reply.status(409).send({ error: "Collection name already exists" });
      }
      request.log.error(error);
      return reply.status(500).send({ error: "Failed to create collection" });
    }
  });

  app.get("/api/collections", { preHandler: requireUser }, async (request) => {
    const result = await pool.query<{
      id: number | string;
      name: string;
      description: string | null;
      created_at: Date;
      updated_at: Date;
      game_count: string;
    }>(
      `SELECT
        c.id,
        c.name,
        c.description,
        c.created_at,
        c.updated_at,
        COUNT(cg.game_id)::text AS game_count
      FROM collections c
      LEFT JOIN collection_games cg
        ON cg.collection_id = c.id
       AND cg.user_id = c.user_id
      WHERE c.user_id = $1
      GROUP BY c.id
      ORDER BY c.updated_at DESC, c.id DESC`,
      [request.user!.id]
    );

    return {
      items: result.rows.map((row) => ({
        id: toId(row.id),
        name: row.name,
        description: row.description,
        gameCount: Number(row.game_count),
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      })),
    };
  });

  app.patch<{ Params: { id: string } }>(
    "/api/collections/:id",
    { preHandler: requireUser },
    async (request, reply) => {
      const collectionId = Number(request.params.id);
      if (!Number.isInteger(collectionId) || collectionId <= 0) {
        return reply.status(400).send({ error: "Invalid collection id" });
      }

      const parsed = UpdateCollectionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid request body",
          details: parsed.error.flatten(),
        });
      }
      if (Object.keys(parsed.data).length === 0) {
        return reply.status(400).send({ error: "No updates provided" });
      }

      const result = await pool.query<{
        id: number | string;
        name: string;
        description: string | null;
        created_at: Date;
        updated_at: Date;
      }>(
        `UPDATE collections
         SET
           name = COALESCE($3, name),
           description = COALESCE($4, description),
           updated_at = NOW()
         WHERE id = $1 AND user_id = $2
         RETURNING id, name, description, created_at, updated_at`,
        [
          collectionId,
          request.user!.id,
          parsed.data.name ?? null,
          parsed.data.description ?? null,
        ]
      );

      if (!result.rowCount) {
        return reply.status(404).send({ error: "Collection not found" });
      }
      const row = result.rows[0];
      return {
        id: toId(row.id),
        name: row.name,
        description: row.description,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      };
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/api/collections/:id",
    { preHandler: requireUser },
    async (request, reply) => {
      const collectionId = Number(request.params.id);
      if (!Number.isInteger(collectionId) || collectionId <= 0) {
        return reply.status(400).send({ error: "Invalid collection id" });
      }

      const result = await pool.query(
        "DELETE FROM collections WHERE id = $1 AND user_id = $2",
        [collectionId, request.user!.id]
      );
      if (!result.rowCount) {
        return reply.status(404).send({ error: "Collection not found" });
      }
      return reply.status(204).send();
    }
  );

  app.post<{ Params: { id: string } }>(
    "/api/collections/:id/games",
    { preHandler: requireUser },
    async (request, reply) => {
      const collectionId = Number(request.params.id);
      if (!Number.isInteger(collectionId) || collectionId <= 0) {
        return reply.status(400).send({ error: "Invalid collection id" });
      }
      const parsed = CollectionGamesSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid request body",
          details: parsed.error.flatten(),
        });
      }

      const ownsCollection = await assertCollectionOwnership(
        pool,
        collectionId,
        request.user!.id
      );
      if (!ownsCollection) {
        return reply.status(404).send({ error: "Collection not found" });
      }

      const validGames = await pool.query<{ id: number | string }>(
        `SELECT id
         FROM games
         WHERE user_id = $1
           AND id = ANY($2::bigint[])`,
        [request.user!.id, parsed.data.gameIds]
      );
      const gameIds = validGames.rows.map((row) => toId(row.id));

      for (const gameId of gameIds) {
        await pool.query(
          `INSERT INTO collection_games (collection_id, user_id, game_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (collection_id, game_id) DO NOTHING`,
          [collectionId, request.user!.id, gameId]
        );
      }

      await pool.query(
        `UPDATE collections
         SET updated_at = NOW()
         WHERE id = $1 AND user_id = $2`,
        [collectionId, request.user!.id]
      );

      return {
        collectionId,
        assignedCount: gameIds.length,
      };
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/api/collections/:id/games",
    { preHandler: requireUser },
    async (request, reply) => {
      const collectionId = Number(request.params.id);
      if (!Number.isInteger(collectionId) || collectionId <= 0) {
        return reply.status(400).send({ error: "Invalid collection id" });
      }
      const parsed = CollectionGamesSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid request body",
          details: parsed.error.flatten(),
        });
      }

      const ownsCollection = await assertCollectionOwnership(
        pool,
        collectionId,
        request.user!.id
      );
      if (!ownsCollection) {
        return reply.status(404).send({ error: "Collection not found" });
      }

      const result = await pool.query(
        `DELETE FROM collection_games
         WHERE collection_id = $1
           AND user_id = $2
           AND game_id = ANY($3::bigint[])`,
        [collectionId, request.user!.id, parsed.data.gameIds]
      );

      await pool.query(
        `UPDATE collections
         SET updated_at = NOW()
         WHERE id = $1 AND user_id = $2`,
        [collectionId, request.user!.id]
      );

      return {
        collectionId,
        removedCount: result.rowCount ?? 0,
      };
    }
  );
}

