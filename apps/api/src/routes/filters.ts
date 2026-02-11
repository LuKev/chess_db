import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { requireUser } from "../auth.js";

const CreateFilterSchema = z.object({
  name: z.string().trim().min(1).max(120),
  query: z.record(z.string(), z.unknown()),
});

const SharedFilterParamsSchema = z.object({
  token: z.string().trim().min(8).max(64),
});

function createShareToken(): string {
  return randomBytes(12).toString("hex");
}

function builtInPresets(): Array<{
  id: string;
  name: string;
  description: string;
  query: Record<string, unknown>;
}> {
  const currentYear = new Date().getUTCFullYear();
  return [
    {
      id: "preset-recent-year",
      name: "Recent Year",
      description: "Games from the current calendar year",
      query: {
        fromDate: `${currentYear}-01-01`,
        sort: "date_desc",
      },
    },
    {
      id: "preset-high-elo",
      name: "High Elo",
      description: "Games with average Elo at least 2400",
      query: {
        avgEloMin: 2400,
        sort: "date_desc",
      },
    },
    {
      id: "preset-openings-e4",
      name: "Open Games",
      description: "Typical 1.e4 openings",
      query: {
        openingPrefix: "C",
        sort: "date_desc",
      },
    },
  ];
}

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
  app.get("/api/filters/presets", async () => {
    return {
      items: builtInPresets().map((preset) => ({
        id: preset.id,
        name: preset.name,
        description: preset.description,
        query: preset.query,
      })),
    };
  });

  app.post("/api/filters", { preHandler: requireUser }, async (request, reply) => {
    const parsed = CreateFilterSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid request body",
        details: parsed.error.flatten(),
      });
    }

    let result:
      | {
          id: number | string;
          name: string;
          filter_query: Record<string, unknown>;
          share_token: string;
          created_at: Date;
          updated_at: Date;
        }
      | null = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const shareToken = createShareToken();
      try {
        const insertResult = await pool.query<{
          id: number | string;
          name: string;
          filter_query: Record<string, unknown>;
          share_token: string;
          created_at: Date;
          updated_at: Date;
        }>(
          `INSERT INTO saved_filters (user_id, name, filter_query, share_token)
           VALUES ($1, $2, $3::jsonb, $4)
           RETURNING id, name, filter_query, share_token, created_at, updated_at`,
          [request.user!.id, parsed.data.name, JSON.stringify(parsed.data.query), shareToken]
        );
        result = insertResult.rows[0];
        break;
      } catch (error) {
        if ((error as { code?: string }).code !== "23505") {
          throw error;
        }
      }
    }

    if (!result) {
      return reply.status(500).send({ error: "Failed to create saved filter" });
    }

    return reply.status(201).send({
      id: toId(result.id),
      name: result.name,
      query: result.filter_query,
      shareToken: result.share_token,
      createdAt: result.created_at.toISOString(),
      updatedAt: result.updated_at.toISOString(),
    });
  });

  app.get("/api/filters", { preHandler: requireUser }, async (request) => {
    const result = await pool.query<{
      id: number | string;
      name: string;
      filter_query: Record<string, unknown>;
      share_token: string;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, name, filter_query, share_token, created_at, updated_at
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
        shareToken: row.share_token,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      })),
    };
  });

  app.get<{ Params: { token: string } }>(
    "/api/filters/shared/:token",
    { preHandler: requireUser },
    async (request, reply) => {
      const parsed = SharedFilterParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid shared filter token",
          details: parsed.error.flatten(),
        });
      }

      const result = await pool.query<{
        id: number | string;
        name: string;
        filter_query: Record<string, unknown>;
        share_token: string;
        created_at: Date;
        updated_at: Date;
      }>(
        `SELECT id, name, filter_query, share_token, created_at, updated_at
         FROM saved_filters
         WHERE user_id = $1
           AND share_token = $2
         LIMIT 1`,
        [request.user!.id, parsed.data.token]
      );

      if (!result.rowCount) {
        return reply.status(404).send({ error: "Shared filter not found" });
      }

      const row = result.rows[0];
      return {
        id: toId(row.id),
        name: row.name,
        query: row.filter_query,
        shareToken: row.share_token,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      };
    }
  );

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
