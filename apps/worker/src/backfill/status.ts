import type { Pool, PoolClient } from "pg";

export type IndexKind = "position" | "opening";

type SqlExecutor = Pool | PoolClient;

function statusColumns(kind: IndexKind) {
  if (kind === "position") {
    return {
      status: "position_status",
      requestedAt: "position_last_requested_at",
      completedAt: "position_last_completed_at",
      error: "position_last_error",
      indexedGames: "position_indexed_games",
      importStatus: "position_index_status",
      importRequestedAt: "position_index_requested_at",
      importCompletedAt: "position_index_completed_at",
      importError: "position_index_error",
    } as const;
  }

  return {
    status: "opening_status",
    requestedAt: "opening_last_requested_at",
    completedAt: "opening_last_completed_at",
    error: "opening_last_error",
    indexedGames: "opening_indexed_games",
    importStatus: "opening_index_status",
    importRequestedAt: "opening_index_requested_at",
    importCompletedAt: "opening_index_completed_at",
    importError: "opening_index_error",
  } as const;
}

export async function ensureUserIndexStatus(
  executor: SqlExecutor,
  userId: number
): Promise<void> {
  await executor.query(
    `INSERT INTO user_index_status (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
}

export async function markUserIndexQueued(
  executor: SqlExecutor,
  params: { userId: number; kinds: IndexKind[] }
): Promise<void> {
  await ensureUserIndexStatus(executor, params.userId);
  for (const kind of params.kinds) {
    const columns = statusColumns(kind);
    await executor.query(
      `UPDATE user_index_status
       SET ${columns.status} = 'queued',
           ${columns.requestedAt} = NOW(),
           ${columns.error} = NULL,
           updated_at = NOW()
       WHERE user_id = $1`,
      [params.userId]
    );
  }
}

export async function markUserIndexRunning(
  executor: SqlExecutor,
  params: { userId: number; kind: IndexKind }
): Promise<void> {
  await ensureUserIndexStatus(executor, params.userId);
  const columns = statusColumns(params.kind);
  await executor.query(
    `UPDATE user_index_status
     SET ${columns.status} = 'running',
         ${columns.requestedAt} = COALESCE(${columns.requestedAt}, NOW()),
         ${columns.error} = NULL,
         updated_at = NOW()
     WHERE user_id = $1`,
    [params.userId]
  );
}

export async function markUserIndexCompleted(
  executor: SqlExecutor,
  params: { userId: number; kind: IndexKind; indexedGames: number }
): Promise<void> {
  await ensureUserIndexStatus(executor, params.userId);
  const columns = statusColumns(params.kind);
  await executor.query(
    `UPDATE user_index_status
     SET ${columns.status} = 'indexed',
         ${columns.completedAt} = NOW(),
         ${columns.error} = NULL,
         ${columns.indexedGames} = $2,
         updated_at = NOW()
     WHERE user_id = $1`,
    [params.userId, params.indexedGames]
  );
}

export async function markUserIndexFailed(
  executor: SqlExecutor,
  params: { userId: number; kind: IndexKind; error: string }
): Promise<void> {
  await ensureUserIndexStatus(executor, params.userId);
  const columns = statusColumns(params.kind);
  await executor.query(
    `UPDATE user_index_status
     SET ${columns.status} = 'failed',
         ${columns.error} = $2,
         updated_at = NOW()
     WHERE user_id = $1`,
    [params.userId, params.error.slice(0, 2000)]
  );
}

export async function markImportJobIndexQueued(
  executor: SqlExecutor,
  params: { importJobId: number; kinds: IndexKind[] }
): Promise<void> {
  for (const kind of params.kinds) {
    const columns = statusColumns(kind);
    await executor.query(
      `UPDATE import_jobs
       SET ${columns.importStatus} = 'queued',
           ${columns.importRequestedAt} = NOW(),
           ${columns.importError} = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [params.importJobId]
    );
  }
}

export async function markImportJobIndexSkipped(
  executor: SqlExecutor,
  params: { importJobId: number; kinds: IndexKind[] }
): Promise<void> {
  for (const kind of params.kinds) {
    const columns = statusColumns(kind);
    await executor.query(
      `UPDATE import_jobs
       SET ${columns.importStatus} = 'skipped',
           ${columns.importCompletedAt} = NOW(),
           ${columns.importError} = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [params.importJobId]
    );
  }
}

export async function markPendingImportJobsRunning(
  executor: SqlExecutor,
  params: { userId: number; kind: IndexKind }
): Promise<void> {
  const columns = statusColumns(params.kind);
  await executor.query(
    `UPDATE import_jobs
     SET ${columns.importStatus} = 'running',
         ${columns.importRequestedAt} = COALESCE(${columns.importRequestedAt}, NOW()),
         ${columns.importError} = NULL,
         updated_at = NOW()
     WHERE user_id = $1
       AND status IN ('completed', 'partial')
       AND inserted_games > 0
       AND ${columns.importStatus} IN ('queued', 'running', 'failed', 'not_indexed')`,
    [params.userId]
  );
}

export async function markPendingImportJobsCompleted(
  executor: SqlExecutor,
  params: { userId: number; kind: IndexKind }
): Promise<void> {
  const columns = statusColumns(params.kind);
  await executor.query(
    `UPDATE import_jobs
     SET ${columns.importStatus} = 'indexed',
         ${columns.importCompletedAt} = NOW(),
         ${columns.importError} = NULL,
         updated_at = NOW()
     WHERE user_id = $1
       AND status IN ('completed', 'partial')
       AND inserted_games > 0
       AND ${columns.importStatus} IN ('queued', 'running', 'failed', 'not_indexed')`,
    [params.userId]
  );
}

export async function markPendingImportJobsFailed(
  executor: SqlExecutor,
  params: { userId: number; kind: IndexKind; error: string }
): Promise<void> {
  const columns = statusColumns(params.kind);
  await executor.query(
    `UPDATE import_jobs
     SET ${columns.importStatus} = 'failed',
         ${columns.importError} = $2,
         updated_at = NOW()
     WHERE user_id = $1
       AND status IN ('completed', 'partial')
       AND inserted_games > 0
       AND ${columns.importStatus} IN ('queued', 'running')`,
    [params.userId, params.error.slice(0, 2000)]
  );
}
