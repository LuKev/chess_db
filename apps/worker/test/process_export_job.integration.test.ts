import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { runMigrations } from "../../api/src/migrations.js";
import { resetDatabase } from "../../api/src/db.js";
import { processExportJob } from "../src/exports/process_export_job.js";

const databaseUrl = process.env.DATABASE_URL;

(databaseUrl ? describe.sequential : describe.skip)("processExportJob", () => {
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

  it("exports selected game IDs to object storage", async () => {
    const user = await pool.query<{ id: number }>(
      `INSERT INTO users (email, password_hash)
       VALUES ('export-worker@example.com', 'hash')
       RETURNING id`
    );
    const userId = Number(user.rows[0].id);

    const game1 = await pool.query<{ id: number }>(
      `INSERT INTO games (user_id, white, white_norm, black, black_norm, result, moves_hash)
       VALUES ($1, 'Alpha', 'alpha', 'Beta', 'beta', '1-0', 'hash-1')
       RETURNING id`,
      [userId]
    );
    const game2 = await pool.query<{ id: number }>(
      `INSERT INTO games (user_id, white, white_norm, black, black_norm, result, eco, moves_hash)
       VALUES ($1, 'Gamma', 'gamma', 'Delta', 'delta', '0-1', 'B44', 'hash-2')
       RETURNING id`,
      [userId]
    );

    await pool.query(
      `INSERT INTO game_pgn (game_id, pgn_text)
       VALUES ($1, '[Event "A"]\n\n1. e4 e5 1-0'), ($2, '[Event "B"]\n\n1. d4 d5 0-1')`,
      [Number(game1.rows[0].id), Number(game2.rows[0].id)]
    );

    const exportJob = await pool.query<{ id: number }>(
      `INSERT INTO export_jobs (user_id, status, mode, game_ids)
       VALUES ($1, 'queued', 'ids', $2::bigint[])
       RETURNING id`,
      [userId, [Number(game2.rows[0].id)]]
    );
    const exportJobId = Number(exportJob.rows[0].id);

    let uploaded = "";
    await processExportJob({
      pool,
      exportJobId,
      userId,
      storage: {
        ensureBucket: async () => {},
        getObjectStream: async () => {
          throw new Error("not used");
        },
        putObject: async ({ body }) => {
          uploaded = String(body);
        },
        close: async () => {},
      },
    });

    expect(uploaded).toContain("[Event \"B\"]");
    expect(uploaded).not.toContain("[Event \"A\"]");

    const job = await pool.query<{ status: string; exported_games: number }>(
      "SELECT status, exported_games FROM export_jobs WHERE id = $1",
      [exportJobId]
    );

    expect(job.rows[0].status).toBe("completed");
    expect(job.rows[0].exported_games).toBe(1);
  });

  it("includes user annotations when export toggle is enabled", async () => {
    const user = await pool.query<{ id: number }>(
      `INSERT INTO users (email, password_hash)
       VALUES ('export-worker-annotations@example.com', 'hash')
       RETURNING id`
    );
    const userId = Number(user.rows[0].id);

    const game = await pool.query<{ id: number }>(
      `INSERT INTO games (user_id, white, white_norm, black, black_norm, result, moves_hash)
       VALUES ($1, 'Alpha', 'alpha', 'Beta', 'beta', '1-0', 'hash-annotations')
       RETURNING id`,
      [userId]
    );
    const gameId = Number(game.rows[0].id);

    await pool.query(
      `INSERT INTO game_pgn (game_id, pgn_text)
       VALUES ($1, '[Event "Annotated"]\n\n1. e4 e5 1-0')`,
      [gameId]
    );
    await pool.query(
      `INSERT INTO user_annotations (user_id, game_id, annotations)
       VALUES ($1, $2, $3::jsonb)`,
      [userId, gameId, JSON.stringify({ comment: "Critical idea", arrows: ["e2e4"] })]
    );

    const exportJob = await pool.query<{ id: number }>(
      `INSERT INTO export_jobs (user_id, status, mode, game_ids, include_annotations)
       VALUES ($1, 'queued', 'ids', $2::bigint[], TRUE)
       RETURNING id`,
      [userId, [gameId]]
    );
    const exportJobId = Number(exportJob.rows[0].id);

    let uploaded = "";
    await processExportJob({
      pool,
      exportJobId,
      userId,
      storage: {
        ensureBucket: async () => {},
        getObjectStream: async () => {
          throw new Error("not used");
        },
        putObject: async ({ body }) => {
          uploaded = String(body);
        },
        close: async () => {},
      },
    });

    expect(uploaded).toContain("[Event \"Annotated\"]");
    expect(uploaded).toContain("; ChessDBAnnotations");
    expect(uploaded).toContain("Critical idea");
  });
});
