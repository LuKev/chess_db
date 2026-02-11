import type { Pool } from "pg";
import type { ObjectStorage } from "../infrastructure/storage.js";

type ProcessExportJobParams = {
  pool: Pool;
  storage: ObjectStorage;
  exportJobId: number;
  userId: number;
};

type FilterQuery = {
  player?: string;
  eco?: string;
  result?: string;
  timeControl?: string;
  fromDate?: string;
  toDate?: string;
};

function normalizeValue(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function toId(value: number | string): number {
  if (typeof value === "number") {
    return value;
  }
  return Number(value);
}

function buildWhereFromFilter(
  userId: number,
  query: FilterQuery
): { whereSql: string; params: unknown[] } {
  const whereClauses = ["g.user_id = $1"];
  const params: unknown[] = [userId];

  const addCondition = (clause: string, value: unknown): void => {
    params.push(value);
    whereClauses.push(clause.replace("?", `$${params.length}`));
  };

  if (query.player) {
    const normalized = `%${normalizeValue(query.player)}%`;
    params.push(normalized);
    const placeholder = `$${params.length}`;
    whereClauses.push(`(g.white_norm LIKE ${placeholder} OR g.black_norm LIKE ${placeholder})`);
  }
  if (query.eco) {
    addCondition("g.eco = ?", query.eco);
  }
  if (query.result) {
    addCondition("g.result = ?", query.result);
  }
  if (query.timeControl) {
    addCondition("g.time_control = ?", query.timeControl);
  }
  if (query.fromDate) {
    addCondition("g.played_on >= ?", query.fromDate);
  }
  if (query.toDate) {
    addCondition("g.played_on <= ?", query.toDate);
  }

  return {
    whereSql: whereClauses.join(" AND "),
    params,
  };
}

export async function processExportJob(
  params: ProcessExportJobParams
): Promise<void> {
  const row = await params.pool.query<{
    id: number | string;
    user_id: number | string;
    mode: "ids" | "query";
    game_ids: number[] | null;
    filter_query: FilterQuery | null;
  }>(
    `SELECT id, user_id, mode, game_ids, filter_query
     FROM export_jobs
     WHERE id = $1`,
    [params.exportJobId]
  );

  if (!row.rowCount) {
    throw new Error(`Export job ${params.exportJobId} not found`);
  }

  const job = row.rows[0];
  if (toId(job.user_id) !== params.userId) {
    throw new Error(`Export job user mismatch for ${params.exportJobId}`);
  }

  await params.pool.query(
    `UPDATE export_jobs
     SET status = 'running', updated_at = NOW()
     WHERE id = $1`,
    [params.exportJobId]
  );

  try {
    let pgnRows: Array<{ pgn_text: string }> = [];

    if (job.mode === "ids") {
      const ids = job.game_ids ?? [];
      if (ids.length > 0) {
        const result = await params.pool.query<{ pgn_text: string }>(
          `SELECT gp.pgn_text
           FROM games g
           JOIN game_pgn gp ON gp.game_id = g.id
           WHERE g.user_id = $1
             AND g.id = ANY($2::bigint[])
           ORDER BY g.id ASC`,
          [params.userId, ids]
        );
        pgnRows = result.rows;
      }
    } else {
      const filterQuery = (job.filter_query ?? {}) as FilterQuery;
      const { whereSql, params: whereParams } = buildWhereFromFilter(
        params.userId,
        filterQuery
      );
      const result = await params.pool.query<{ pgn_text: string }>(
        `SELECT gp.pgn_text
         FROM games g
         JOIN game_pgn gp ON gp.game_id = g.id
         WHERE ${whereSql}
         ORDER BY g.id ASC`,
        whereParams
      );
      pgnRows = result.rows;
    }

    const exportText = pgnRows.map((row) => row.pgn_text.trim()).join("\n\n");
    const outputObjectKey = `exports/user-${params.userId}/job-${params.exportJobId}.pgn`;

    await params.storage.putObject({
      key: outputObjectKey,
      body: exportText,
      contentType: "application/x-chess-pgn",
    });

    await params.pool.query(
      `UPDATE export_jobs
       SET status = 'completed',
           output_object_key = $2,
           exported_games = $3,
           updated_at = NOW()
       WHERE id = $1`,
      [params.exportJobId, outputObjectKey, pgnRows.length]
    );
  } catch (error) {
    await params.pool.query(
      `UPDATE export_jobs
       SET status = 'failed',
           error_message = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [params.exportJobId, String(error).slice(0, 1000)]
    );

    throw error;
  }
}
