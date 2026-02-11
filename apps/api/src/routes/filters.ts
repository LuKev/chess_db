import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { requireUser } from "../auth.js";

const CreateFilterSchema = z.object({
  name: z.string().trim().min(1).max(120),
  query: z.record(z.string(), z.unknown()),
});

function toId(value: number | string): number {
  if (typeof value === "number") {
    return value;
  }
  return Number(value);
}

export async function registerFilterRoutes(
  app: FastifyInstance,
  pool: Pool
): Promise<void> {
  app.post("/api/filters", { preHandler: requireUser }, async (request, reply) => {
    const parsed = CreateFilterSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid request body",
        details: parsed.error.flatten(),
      });
    }

    const result = await pool.query<{
      id: number | string;
      name: string;
      filter_query: Record<string, unknown>;
      created_at: Date;
      updated_at: Date;
    }>(
      `INSERT INTO saved_filters (user_id, name, filter_query)
       VALUES ($1, $2, $3::jsonb)
       RETURNING id, name, filter_query, created_at, updated_at`,
      [request.user!.id, parsed.data.name, JSON.stringify(parsed.data.query)]
    );

    return reply.status(201).send({
      id: toId(result.rows[0].id),
      name: result.rows[0].name,
      query: result.rows[0].filter_query,
      createdAt: result.rows[0].created_at.toISOString(),
      updatedAt: result.rows[0].updated_at.toISOString(),
    });
  });

  app.get("/api/filters", { preHandler: requireUser }, async (request) => {
    const result = await pool.query<{
      id: number | string;
      name: string;
      filter_query: Record<string, unknown>;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, name, filter_query, created_at, updated_at
       FROM saved_filters
       WHERE user_id = $1
       ORDER BY updated_at DESC, id DESC`,
      [request.user!.id]
    );

    return {
      items: result.rows.map((row) => ({
        id: toId(row.id),
        name: row.name,
        query: row.filter_query,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      })),
    };
  });

  app.delete<{ Params: { id: string } }>(
    "/api/filters/:id",
    { preHandler: requireUser },
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return reply.status(400).send({ error: "Invalid filter id" });
      }

      const result = await pool.query(
        "DELETE FROM saved_filters WHERE id = $1 AND user_id = $2",
        [id, request.user!.id]
      );

      if (!result.rowCount) {
        return reply.status(404).send({ error: "Filter not found" });
      }

      return reply.status(204).send();
    }
  );
}
