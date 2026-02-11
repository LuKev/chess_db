import { Readable } from "node:stream";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { runMigrations } from "../../api/src/migrations.js";
import { resetDatabase } from "../../api/src/db.js";
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

    it("updates counters for inserted, duplicate and parse errors", async () => {
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
      });

      const jobState = await pool.query<{
        status: string;
        total_games: number;
        inserted_games: number;
        duplicate_games: number;
        parse_errors: number;
      }>(
        `SELECT status, total_games, inserted_games, duplicate_games, parse_errors
         FROM import_jobs
         WHERE id = $1`,
        [importJobId]
      );

      expect(jobState.rows[0].status).toBe("partial");
      expect(jobState.rows[0].total_games).toBe(3);
      expect(jobState.rows[0].inserted_games).toBe(1);
      expect(jobState.rows[0].duplicate_games).toBe(1);
      expect(jobState.rows[0].parse_errors).toBe(1);
    });
  }
);
