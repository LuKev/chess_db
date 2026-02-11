import "dotenv/config";
import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { runMigrations } from "./migrations.js";

const config = loadConfig();
const pool = createPool(config);

try {
  await runMigrations(pool);
  console.log("Migrations completed successfully.");
} catch (error) {
  console.error("Migration failed.", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
