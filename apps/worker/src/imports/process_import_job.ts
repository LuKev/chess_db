import { parse } from "@mliebelt/pgn-parser";
import type { Pool } from "pg";
import type { PositionBackfillQueue } from "../infrastructure/queue.js";
import type { ObjectStorage } from "../infrastructure/storage.js";
import { iterateLinesFromStream, iteratePgnGames } from "./pgn_stream.js";
import { buildCanonicalPgnHash, normalizeParsedGame } from "./transform.js";
import {
  markImportJobIndexQueued,
  markImportJobIndexSkipped,
  markPendingImportJobsFailed,
  markUserIndexFailed,
  markUserIndexQueued,
} from "../backfill/status.js";

type ProcessImportJobParams = {
  pool: Pool;
  storage: ObjectStorage;
  positionBackfillQueue: PositionBackfillQueue;
  importJobId: number;
  userId: number;
};

type ImportCounters = {
  parsed: number;
  inserted: number;
  duplicates: number;
  duplicateByMoves: number;
  duplicateByCanonical: number;
  parseErrors: number;
};

function toId(value: number | string): number {
  if (typeof value === "number") {
    return value;
  }
  return Number(value);
}

async function updateJobStatus(
  pool: Pool,
  params: {
    importJobId: number;
    status: "queued" | "running" | "completed" | "failed" | "partial";
    counters: ImportCounters;
  }
): Promise<void> {
  await pool.query(
    `UPDATE import_jobs
     SET status = $2,
         total_games = $3,
         inserted_games = $4,
         duplicate_games = $5,
         duplicate_by_moves = $6,
         duplicate_by_canonical = $7,
         parse_errors = $8,
         updated_at = NOW()
     WHERE id = $1`,
    [
      params.importJobId,
      params.status,
      params.counters.parsed,
      params.counters.inserted,
      params.counters.duplicates,
      params.counters.duplicateByMoves,
      params.counters.duplicateByCanonical,
      params.counters.parseErrors,
    ]
  );
}

async function insertImportError(
  pool: Pool,
  params: {
    importJobId: number;
    gameOffset: number | null;
    message: string;
  }
): Promise<void> {
  await pool.query(
    `INSERT INTO import_errors (import_job_id, game_offset, error_message)
     VALUES ($1, $2, $3)`,
    [params.importJobId, params.gameOffset, params.message.slice(0, 1000)]
  );
}

