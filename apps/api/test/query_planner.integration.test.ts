import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { loadConfig } from "../src/config.js";
import { createPool, resetDatabase } from "../src/db.js";
import { runMigrations } from "../src/migrations.js";

const databaseUrl = process.env.DATABASE_URL;

type ExplainRow = {
  "QUERY PLAN": string;
};

async function explain(pool: Pool, sql: string, params: unknown[]): Promise<string> {
  const query = `EXPLAIN ${sql}`;
  const result = await pool.query<ExplainRow>(query, params);
  return result.rows.map((row) => row["QUERY PLAN"]).join("\n");
}

(databaseUrl ? describe.sequential : describe.skip)("query planner index regressions", () => {
  let pool: Pool;

  beforeAll(async () => {
    const config = loadConfig({
      NODE_ENV: "test",
      PORT: "4000",
      HOST: "127.0.0.1",
      CORS_ORIGIN: "http://localhost:3000",
      DATABASE_URL: databaseUrl!,
      SESSION_SECRET: "test-session-secret-12345",
      SESSION_COOKIE_NAME: "chessdb_session",
      SESSION_TTL_HOURS: "24",
      REDIS_URL: "redis://127.0.0.1:6379",
      S3_ENDPOINT: "http://127.0.0.1:9000",
      S3_REGION: "us-east-1",
      S3_ACCESS_KEY: "minio",
      S3_SECRET_KEY: "miniostorage",
      S3_BUCKET: "chessdb-test",
      S3_FORCE_PATH_STYLE: "true",
      UPLOAD_MAX_BYTES: "1000000",
      AUTO_MIGRATE: "false",
      AUTH_RATE_LIMIT_ENABLED: "false",
    });

    pool = createPool(config);
    await runMigrations(pool);
  });

  beforeEach(async () => {
    await resetDatabase(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("uses an index-backed plan for eco filter query", async () => {
    const user = await pool.query<{ id: number | string }>(
      `INSERT INTO users (email, password_hash)
       VALUES ('planner-eco@example.com', 'hash')
       RETURNING id`
    );
    const userId = Number(user.rows[0].id);

    await pool.query(
      `INSERT INTO games (
        user_id,
        white,
        white_norm,
        black,
        black_norm,
        result,
        eco,
        moves_hash,
        played_on
      ) VALUES
      ($1, 'A', 'a', 'B', 'b', '1-0', 'B90', 'hash-1', '2026-01-01'),
      ($1, 'C', 'c', 'D', 'd', '0-1', 'C42', 'hash-2', '2026-01-02')`,
      [userId]
    );

    const plan = await explain(
      pool,
      `SELECT id
       FROM games
       WHERE user_id = $1
         AND eco = $2
       LIMIT 20`,
      [userId, "B90"]
    );

    expect(plan).toContain("Index Scan");
    expect(plan).not.toContain("Seq Scan");
  });

  it("uses game_positions_user_fen_idx for position lookup", async () => {
    const user = await pool.query<{ id: number | string }>(
      `INSERT INTO users (email, password_hash)
       VALUES ('planner-pos@example.com', 'hash')
       RETURNING id`
    );
    const userId = Number(user.rows[0].id);

    const game = await pool.query<{ id: number | string }>(
      `INSERT INTO games (
        user_id,
        white,
        white_norm,
        black,
        black_norm,
        result,
        moves_hash
      ) VALUES ($1, 'A', 'a', 'B', 'b', '1-0', 'planner-pos-hash')
      RETURNING id`,
      [userId]
    );
    const gameId = Number(game.rows[0].id);

    await pool.query(
      `INSERT INTO game_positions (
        user_id,
        game_id,
        ply,
        fen_norm,
        stm,
        castling,
        ep_square,
        halfmove,
        fullmove,
        material_key
      ) VALUES ($1, $2, 0, $3, 'w', 'KQkq', NULL, 0, 1, 'material')`,
      [userId, gameId, "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w kqkq - 0 1"]
    );

    const plan = await explain(
      pool,
      `SELECT game_id
       FROM game_positions
       WHERE user_id = $1
         AND fen_norm = $2
       LIMIT 10`,
      [userId, "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w kqkq - 0 1"]
    );

    expect(plan).toContain("game_positions_user_fen_idx");
  });

  it("uses opening_stats_user_position_idx for opening tree lookup", async () => {
    const user = await pool.query<{ id: number | string }>(
      `INSERT INTO users (email, password_hash)
       VALUES ('planner-openings@example.com', 'hash')
       RETURNING id`
    );
    const userId = Number(user.rows[0].id);

    await pool.query(
      `INSERT INTO opening_stats (
        user_id,
        position_fen_norm,
        move_uci,
        games,
        white_wins,
        black_wins,
        draws
      ) VALUES ($1, $2, 'e2e4', 1, 1, 0, 0)`,
      [userId, "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w kqkq - 0 1"]
    );

    const plan = await explain(
      pool,
      `SELECT move_uci
       FROM opening_stats
       WHERE user_id = $1
         AND position_fen_norm = $2`,
      [userId, "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w kqkq - 0 1"]
    );

    expect(plan).toContain("opening_stats_user_position_idx");
  });
});
