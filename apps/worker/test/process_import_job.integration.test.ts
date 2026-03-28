import { Readable } from "node:stream";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { runMigrations } from "../../api/src/migrations.js";
import { resetDatabase } from "../../api/src/db.js";
import { processOpeningBackfillJob } from "../src/backfill/process_opening_backfill_job.js";
import { processPositionBackfillJob } from "../src/backfill/process_position_backfill_job.js";
import { processImportJob } from "../src/imports/process_import_job.js";

const databaseUrl = process.env.DATABASE_URL;

(databaseUrl ? describe.sequential : describe.skip)(
  "processImportJob",
  () => {
    let pool: Pool;

    beforeAll(async () => {
      pool = new Pool({ connectionString: databaseUrl! });
      await runMigrations(pool);
    });

    beforeEach(async () => {
      await resetDatabase(pool);
    });

    afterAll(async () => {
      await pool.end();
    });

    it("finishes imports before indexing and rebuilds indexes in background jobs", async () => {
      const user = await pool.query<{ id: number }>(
        `INSERT INTO users (email, password_hash)
         VALUES ('worker-test@example.com', 'hash')
         RETURNING id`
      );
      const userId = Number(user.rows[0].id);

      const importJob = await pool.query<{ id: number }>(
        `INSERT INTO import_jobs (user_id, status, source_object_key)
         VALUES ($1, 'queued', 'imports/test.pgn')
         RETURNING id`,
        [userId]
      );

      const importJobId = Number(importJob.rows[0].id);
      const queuedOpeningBackfills: number[] = [];
      const pgnText =
        `[Event "A"]\n[White "One"]\n[Black "Two"]\n[Date "2026.02.11"]\n[Result "1-0"]\n\n1. e4 e5 1-0\n` +
        `[Event "A"]\n[White "One"]\n[Black "Two"]\n[Date "2026.02.11"]\n[Result "1-0"]\n\n1. e4 e5 1-0\n` +
        `[Event "Broken\n[White "Err"]\n[Black "Err"]\n[Result "*"]\n\n1. e4 e5 *\n`;

      await processImportJob({
        pool,
        importJobId,
        userId,
        storage: {
          ensureBucket: async () => {},
          getObjectStream: async () => Readable.from([pgnText]),
          putObject: async () => {},
          close: async () => {},
        },
        positionBackfillQueue: {
          enqueuePositionBackfill: async () => {},
        },
      });

      const jobState = await pool.query<{
        status: string;
        total_games: number;
        inserted_games: number;
        duplicate_games: number;
        parse_errors: number;
        position_index_status: string;
        opening_index_status: string;
      }>(
        `SELECT
           status,
           total_games,
           inserted_games,
           duplicate_games,
           parse_errors,
           position_index_status,
           opening_index_status
         FROM import_jobs
         WHERE id = $1`,
        [importJobId]
      );

      const positionsBefore = await pool.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total
         FROM game_positions
         WHERE user_id = $1`,
        [userId]
      );

      expect(jobState.rows[0].status).toBe("partial");
      expect(jobState.rows[0].total_games).toBe(3);
      expect(jobState.rows[0].inserted_games).toBe(1);
      expect(jobState.rows[0].duplicate_games).toBe(1);
      expect(jobState.rows[0].parse_errors).toBe(1);
      expect(jobState.rows[0].position_index_status).toBe("queued");
      expect(jobState.rows[0].opening_index_status).toBe("queued");
      expect(Number(positionsBefore.rows[0].total)).toBe(0);

      await processPositionBackfillJob({
        pool,
        userId,
        openingBackfillQueue: {
          enqueueOpeningBackfill: async (payload) => {
            queuedOpeningBackfills.push(payload.userId);
          },
        },
      });

      await processOpeningBackfillJob({
        pool,
        userId,
      });

      const positionsAfter = await pool.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total
         FROM game_positions
         WHERE user_id = $1`,
        [userId]
      );
      const openingsAfter = await pool.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total
         FROM opening_stats
         WHERE user_id = $1`,
        [userId]
      );
      const refreshedJobState = await pool.query<{
        position_index_status: string;
        opening_index_status: string;
      }>(
        `SELECT position_index_status, opening_index_status
         FROM import_jobs
         WHERE id = $1`,
        [importJobId]
      );

      expect(queuedOpeningBackfills).toEqual([userId]);
      expect(Number(positionsAfter.rows[0].total)).toBeGreaterThan(0);
      expect(Number(openingsAfter.rows[0].total)).toBeGreaterThan(0);
      expect(refreshedJobState.rows[0].position_index_status).toBe("indexed");
      expect(refreshedJobState.rows[0].opening_index_status).toBe("indexed");
    });
  }
);