async function insertGame(
  pool: Pool,
  params: {
    importJobId: number;
    userId: number;
    strictDuplicateMode: boolean;
    pgnText: string;
    parsedGame: ReturnType<typeof normalizeParsedGame>;
  }
): Promise<"inserted" | "duplicate_moves" | "duplicate_canonical"> {
  const client = await pool.connect();

  try {
    const canonicalPgnHash = buildCanonicalPgnHash(params.pgnText);
    await client.query("BEGIN");

    if (params.strictDuplicateMode) {
      const canonicalDuplicate = await client.query<{ id: number | string }>(
        `SELECT id
         FROM games
         WHERE user_id = $1
           AND canonical_pgn_hash = $2
         LIMIT 1`,
        [params.userId, canonicalPgnHash]
      );

      if (canonicalDuplicate.rowCount) {
        await client.query("ROLLBACK");
        return "duplicate_canonical";
      }
    }

    const gameInsert = await client.query<{ id: number | string }>(
      `INSERT INTO games (
        user_id,
        import_job_id,
        white,
        white_norm,
        black,
        black_norm,
        result,
        event,
        event_norm,
        site,
        eco,
        time_control,
        rated,
        white_elo,
        black_elo,
        played_on,
        ply_count,
        starting_fen,
        moves_hash,
        canonical_pgn_hash,
        source,
        license
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22
      )
      RETURNING id`,
      [
        params.userId,
        params.importJobId,
        params.parsedGame.white,
        params.parsedGame.whiteNorm,
        params.parsedGame.black,
        params.parsedGame.blackNorm,
        params.parsedGame.result,
        params.parsedGame.event,
        params.parsedGame.eventNorm,
        params.parsedGame.site,
        params.parsedGame.eco,
        params.parsedGame.timeControl,
        params.parsedGame.rated,
        params.parsedGame.whiteElo,
        params.parsedGame.blackElo,
        params.parsedGame.playedOn,
        params.parsedGame.plyCount,
        params.parsedGame.startingFen,
        params.parsedGame.movesHash,
        canonicalPgnHash,
        params.parsedGame.source,
        params.parsedGame.license,
      ]
    );

    const gameId = toId(gameInsert.rows[0].id);

    await client.query("INSERT INTO game_pgn (game_id, pgn_text) VALUES ($1, $2)", [
      gameId,
      params.pgnText,
    ]);
    await client.query(
      "INSERT INTO game_moves (game_id, move_tree) VALUES ($1, $2::jsonb)",
      [gameId, JSON.stringify(params.parsedGame.moveTree)]
    );

    await client.query("COMMIT");
    return "inserted";
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") {
      return "duplicate_moves";
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function processImportJob(
  params: ProcessImportJobParams
): Promise<void> {
  const counters: ImportCounters = {
    parsed: 0,
    inserted: 0,
    duplicates: 0,
    duplicateByMoves: 0,
    duplicateByCanonical: 0,
    parseErrors: 0,
  };

  await updateJobStatus(params.pool, {
    importJobId: params.importJobId,
    status: "running",
    counters,
  });

  const jobResult = await params.pool.query<{
    id: number;
    source_object_key: string | null;
    user_id: number | string;
    strict_duplicate_mode: boolean;
    max_games: number | null;
  }>(
    `SELECT id, source_object_key, user_id, strict_duplicate_mode, max_games
     FROM import_jobs
     WHERE id = $1`,
    [params.importJobId]
  );

  if (!jobResult.rowCount) {
    throw new Error(`Import job not found: ${params.importJobId}`);
  }

  const job = jobResult.rows[0];
  if (toId(job.user_id) !== params.userId) {
    throw new Error(`Import job user mismatch for id ${params.importJobId}`);
  }
  if (!job.source_object_key) {
    throw new Error(`Import job ${params.importJobId} has no source object key`);
  }

  const sourceStream = await params.storage.getObjectStream(job.source_object_key);
  const isZstd = job.source_object_key.toLowerCase().endsWith(".zst");

  try {
    const lines = iterateLinesFromStream(sourceStream, isZstd);
    const games = iteratePgnGames(lines);

    for await (const game of games) {
      counters.parsed += 1;

      try {
        const parsed = parse(game.pgnText, { startRule: "game" }) as {
          tags?: Record<string, string>;
          moves?: unknown[];
        };
        const normalized = normalizeParsedGame(parsed);

        const inserted = await insertGame(params.pool, {
          importJobId: params.importJobId,
          userId: params.userId,
          strictDuplicateMode: job.strict_duplicate_mode,
          parsedGame: normalized,
          pgnText: game.pgnText,
        });

        if (inserted === "inserted") {
          counters.inserted += 1;
        } else {
          counters.duplicates += 1;
          if (inserted === "duplicate_moves") {
            counters.duplicateByMoves += 1;
          } else {
            counters.duplicateByCanonical += 1;
          }
        }
      } catch (error) {
        counters.parseErrors += 1;
        await insertImportError(params.pool, {
          importJobId: params.importJobId,
          gameOffset: game.gameOffset,
          message: String(error),
        });
      }

      if (counters.parsed % 100 === 0) {
        await updateJobStatus(params.pool, {
          importJobId: params.importJobId,
          status: "running",
          counters,
        });
      }

      // Import jobs may optionally set a max game count (used for starter seeds).
      if (job.max_games && counters.parsed >= job.max_games) {
        break;
      }
    }

    const finalStatus =
      counters.parseErrors > 0 && counters.inserted > 0
        ? "partial"
        : counters.parseErrors > 0 && counters.inserted === 0
          ? "failed"
          : "completed";

    await updateJobStatus(params.pool, {
      importJobId: params.importJobId,
      status: finalStatus,
      counters,
    });

    if (counters.inserted > 0) {
      try {
        await markImportJobIndexQueued(params.pool, {
          importJobId: params.importJobId,
          kinds: ["position", "opening"],
        });
        await markUserIndexQueued(params.pool, {
          userId: params.userId,
          kinds: ["position", "opening"],
        });
        await params.positionBackfillQueue.enqueuePositionBackfill({
          userId: params.userId,
        });
      } catch (error) {
        const message = String(error);
        await markPendingImportJobsFailed(params.pool, {
          userId: params.userId,
          kind: "position",
          error: message,
        });
        await markPendingImportJobsFailed(params.pool, {
          userId: params.userId,
          kind: "opening",
          error: message,
        });
        await markUserIndexFailed(params.pool, {
          userId: params.userId,
          kind: "position",
          error: message,
        });
        await markUserIndexFailed(params.pool, {
          userId: params.userId,
          kind: "opening",
          error: message,
        });
        throw error;
      }
    } else {
      await markImportJobIndexSkipped(params.pool, {
        importJobId: params.importJobId,
        kinds: ["position", "opening"],
      });
    }
  } catch (fatalError) {
    counters.parseErrors += 1;

    await insertImportError(params.pool, {
      importJobId: params.importJobId,
      gameOffset: null,
      message: `Fatal import error: ${String(fatalError)}`,
    });

    await updateJobStatus(params.pool, {
      importJobId: params.importJobId,
      status: "failed",
      counters,
    });

    throw fatalError;
  }
}
