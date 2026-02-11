import { Pool } from "pg";
import type { AppConfig } from "./config.js";

export function createPool(config: AppConfig): Pool {
  return new Pool({
    connectionString: config.databaseUrl,
    max: config.nodeEnv === "production" ? 20 : 10,
  });
}

export async function resetDatabase(pool: Pool): Promise<void> {
  await pool.query(
    `TRUNCATE TABLE
      import_errors,
      password_reset_tokens,
      export_jobs,
      engine_requests,
      user_annotations,
      game_moves,
      game_pgn,
      games,
      import_jobs,
      saved_filters,
      sessions,
      users
    RESTART IDENTITY CASCADE`
  );
}
