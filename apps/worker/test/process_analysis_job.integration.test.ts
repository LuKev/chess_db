import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { runMigrations } from "../../api/src/migrations.js";
import { resetDatabase } from "../../api/src/db.js";
import { processAnalysisJob } from "../src/analysis/process_analysis_job.js";

const databaseUrl = process.env.DATABASE_URL;
const stockfishBinary = process.env.STOCKFISH_BINARY ?? "stockfish";
const hasStockfish = spawnSync("which", [stockfishBinary]).status === 0;

(databaseUrl && hasStockfish ? describe.sequential : describe.skip)(
  "processAnalysisJob",
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

  it("completes analysis with stockfish output", async () => {
    const user = await pool.query<{ id: number }>(
      `INSERT INTO users (email, password_hash)
       VALUES ('analysis@example.com', 'hash')
       RETURNING id`
    );
    const userId = Number(user.rows[0].id);

    const request = await pool.query<{ id: number }>(
      `INSERT INTO engine_requests (user_id, status, fen, depth)
       VALUES ($1, 'queued', $2, 8)
       RETURNING id`,
      [userId, "rn1qkbnr/pppb1ppp/3p4/4p3/3PP3/2N2N2/PPP2PPP/R1BQKB1R w KQkq - 0 5"]
    );

    const analysisRequestId = Number(request.rows[0].id);

    await processAnalysisJob({
      pool,
      analysisRequestId,
      userId,
      stockfishBinary,
      cancelPollMs: 250,
    });

    const result = await pool.query<{
      status: string;
      best_move: string | null;
      principal_variation: string | null;
      eval_cp: number | null;
      error_message: string | null;
    }>(
      `SELECT status, best_move, principal_variation, eval_cp, error_message
       FROM engine_requests
       WHERE id = $1`,
      [analysisRequestId]
    );

    expect(result.rows[0].status).toBe("completed");
    expect(result.rows[0].best_move).toBeTruthy();
    expect(result.rows[0].principal_variation).toBeTruthy();
    expect(result.rows[0].error_message).toBeNull();
  });

  it("cancels queued analysis requests", async () => {
    const user = await pool.query<{ id: number }>(
      `INSERT INTO users (email, password_hash)
       VALUES ('analysis-cancel@example.com', 'hash')
       RETURNING id`
    );
    const userId = Number(user.rows[0].id);

    const request = await pool.query<{ id: number }>(
      `INSERT INTO engine_requests (user_id, status, fen, depth, cancel_requested)
       VALUES ($1, 'queued', $2, 10, TRUE)
       RETURNING id`,
      [userId, "startpos"]
    );
    const analysisRequestId = Number(request.rows[0].id);

    await processAnalysisJob({
      pool,
      analysisRequestId,
      userId,
      stockfishBinary,
      cancelPollMs: 250,
    });

    const result = await pool.query<{ status: string }>(
      "SELECT status FROM engine_requests WHERE id = $1",
      [analysisRequestId]
    );

    expect(result.rows[0].status).toBe("cancelled");
  });
  }
);
