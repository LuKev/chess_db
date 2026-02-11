import { Pool } from "pg";
import type { WorkerConfig } from "./config.js";

export function createPool(config: WorkerConfig): Pool {
  return new Pool({
    connectionString: config.databaseUrl,
    max: 10,
  });
}
