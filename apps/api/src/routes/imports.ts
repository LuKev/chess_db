import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { Readable } from "node:stream";
import type { Pool } from "pg";
import { requireUser } from "../auth.js";
import type { AppConfig } from "../config.js";
import { parseIdempotencyKey } from "../http/idempotency.js";
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

const ImportErrorsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
});

const ImportCreateQuerySchema = z.object({
  strictDuplicate: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});

const SamplePgnSeed = [
  `[Event "Sample 1"]`,
  `[Site "Chess DB"]`,
  `[Date "2024.01.01"]`,
  `[Round "-"]`,
  `[White "Kasparov, Garry"]`,
  `[Black "Karpov, Anatoly"]`,
  `[Result "1-0"]`,
  `[ECO "B44"]`,
  ``,
  `1. e4 c5 2. Nf3 e6 3. d4 cxd4 4. Nxd4 Nc6 5. Nc3 Qc7 6. Be3 a6 1-0`,
  ``,
  `[Event "Sample 2"]`,
  `[Site "Chess DB"]`,
  `[Date "2024.01.02"]`,
  `[Round "-"]`,
  `[White "Carlsen, Magnus"]`,
  `[Black "Nakamura, Hikaru"]`,
  `[Result "1/2-1/2"]`,
  `[ECO "C65"]`,
  ``,
  `1. e4 e5 2. Nf3 Nc6 3. Bb5 Nf6 4. O-O Be7 5. Re1 b5 6. Bb3 d6 1/2-1/2`,
  ``,
  `[Event "Sample 3"]`,
  `[Site "Chess DB"]`,
  `[Date "2024.01.03"]`,
  `[Round "-"]`,
  `[White "Polgar, Judit"]`,
  `[Black "Anand, Viswanathan"]`,
  `[Result "0-1"]`,
  `[ECO "D37"]`,
  ``,
  `1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Nf3 Be7 5. Bf4 O-O 6. e3 c5 0-1`,
  ``,
].join("\\n");

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
  app.post("/api/imports/sample", { preHandler: requireUser }, async (request, reply) => {
    const createJobResult = await pool.query<{ id: number | string }>(
      `INSERT INTO import_jobs (user_id, status, strict_duplicate_mode)
       VALUES ($1, 'queued', FALSE)
       RETURNING id`,
      [request.user!.id]
    );
    const importJobId = toId(createJobResult.rows[0].id);
    const objectKey = buildImportObjectKey({
      userId: request.user!.id,
      importJobId,
      fileName: "sample-seed.pgn",
    });

    try {
      await storage.uploadObject({
        key: objectKey,
        body: Readable.from([SamplePgnSeed]),
        contentType: "application/x-chess-pgn",
      });
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
        sample: true,
      });
    } catch (error) {
      request.log.error(error);
      await pool.query(
        `UPDATE import_jobs
         SET status = 'failed', updated_at = NOW(), parse_errors = parse_errors + 1
         WHERE id = $1`,
        [importJobId]
      );
      return reply.status(500).send({ error: "Failed to enqueue sample import" });
    }
  });

  app.post("/api/imports", { preHandler: requireUser }, async (request, reply) => {
    const createQuery = ImportCreateQuerySchema.safeParse(request.query);
    if (!createQuery.success) {
      return reply.status(400).send({
        error: "Invalid query params",
        details: createQuery.error.flatten(),
      });
    }

    const parsedIdempotency = parseIdempotencyKey(request.headers["idempotency-key"]);
    if (parsedIdempotency.error) {
      return reply.status(400).send({ error: parsedIdempotency.error });
    }
    const idempotencyKey = parsedIdempotency.key;
    if (idempotencyKey) {
      const existing = await pool.query<{
        id: number | string;
        status: string;
        source_object_key: string | null;
        strict_duplicate_mode: boolean;
      }>(
        `SELECT id, status, source_object_key, strict_duplicate_mode
         FROM import_jobs
         WHERE user_id = $1
           AND idempotency_key = $2
         ORDER BY id DESC
         LIMIT 1`,
        [request.user!.id, idempotencyKey]
      );
      if (existing.rowCount) {
        const row = existing.rows[0];
        return reply.status(200).send({
          id: toId(row.id),
          status: row.status,
          objectKey: row.source_object_key,
          strictDuplicateMode: row.strict_duplicate_mode,
          idempotentReplay: true,
        });
      }
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

    let importJobId: number;
    try {
      const createJobResult = await pool.query<{ id: number | string }>(
        `INSERT INTO import_jobs (user_id, status, strict_duplicate_mode, idempotency_key)
         VALUES ($1, 'queued', $2, $3)
         RETURNING id`,
        [request.user!.id, createQuery.data.strictDuplicate ?? false, idempotencyKey]
      );
      importJobId = toId(createJobResult.rows[0].id);
    } catch (error) {
      if ((error as { code?: string }).code === "23505" && idempotencyKey) {
        const existing = await pool.query<{
          id: number | string;
          status: string;
          source_object_key: string | null;
          strict_duplicate_mode: boolean;
        }>(
          `SELECT id, status, source_object_key, strict_duplicate_mode
           FROM import_jobs
           WHERE user_id = $1
             AND idempotency_key = $2
           ORDER BY id DESC
           LIMIT 1`,
          [request.user!.id, idempotencyKey]
        );
        if (existing.rowCount) {
          const row = existing.rows[0];
          return reply.status(200).send({
            id: toId(row.id),
            status: row.status,
            objectKey: row.source_object_key,
            strictDuplicateMode: row.strict_duplicate_mode,
            idempotentReplay: true,
          });
        }
      }
      throw error;
    }

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

  app.get<{ Params: { id: string } }>(
    "/api/imports/:id/errors",
    { preHandler: requireUser },
    async (request, reply) => {
      const importJobId = Number(request.params.id);
      if (!Number.isInteger(importJobId) || importJobId <= 0) {
        return reply.status(400).send({ error: "Invalid import id" });
      }

      const parsed = ImportErrorsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid query params",
          details: parsed.error.flatten(),
        });
      }

      const query = parsed.data;
      const offset = (query.page - 1) * query.pageSize;

      const ownership = await pool.query<{ id: number | string }>(
        "SELECT id FROM import_jobs WHERE id = $1 AND user_id = $2",
        [importJobId, request.user!.id]
      );
      if (!ownership.rowCount) {
        return reply.status(404).send({ error: "Import not found" });
      }

      const count = await pool.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total
         FROM import_errors
         WHERE import_job_id = $1`,
        [importJobId]
      );

      const rows = await pool.query<{
        id: number | string;
        line_number: number | null;
        game_offset: number | null;
        error_message: string;
        created_at: Date;
      }>(
        `SELECT id, line_number, game_offset, error_message, created_at
         FROM import_errors
         WHERE import_job_id = $1
         ORDER BY id DESC
         LIMIT $2 OFFSET $3`,
        [importJobId, query.pageSize, offset]
      );

      return {
        importJobId,
        page: query.page,
        pageSize: query.pageSize,
        total: Number(count.rows[0].total),
        items: rows.rows.map((row) => ({
          id: toId(row.id),
          lineNumber: row.line_number,
          gameOffset: row.game_offset,
          message: row.error_message,
          createdAt: row.created_at.toISOString(),
        })),
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
