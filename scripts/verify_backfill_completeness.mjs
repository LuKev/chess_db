#!/usr/bin/env node

import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
const activeWindowDays = Number(process.env.BACKFILL_ACTIVE_WINDOW_DAYS ?? "90");
const strictMode = (process.env.BACKFILL_VERIFY_STRICT ?? "false") === "true";

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}
if (!Number.isInteger(activeWindowDays) || activeWindowDays <= 0) {
  throw new Error("BACKFILL_ACTIVE_WINDOW_DAYS must be a positive integer");
}

async function run() {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const activeUsers = await pool.query<{ user_id: string }>(
      `SELECT DISTINCT g.user_id::text AS user_id
       FROM games g
       WHERE g.created_at >= NOW() - ($1::text || ' days')::interval`,
      [activeWindowDays]
    );

    const activeUserIds = activeUsers.rows.map((row) => Number(row.user_id));

    const missingPositionGames = await pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM games g
       WHERE g.user_id = ANY($1::bigint[])
         AND NOT EXISTS (
           SELECT 1
           FROM game_positions gp
           WHERE gp.user_id = g.user_id
             AND gp.game_id = g.id
         )`,
      [activeUserIds.length > 0 ? activeUserIds : [-1]]
    );

    const usersWithoutOpeningStats = await pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM (
         SELECT u.user_id
         FROM (
           SELECT DISTINCT g.user_id
           FROM games g
           WHERE g.user_id = ANY($1::bigint[])
         ) u
         LEFT JOIN LATERAL (
           SELECT COUNT(*) AS c
           FROM opening_stats os
           WHERE os.user_id = u.user_id
         ) os ON TRUE
         WHERE COALESCE(os.c, 0) = 0
       ) t`,
      [activeUserIds.length > 0 ? activeUserIds : [-1]]
    );

    const report = {
      check: "backfill-completeness",
      activeWindowDays,
      activeUsers: activeUserIds.length,
      missingPositionGames: Number(missingPositionGames.rows[0].total),
      usersWithoutOpeningStats: Number(usersWithoutOpeningStats.rows[0].total),
    };

    report.pass =
      report.missingPositionGames === 0 && report.usersWithoutOpeningStats === 0;
    report.strictMode = strictMode;

    console.log(JSON.stringify(report, null, 2));

    if (strictMode && !report.pass) {
      process.exit(1);
    }
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error(`[verify:backfill] ${String(error)}`);
  process.exit(1);
});
