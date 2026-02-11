import { parse } from "@mliebelt/pgn-parser";
import type { Pool } from "pg";
import type { ObjectStorage } from "../infrastructure/storage.js";
import { iterateLinesFromStream, iteratePgnGames } from "./pgn_stream.js";
import { normalizeParsedGame } from "./transform.js";

type ProcessImportJobParams = {
  pool: Pool;
  storage: ObjectStorage;
  importJobId: number;
  userId: number;
};

type ImportCounters = {
  parsed: number;
  inserted: number;
  duplicates: number;
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
         parse_errors = $6,
         updated_at = NOW()
     WHERE id = $1`,
    [
      params.importJobId,
      params.status,
      params.counters.parsed,
      params.counters.inserted,
      params.counters.duplicates,
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
    pgnText: string;
    parsedGame: ReturnType<typeof normalizeParsedGame>;
  }
): Promise<boolean> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const gameInsert = await client.query<{ id: number }>(
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
        played_on,
        ply_count,
        starting_fen,
        moves_hash,
        source,
        license
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
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
        params.parsedGame.playedOn,
        params.parsedGame.plyCount,
        params.parsedGame.startingFen,
        params.parsedGame.movesHash,
        params.parsedGame.source,
        params.parsedGame.license,
      ]
    );

    const gameId = gameInsert.rows[0].id;

    await client.query("INSERT INTO game_pgn (game_id, pgn_text) VALUES ($1, $2)", [
      gameId,
      params.pgnText,
    ]);
    await client.query(
      "INSERT INTO game_moves (game_id, move_tree) VALUES ($1, $2::jsonb)",
      [gameId, JSON.stringify(params.parsedGame.moveTree)]
    );

    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") {
      return false;
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
  }>(
    `SELECT id, source_object_key, user_id
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
          parsedGame: normalized,
          pgnText: game.pgnText,
        });

        if (inserted) {
          counters.inserted += 1;
        } else {
          counters.duplicates += 1;
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
