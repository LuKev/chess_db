import type { Pool } from "pg";
import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth.js";
import type {
  OpeningBackfillQueue,
  PositionBackfillQueue,
} from "../infrastructure/queue.js";

function summarizeIndexStatus(
  rawStatus: string
): "not_indexed" | "indexing" | "indexed" | "failed" {
  if (rawStatus === "queued" || rawStatus === "running") {
    return "indexing";
  }
  if (rawStatus === "indexed") {
    return "indexed";
  }
  if (rawStatus === "failed") {
    return "failed";
  }
  return "not_indexed";
}

async function markQueuedIndexStatus(
  pool: Pool,
  params: {
    userId: number;
    kinds: Array<"position" | "opening">;
    includeImportJobs: boolean;
  }
): Promise<void> {
  await pool.query(
    `INSERT INTO user_index_status (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [params.userId]
  );

  for (const kind of params.kinds) {
    const columns =
      kind === "position"
        ? {
            status: "position_status",
            requestedAt: "position_last_requested_at",
            error: "position_last_error",
            importStatus: "position_index_status",
            importRequestedAt: "position_index_requested_at",
            importError: "position_index_error",
          }
        : {
            status: "opening_status",
            requestedAt: "opening_last_requested_at",
            error: "opening_last_error",
            importStatus: "opening_index_status",
            importRequestedAt: "opening_index_requested_at",
            importError: "opening_index_error",
          };

    await pool.query(
      `UPDATE user_index_status
       SET ${columns.status} = 'queued',
           ${columns.requestedAt} = NOW(),
           ${columns.error} = NULL,
           updated_at = NOW()
       WHERE user_id = $1`,
      [params.userId]
    );

    if (params.includeImportJobs) {
      await pool.query(
        `UPDATE import_jobs
         SET ${columns.importStatus} = 'queued',
             ${columns.importRequestedAt} = NOW(),
             ${columns.importError} = NULL,
             updated_at = NOW()
         WHERE user_id = $1
           AND status IN ('completed', 'partial')
           AND inserted_games > 0
           AND ${columns.importStatus} IN ('not_indexed', 'queued', 'running', 'failed')`,
        [params.userId]
      );
    }
  }
}

export async function registerBackfillRoutes(
  app: FastifyInstance,
  pool: Pool,
  positionBackfillQueue: PositionBackfillQueue,
  openingBackfillQueue: OpeningBackfillQueue
): Promise<void> {
  app.get(
    "/api/backfill/status",
    { preHandler: requireUser },
    async (request, reply) => {
      const [gamesCount, missingPositionCount, openingRows, stored] = await Promise.all([
        pool.query<{ total: string }>(
          `SELECT COUNT(*)::text AS total
           FROM games
           WHERE user_id = $1`,
          [request.user!.id]
        ),
        pool.query<{ total: string }>(
          `SELECT COUNT(*)::text AS total
           FROM games g
           WHERE g.user_id = $1
             AND NOT EXISTS (
               SELECT 1
               FROM game_positions gp
               WHERE gp.user_id = g.user_id
                 AND gp.game_id = g.id
                 AND gp.ply = 0
             )`,
          [request.user!.id]
        ),
        pool.query<{ total: string }>(
          `SELECT COUNT(*)::text AS total
           FROM opening_stats
           WHERE user_id = $1`,
          [request.user!.id]
        ),
        pool.query<{
          position_status: string;
          position_last_requested_at: Date | null;
          position_last_completed_at: Date | null;
          position_last_error: string | null;
          position_indexed_games: number;
          opening_status: string;
          opening_last_requested_at: Date | null;
          opening_last_completed_at: Date | null;
          opening_last_error: string | null;
          opening_indexed_games: number;
        }>(
          `SELECT
            position_status,
            position_last_requested_at,
            position_last_completed_at,
            position_last_error,
            position_indexed_games,
            opening_status,
            opening_last_requested_at,
            opening_last_completed_at,
            opening_last_error,
            opening_indexed_games
          FROM user_index_status
          WHERE user_id = $1`,
          [request.user!.id]
        ),
      ]);

      const totalGames = Number(gamesCount.rows[0]?.total ?? "0");
      const pendingPositionGames = Number(missingPositionCount.rows[0]?.total ?? "0");
      const openingRowCount = Number(openingRows.rows[0]?.total ?? "0");
      const row = stored.rows[0];

      const fallbackPositionRaw =
        totalGames > 0 && pendingPositionGames === 0 ? "indexed" : "not_indexed";
      const fallbackOpeningRaw =
        totalGames > 0 && pendingPositionGames === 0 && openingRowCount > 0
          ? "indexed"
          : "not_indexed";

      const positionRaw = row?.position_status ?? fallbackPositionRaw;
      const openingRaw = row?.opening_status ?? fallbackOpeningRaw;
      const positionIndexedGames =
        row?.position_indexed_games ?? Math.max(totalGames - pendingPositionGames, 0);
      const openingIndexedGames =
        row?.opening_indexed_games ?? (fallbackOpeningRaw === "indexed" ? totalGames : 0);

      return reply.send({
        totalGames,
        position: {
          rawStatus: positionRaw,
          status: summarizeIndexStatus(positionRaw),
          pendingGames: pendingPositionGames,
          indexedGames: positionIndexedGames,
          stale: totalGames > 0 && (positionRaw !== "indexed" || pendingPositionGames > 0),
          lastRequestedAt: row?.position_last_requested_at?.toISOString() ?? null,
          lastCompletedAt: row?.position_last_completed_at?.toISOString() ?? null,
          lastError: row?.position_last_error ?? null,
        },
        opening: {
          rawStatus: openingRaw,
          status: summarizeIndexStatus(openingRaw),
          pendingGames:
            openingRaw === "indexed" ? 0 : Math.max(totalGames - openingIndexedGames, 0),
          indexedGames: openingIndexedGames,
          stale: totalGames > 0 && openingRaw !== "indexed",
          lastRequestedAt: row?.opening_last_requested_at?.toISOString() ?? null,
          lastCompletedAt: row?.opening_last_completed_at?.toISOString() ?? null,
          lastError: row?.opening_last_error ?? null,
        },
      });
    }
  );

  app.post(
    "/api/backfill/positions",
    { preHandler: requireUser },
    async (request, reply) => {
      try {
        await markQueuedIndexStatus(pool, {
          userId: request.user!.id,
          kinds: ["position", "opening"],
          includeImportJobs: true,
        });
        await positionBackfillQueue.enqueuePositionBackfill({
          userId: request.user!.id,
        });
        return reply.status(202).send({
          status: "queued",
          queue: "position_backfill",
        });
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: "Failed to enqueue position backfill" });
      }
    }
  );

  app.post(
    "/api/backfill/openings",
    { preHandler: requireUser },
    async (request, reply) => {
      try {
        await markQueuedIndexStatus(pool, {
          userId: request.user!.id,
          kinds: ["opening"],
          includeImportJobs: true,
        });
        await openingBackfillQueue.enqueueOpeningBackfill({
          userId: request.user!.id,
        });
        return reply.status(202).send({
          status: "queued",
          queue: "opening_aggregate_backfill",
        });
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: "Failed to enqueue opening backfill" });
      }
    }
  );
}
