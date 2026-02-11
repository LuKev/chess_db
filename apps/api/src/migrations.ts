import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

function resolveMigrationsDir(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), "apps/api/migrations"),
    path.resolve(process.cwd(), "migrations"),
    path.resolve(moduleDir, "../migrations"),
  ];

  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      `Could not locate migrations directory. Checked: ${candidates.join(", ")}`
    );
  }

  return found;
}

export async function runMigrations(pool: Pool): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  );

  const migrationsDir = resolveMigrationsDir();
  const migrationFiles = (await readdir(migrationsDir))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();

  for (const filename of migrationFiles) {
    const id = filename;
    const alreadyApplied = await pool.query<{ id: string }>(
      "SELECT id FROM schema_migrations WHERE id = $1",
      [id]
    );

    if (alreadyApplied.rowCount && alreadyApplied.rowCount > 0) {
      continue;
    }

    const sql = await readFile(path.join(migrationsDir, filename), "utf8");
    await pool.query("BEGIN");
    try {
      await pool.query(sql);
      await pool.query("INSERT INTO schema_migrations (id) VALUES ($1)", [id]);
      await pool.query("COMMIT");
    } catch (error) {
      await pool.query("ROLLBACK");
      throw new Error(`Migration failed (${filename}): ${String(error)}`);
    }
  }
}
