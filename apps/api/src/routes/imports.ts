import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Readable } from "node:stream";
import type { Pool } from "pg";
import { requireUser } from "../auth.js";
import type { AppConfig } from "../config.js";
import type { ImportQueue } from "../infrastructure/queue.js";
import {
  buildImportObjectKey,
  type ObjectStorage,
} from "../infrastructure/storage.js";

const AllowedExtensions = [".pgn", ".pgn.zst"] as const;
const AllowedMimeTypes = new Set([
  "application/x-chess-pgn",
  "application/octet-stream",
  "text/plain",
  "application/zstd",
  "application/x-zstd",
]);

const ImportListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

const ImportCreateQuerySchema = z.object({
  strictDuplicate: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});

function hasAllowedExtension(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return AllowedExtensions.some((ext) => lower.endsWith(ext));
}

function toId(value: number | string): number {
  if (typeof value === "number") {
    return value;
  }
  return Number(value);
}

export async function registerImportRoutes(
  app: FastifyInstance,
  pool: Pool,
  config: AppConfig,
  queue: ImportQueue,
  storage: ObjectStorage
): Promise<void> {
  app.post("/api/imports", { preHandler: requireUser }, async (request, reply) => {
    const createQuery = ImportCreateQuerySchema.safeParse(request.query);
    if (!createQuery.success) {
      return reply.status(400).send({
        error: "Invalid query params",
        details: createQuery.error.flatten(),
      });
    }

    const file = await request.file();
    if (!file) {
      return reply.status(400).send({ error: "Missing upload file" });
    }

    if (!hasAllowedExtension(file.filename)) {
      file.file.resume();
      return reply.status(400).send({
        error: `Invalid file extension. Allowed: ${AllowedExtensions.join(", ")}`,
      });
    }

    if (!AllowedMimeTypes.has(file.mimetype)) {
      file.file.resume();
      return reply.status(400).send({
        error: `Invalid content type: ${file.mimetype}`,
      });
    }

    const createJobResult = await pool.query<{ id: number | string }>(
      `INSERT INTO import_jobs (user_id, status, strict_duplicate_mode)
       VALUES ($1, 'queued', $2)
       RETURNING id`,
      [request.user!.id, createQuery.data.strictDuplicate ?? false]
    );

    const importJobId = toId(createJobResult.rows[0].id);
    const objectKey = buildImportObjectKey({
      userId: request.user!.id,
      importJobId,
      fileName: file.filename,
    });

    try {
      await storage.uploadObject({
        key: objectKey,
        body: file.file as Readable,
        contentType: file.mimetype,
      });

      if (file.file.truncated) {
        await pool.query(
          `UPDATE import_jobs
           SET status = 'failed',
               updated_at = NOW(),
               parse_errors = 1
           WHERE id = $1`,
          [importJobId]
        );

        return reply.status(413).send({
          error: `Upload exceeded max size (${config.uploadMaxBytes} bytes)`,
        });
      }

      await pool.query(
        `UPDATE import_jobs
         SET source_object_key = $2, updated_at = NOW()
         WHERE id = $1`,
        [importJobId, objectKey]
      );

      await queue.enqueueImport({
        importJobId,
        userId: request.user!.id,
      });

      return reply.status(201).send({
        id: importJobId,
        status: "queued",
        objectKey,
        strictDuplicateMode: createQuery.data.strictDuplicate ?? false,
      });
    } catch (error) {
      request.log.error(error);
      await pool.query(
        `UPDATE import_jobs
         SET status = 'failed', updated_at = NOW(), parse_errors = parse_errors + 1
         WHERE id = $1`,
        [importJobId]
      );

      return reply.status(500).send({ error: "Failed to create import job" });
    }
  });

  app.get<{ Params: { id: string } }>(
    "/api/imports/:id",
    { preHandler: requireUser },
    async (request, reply) => {
      const importJobId = Number(request.params.id);
      if (!Number.isInteger(importJobId) || importJobId <= 0) {
        return reply.status(400).send({ error: "Invalid import id" });
      }

      const jobResult = await pool.query<{
        id: number | string;
        status: string;
        source_object_key: string | null;
        strict_duplicate_mode: boolean;
        total_games: number;
        inserted_games: number;
        duplicate_games: number;
        duplicate_by_moves: number;
        duplicate_by_canonical: number;
        parse_errors: number;
        created_at: Date;
        updated_at: Date;
      }>(
        `SELECT
          id,
          status,
          source_object_key,
          strict_duplicate_mode,
          total_games,
          inserted_games,
          duplicate_games,
          duplicate_by_moves,
          duplicate_by_canonical,
          parse_errors,
          created_at,
          updated_at
        FROM import_jobs
        WHERE id = $1 AND user_id = $2`,
        [importJobId, request.user!.id]
      );

      if (!jobResult.rowCount) {
        return reply.status(404).send({ error: "Import not found" });
      }

      const errorRows = await pool.query<{
        line_number: number | null;
        game_offset: number | null;
        error_message: string;
      }>(
        `SELECT line_number, game_offset, error_message
         FROM import_errors
         WHERE import_job_id = $1
         ORDER BY id DESC
         LIMIT 25`,
        [importJobId]
      );

      const job = jobResult.rows[0];
      const durationMs =
        new Date(job.updated_at).valueOf() - new Date(job.created_at).valueOf();
      const throughputGamesPerMinute =
        durationMs > 0 ? (job.inserted_games / durationMs) * 60_000 : null;
      return {
        id: toId(job.id),
        status: job.status,
        sourceObjectKey: job.source_object_key,
        strictDuplicateMode: job.strict_duplicate_mode,
        totals: {
          parsed: job.total_games,
          inserted: job.inserted_games,
          duplicates: job.duplicate_games,
          parseErrors: job.parse_errors,
          duplicateReasons: {
            byMoves: job.duplicate_by_moves,
            byCanonical: job.duplicate_by_canonical,
          },
        },
        recentErrors: errorRows.rows.map((row) => ({
          lineNumber: row.line_number,
          gameOffset: row.game_offset,
          message: row.error_message,
        })),
        throughputGamesPerMinute,
        createdAt: job.created_at.toISOString(),
        updatedAt: job.updated_at.toISOString(),
      };
    }
  );

  app.get("/api/imports", { preHandler: requireUser }, async (request, reply) => {
    const parsed = ImportListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid query params",
        details: parsed.error.flatten(),
      });
    }

    const query = parsed.data;
    const offset = (query.page - 1) * query.pageSize;

    const countResult = await pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM import_jobs
       WHERE user_id = $1`,
      [request.user!.id]
    );

    const rows = await pool.query<{
      id: number | string;
      status: string;
      strict_duplicate_mode: boolean;
      total_games: number;
      inserted_games: number;
      duplicate_games: number;
      duplicate_by_moves: number;
      duplicate_by_canonical: number;
      parse_errors: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT
        id,
        status,
        strict_duplicate_mode,
        total_games,
        inserted_games,
        duplicate_games,
        duplicate_by_moves,
        duplicate_by_canonical,
        parse_errors,
        created_at,
        updated_at
      FROM import_jobs
      WHERE user_id = $1
      ORDER BY id DESC
      LIMIT $2 OFFSET $3`,
      [request.user!.id, query.pageSize, offset]
    );

    return {
      page: query.page,
      pageSize: query.pageSize,
      total: Number(countResult.rows[0].total),
      items: rows.rows.map((row) => ({
        id: toId(row.id),
        status: row.status,
        strictDuplicateMode: row.strict_duplicate_mode,
        totals: {
          parsed: row.total_games,
          inserted: row.inserted_games,
          duplicates: row.duplicate_games,
          parseErrors: row.parse_errors,
          duplicateReasons: {
            byMoves: row.duplicate_by_moves,
            byCanonical: row.duplicate_by_canonical,
          },
        },
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      })),
    };
  });
}
