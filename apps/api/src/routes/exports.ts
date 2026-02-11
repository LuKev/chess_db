import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { requireUser } from "../auth.js";
import type { ExportQueue } from "../infrastructure/queue.js";
import type { ObjectStorage } from "../infrastructure/storage.js";

const ExportByIdsSchema = z.object({
  mode: z.literal("ids"),
  gameIds: z.array(z.number().int().positive()).min(1).max(5000),
  includeAnnotations: z.boolean().default(false),
});

const ExportByQuerySchema = z.object({
  mode: z.literal("query"),
  query: z.record(z.string(), z.unknown()),
  includeAnnotations: z.boolean().default(false),
});

const CreateExportSchema = z.union([ExportByIdsSchema, ExportByQuerySchema]);

function toId(value: number | string): number {
  if (typeof value === "number") {
    return value;
  }
  return Number(value);
}

export async function registerExportRoutes(
  app: FastifyInstance,
  pool: Pool,
  queue: ExportQueue,
  storage: ObjectStorage
): Promise<void> {
  app.post("/api/exports", { preHandler: requireUser }, async (request, reply) => {
    const parsed = CreateExportSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid request body",
        details: parsed.error.flatten(),
      });
    }

    const payload = parsed.data;
    const createResult = await pool.query<{ id: number | string }>(
      `INSERT INTO export_jobs (
        user_id,
        status,
        mode,
        game_ids,
        filter_query,
        include_annotations
      ) VALUES ($1, 'queued', $2, $3, $4::jsonb, $5)
      RETURNING id`,
      [
        request.user!.id,
        payload.mode,
        payload.mode === "ids" ? payload.gameIds : null,
        payload.mode === "query" ? JSON.stringify(payload.query) : null,
        payload.includeAnnotations,
      ]
    );

    const exportJobId = toId(createResult.rows[0].id);

    try {
      await queue.enqueueExport({
        exportJobId,
        userId: request.user!.id,
      });

      return reply.status(201).send({
        id: exportJobId,
        status: "queued",
      });
    } catch (error) {
      request.log.error(error);
      await pool.query(
        `UPDATE export_jobs
         SET status = 'failed',
             error_message = 'Failed to enqueue export request',
             updated_at = NOW()
         WHERE id = $1`,
        [exportJobId]
      );

      return reply.status(500).send({ error: "Failed to enqueue export request" });
    }
  });

  app.get<{ Params: { id: string } }>(
    "/api/exports/:id",
    { preHandler: requireUser },
    async (request, reply) => {
      const exportJobId = Number(request.params.id);
      if (!Number.isInteger(exportJobId) || exportJobId <= 0) {
        return reply.status(400).send({ error: "Invalid export id" });
      }

      const result = await pool.query<{
        id: number | string;
        status: string;
        mode: string;
        output_object_key: string | null;
        exported_games: number;
        error_message: string | null;
        created_at: Date;
        updated_at: Date;
      }>(
        `SELECT
          id,
          status,
          mode,
          output_object_key,
          exported_games,
          error_message,
          created_at,
          updated_at
        FROM export_jobs
        WHERE id = $1 AND user_id = $2`,
        [exportJobId, request.user!.id]
      );

      if (!result.rowCount) {
        return reply.status(404).send({ error: "Export job not found" });
      }

      const row = result.rows[0];
      return {
        id: toId(row.id),
        status: row.status,
        mode: row.mode,
        outputObjectKey: row.output_object_key,
        exportedGames: row.exported_games,
        error: row.error_message,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      };
    }
  );

  app.get("/api/exports", { preHandler: requireUser }, async (request) => {
    const result = await pool.query<{
      id: number | string;
      status: string;
      mode: string;
      output_object_key: string | null;
      exported_games: number;
      error_message: string | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT
        id,
        status,
        mode,
        output_object_key,
        exported_games,
        error_message,
        created_at,
        updated_at
      FROM export_jobs
      WHERE user_id = $1
      ORDER BY id DESC
      LIMIT 25`,
      [request.user!.id]
    );

    return {
      items: result.rows.map((row) => ({
        id: toId(row.id),
        status: row.status,
        mode: row.mode,
        outputObjectKey: row.output_object_key,
        exportedGames: row.exported_games,
        error: row.error_message,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      })),
    };
  });

  app.get<{ Params: { id: string } }>(
    "/api/exports/:id/download",
    { preHandler: requireUser },
    async (request, reply) => {
      const exportJobId = Number(request.params.id);
      if (!Number.isInteger(exportJobId) || exportJobId <= 0) {
        return reply.status(400).send({ error: "Invalid export id" });
      }

      const result = await pool.query<{
        output_object_key: string | null;
        status: string;
      }>(
        `SELECT output_object_key, status
         FROM export_jobs
         WHERE id = $1 AND user_id = $2`,
        [exportJobId, request.user!.id]
      );

      if (!result.rowCount) {
        return reply.status(404).send({ error: "Export job not found" });
      }

      const job = result.rows[0];
      if (job.status !== "completed" || !job.output_object_key) {
        return reply.status(409).send({ error: "Export artifact is not ready" });
      }

      try {
        const objectStream = await storage.getObjectStream(job.output_object_key);
        reply.header("content-type", "application/x-chess-pgn");
        reply.header(
          "content-disposition",
          `attachment; filename="export-${exportJobId}.pgn"`
        );
        return reply.send(objectStream);
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: "Failed to read export artifact" });
      }
    }
  );
}
