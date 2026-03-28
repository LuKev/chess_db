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
      audit_events,
      queue_dead_letters,
      password_reset_tokens,
      export_jobs,
      user_index_status,
      opening_stats,
      game_positions,
      game_tags,
      tags,
      repertoire_entries,
      repertoires,
      collection_games,
      collections,
      auto_annotation_jobs,
      engine_lines,
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
