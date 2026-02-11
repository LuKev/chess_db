import { createHash } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Pool, PoolClient } from "pg";
import { requireUser } from "../auth.js";
import { buildPositionIndex } from "../chess/index_positions.js";
import { extractMainlineSans } from "../chess/move_tree.js";

const CreateGameSchema = z.object({
  white: z.string().trim().min(1),
  black: z.string().trim().min(1),
  result: z.string().trim().max(16).default("*"),
  event: z.string().trim().max(255).optional(),
  site: z.string().trim().max(255).optional(),
  eco: z.string().trim().max(16).optional(),
  timeControl: z.string().trim().max(32).optional(),
  date: z.string().date().optional(),
  rated: z.boolean().optional(),
  whiteElo: z.number().int().min(1).max(4000).optional(),
  blackElo: z.number().int().min(1).max(4000).optional(),
  plyCount: z.number().int().nonnegative().optional(),
  startingFen: z.string().trim().max(2048).optional(),
  movesHash: z.string().trim().max(128),
  source: z.string().trim().max(128).optional(),
  license: z.string().trim().max(128).optional(),
  pgn: z.string().min(1),
  moveTree: z.record(z.string(), z.unknown()).default({}),
});

const ListGamesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(50),
  sort: z
    .enum(["date_desc", "date_asc", "white", "black", "eco"])
    .default("date_desc"),
  player: z.string().trim().optional(),
  eco: z.string().trim().optional(),
  openingPrefix: z.string().trim().optional(),
  result: z.string().trim().optional(),
  timeControl: z.string().trim().optional(),
  event: z.string().trim().optional(),
  site: z.string().trim().optional(),
  rated: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  fromDate: z.string().date().optional(),
  toDate: z.string().date().optional(),
  whiteEloMin: z.coerce.number().int().min(1).max(4000).optional(),
  whiteEloMax: z.coerce.number().int().min(1).max(4000).optional(),
  blackEloMin: z.coerce.number().int().min(1).max(4000).optional(),
  blackEloMax: z.coerce.number().int().min(1).max(4000).optional(),
  avgEloMin: z.coerce.number().int().min(1).max(4000).optional(),
  avgEloMax: z.coerce.number().int().min(1).max(4000).optional(),
  collectionId: z.coerce.number().int().positive().optional(),
  tagId: z.coerce.number().int().positive().optional(),
});

const UpdateAnnotationsSchema = z.object({
  schemaVersion: z.number().int().positive().default(1).optional(),
  annotations: z.record(z.string(), z.unknown()).default({}),
  moveNotes: z.record(z.string(), z.unknown()).default({}).optional(),
});

function normalizeValue(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function toId(value: number | string): number {
  if (typeof value === "number") {
    return value;
  }
  return Number(value);
}

function canonicalPgnHash(pgn: string): string {
  const canonical = pgn
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(canonical).digest("hex");
}

async function ensureGameOwnership(
  pool: Pool,
  gameId: number,
  userId: number
): Promise<boolean> {
  const ownership = await pool.query<{ id: number | string }>(
    "SELECT id FROM games WHERE id = $1 AND user_id = $2",
    [gameId, userId]
  );
  return Boolean(ownership.rowCount);
}

async function upsertPositionAndOpeningStats(
  client: PoolClient,
  params: {
    userId: number;
    gameId: number;
    startingFen: string | null;
    mainlineSans: string[];
    result: string;
    whiteElo: number | null;
    blackElo: number | null;
  }
): Promise<void> {
  await client.query(
    "DELETE FROM game_positions WHERE user_id = $1 AND game_id = $2",
    [params.userId, params.gameId]
  );

  const indexed = buildPositionIndex(params.startingFen, params.mainlineSans);
  const whiteScore =
    params.result === "1-0"
      ? 1
      : params.result === "0-1"
        ? 0
        : params.result === "1/2-1/2"
          ? 0.5
          : null;
  const avgElo =
    params.whiteElo && params.blackElo
      ? (params.whiteElo + params.blackElo) / 2
      : null;

  for (const position of indexed) {
    await client.query(
      `INSERT INTO game_positions (
        user_id,
        game_id,
        ply,
        fen_norm,
        stm,
        castling,
        ep_square,
        halfmove,
        fullmove,
        material_key,
        next_move_uci,
        next_fen_norm
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
      )`,
      [
        params.userId,
        params.gameId,
        position.ply,
        position.fenNorm,
        position.stm,
        position.castling,
        position.epSquare,
        position.halfmove,
        position.fullmove,
        position.materialKey,
        position.nextMoveUci,
        position.nextFenNorm,
      ]
    );

    if (!position.nextMoveUci) {
      continue;
    }

    await client.query(
      `INSERT INTO opening_stats (
        user_id,
        position_fen_norm,
        move_uci,
        next_fen_norm,
        games,
        white_wins,
        black_wins,
        draws,
        avg_elo,
        performance,
        transpositions,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, 1, $5, $6, $7, $8, $9, 0, NOW()
      )
      ON CONFLICT (user_id, position_fen_norm, move_uci)
      DO UPDATE SET
        next_fen_norm = COALESCE(opening_stats.next_fen_norm, EXCLUDED.next_fen_norm),
        games = opening_stats.games + 1,
        white_wins = opening_stats.white_wins + EXCLUDED.white_wins,
        black_wins = opening_stats.black_wins + EXCLUDED.black_wins,
        draws = opening_stats.draws + EXCLUDED.draws,
        avg_elo = CASE
          WHEN EXCLUDED.avg_elo IS NULL THEN opening_stats.avg_elo
          WHEN opening_stats.avg_elo IS NULL THEN EXCLUDED.avg_elo
          ELSE ROUND(
            ((opening_stats.avg_elo * opening_stats.games) + EXCLUDED.avg_elo)
              / (opening_stats.games + 1),
            2
          )
        END,
        performance = CASE
          WHEN EXCLUDED.performance IS NULL THEN opening_stats.performance
          WHEN opening_stats.performance IS NULL THEN EXCLUDED.performance
          ELSE ROUND(
            ((opening_stats.performance * opening_stats.games) + EXCLUDED.performance)
              / (opening_stats.games + 1),
            2
          )
        END,
        transpositions = opening_stats.transpositions
          + CASE
              WHEN opening_stats.next_fen_norm IS NOT NULL
               AND EXCLUDED.next_fen_norm IS NOT NULL
               AND opening_stats.next_fen_norm <> EXCLUDED.next_fen_norm
              THEN 1
              ELSE 0
            END,
        updated_at = NOW()`,
      [
        params.userId,
        position.fenNorm,
        position.nextMoveUci,
        position.nextFenNorm,
        params.result === "1-0" ? 1 : 0,
        params.result === "0-1" ? 1 : 0,
        params.result === "1/2-1/2" ? 1 : 0,
        avgElo,
        whiteScore === null ? null : whiteScore * 100,
      ]
    );
  }
}

export async function registerGameRoutes(
  app: FastifyInstance,
  pool: Pool
): Promise<void> {
  app.post("/api/games", { preHandler: requireUser }, async (request, reply) => {
    const parsed = CreateGameSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid request body",
        details: parsed.error.flatten(),
      });
    }

    const payload = parsed.data;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ id: number | string }>(
        `INSERT INTO games (
          user_id,
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
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21
        ) RETURNING id`,
        [
          request.user!.id,
          payload.white,
          normalizeValue(payload.white),
          payload.black,
          normalizeValue(payload.black),
          payload.result,
          payload.event ?? null,
          payload.event ? normalizeValue(payload.event) : null,
          payload.site ?? null,
          payload.eco ?? null,
          payload.timeControl ?? null,
          payload.rated ?? null,
          payload.whiteElo ?? null,
          payload.blackElo ?? null,
          payload.date ?? null,
          payload.plyCount ?? null,
          payload.startingFen ?? null,
          payload.movesHash,
          canonicalPgnHash(payload.pgn),
          payload.source ?? null,
          payload.license ?? null,
        ]
      );

      const gameId = toId(result.rows[0].id);
      await client.query("INSERT INTO game_pgn (game_id, pgn_text) VALUES ($1, $2)", [
        gameId,
        payload.pgn,
      ]);
      await client.query(
        "INSERT INTO game_moves (game_id, move_tree) VALUES ($1, $2::jsonb)",
        [gameId, JSON.stringify(payload.moveTree)]
      );

      await upsertPositionAndOpeningStats(client, {
        userId: request.user!.id,
        gameId,
        startingFen: payload.startingFen ?? null,
        mainlineSans: extractMainlineSans(payload.moveTree),
        result: payload.result,
        whiteElo: payload.whiteElo ?? null,
        blackElo: payload.blackElo ?? null,
      });

      await client.query("COMMIT");
      return reply.status(201).send({ id: gameId });
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "23505") {
        return reply.status(409).send({ error: "Duplicate game" });
      }

      request.log.error(error);
      return reply.status(500).send({ error: "Failed to create game" });
    } finally {
      client.release();
    }
  });

  app.get("/api/games", { preHandler: requireUser }, async (request, reply) => {
    const parsed = ListGamesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid query params",
        details: parsed.error.flatten(),
      });
    }

    const query = parsed.data;
    const whereClauses = ["g.user_id = $1"];
    const params: unknown[] = [request.user!.id];

    const addCondition = (clause: string, value: unknown): void => {
      params.push(value);
      whereClauses.push(clause.replace("?", `$${params.length}`));
    };

    if (query.player) {
      const normalized = `%${normalizeValue(query.player)}%`;
      params.push(normalized);
      const placeholder = `$${params.length}`;
      whereClauses.push(
        `(g.white_norm LIKE ${placeholder} OR g.black_norm LIKE ${placeholder})`
      );
    }

    if (query.eco) {
      addCondition("g.eco = ?", query.eco);
    }
    if (query.openingPrefix) {
      addCondition("g.eco ILIKE ?", `${query.openingPrefix}%`);
    }
    if (query.result) {
      addCondition("g.result = ?", query.result);
    }
    if (query.timeControl) {
      addCondition("g.time_control = ?", query.timeControl);
    }
    if (query.event) {
      addCondition("g.event_norm LIKE ?", `%${normalizeValue(query.event)}%`);
    }
    if (query.site) {
      addCondition("g.site ILIKE ?", `%${query.site}%`);
    }
    if (typeof query.rated === "boolean") {
      addCondition("g.rated = ?", query.rated);
    }
    if (query.fromDate) {
      addCondition("g.played_on >= ?", query.fromDate);
    }
    if (query.toDate) {
      addCondition("g.played_on <= ?", query.toDate);
    }
    if (query.whiteEloMin !== undefined) {
      addCondition("g.white_elo >= ?", query.whiteEloMin);
    }
    if (query.whiteEloMax !== undefined) {
      addCondition("g.white_elo <= ?", query.whiteEloMax);
    }
    if (query.blackEloMin !== undefined) {
      addCondition("g.black_elo >= ?", query.blackEloMin);
    }
    if (query.blackEloMax !== undefined) {
      addCondition("g.black_elo <= ?", query.blackEloMax);
    }
    if (query.avgEloMin !== undefined) {
      addCondition("((g.white_elo + g.black_elo) / 2.0) >= ?", query.avgEloMin);
    }
    if (query.avgEloMax !== undefined) {
      addCondition("((g.white_elo + g.black_elo) / 2.0) <= ?", query.avgEloMax);
    }
    if (query.collectionId) {
      addCondition(
        `EXISTS (
          SELECT 1
          FROM collection_games cg
          WHERE cg.user_id = $1
            AND cg.collection_id = ?
            AND cg.game_id = g.id
        )`,
        query.collectionId
      );
    }
    if (query.tagId) {
      addCondition(
        `EXISTS (
          SELECT 1
          FROM game_tags gt
          WHERE gt.user_id = $1
            AND gt.tag_id = ?
            AND gt.game_id = g.id
        )`,
        query.tagId
      );
    }

    const sortClause = {
      date_desc: "g.played_on DESC NULLS LAST, g.id DESC",
      date_asc: "g.played_on ASC NULLS LAST, g.id ASC",
      white: "g.white_norm ASC, g.id ASC",
      black: "g.black_norm ASC, g.id ASC",
      eco: "g.eco ASC NULLS LAST, g.id ASC",
    }[query.sort];

    const whereSql = whereClauses.join(" AND ");
    const offset = (query.page - 1) * query.pageSize;

    const countResult = await pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM games g WHERE ${whereSql}`,
      params
    );

    params.push(query.pageSize);
    params.push(offset);

    const rows = await pool.query<{
      id: number | string;
      white: string;
      black: string;
      result: string;
      played_on: string | null;
      event: string | null;
      eco: string | null;
      ply_count: number | null;
      time_control: string | null;
      white_elo: number | null;
      black_elo: number | null;
      tags: Array<{ id: number | string; name: string; color: string | null }>;
    }>(
      `SELECT
        g.id,
        g.white,
        g.black,
        g.result,
        g.played_on,
        g.event,
        g.eco,
        g.ply_count,
        g.time_control,
        g.white_elo,
        g.black_elo,
        COALESCE((
          SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color) ORDER BY t.name)
          FROM game_tags gt
          JOIN tags t ON t.id = gt.tag_id
          WHERE gt.user_id = $1
            AND gt.game_id = g.id
        ), '[]'::json) AS tags
      FROM games g
      WHERE ${whereSql}
      ORDER BY ${sortClause}
      LIMIT $${params.length - 1}
      OFFSET $${params.length}`,
      params
    );

    return reply.send({
      page: query.page,
      pageSize: query.pageSize,
      total: Number(countResult.rows[0].total),
      items: rows.rows.map((row) => ({
        id: toId(row.id),
        white: row.white,
        black: row.black,
        result: row.result,
        date: row.played_on,
        event: row.event,
        eco: row.eco,
        plyCount: row.ply_count,
        timeControl: row.time_control,
        whiteElo: row.white_elo,
        blackElo: row.black_elo,
        avgElo:
          row.white_elo && row.black_elo
            ? (row.white_elo + row.black_elo) / 2
            : null,
        tags: (row.tags ?? []).map((tag) => ({
          id: toId(tag.id),
          name: tag.name,
          color: tag.color,
        })),
      })),
    });
  });

  app.get<{ Params: { id: string } }>(
    "/api/games/:id",
    { preHandler: requireUser },
    async (request, reply) => {
      const gameId = Number(request.params.id);
      if (!Number.isInteger(gameId) || gameId <= 0) {
        return reply.status(400).send({ error: "Invalid game id" });
      }

      const result = await pool.query<{
        id: number | string;
        white: string;
        black: string;
        result: string;
        event: string | null;
        site: string | null;
        eco: string | null;
        played_on: string | null;
        ply_count: number | null;
        starting_fen: string | null;
        white_elo: number | null;
        black_elo: number | null;
        pgn_text: string;
        move_tree: Record<string, unknown>;
      }>(
        `SELECT
          g.id,
          g.white,
          g.black,
          g.result,
          g.event,
          g.site,
          g.eco,
          g.played_on,
          g.ply_count,
          g.starting_fen,
          g.white_elo,
          g.black_elo,
          gp.pgn_text,
          gm.move_tree
        FROM games g
        JOIN game_pgn gp ON gp.game_id = g.id
        JOIN game_moves gm ON gm.game_id = g.id
        WHERE g.id = $1 AND g.user_id = $2`,
        [gameId, request.user!.id]
      );

      if (!result.rowCount) {
        return reply.status(404).send({ error: "Game not found" });
      }

      const row = result.rows[0];
      return {
        id: toId(row.id),
        white: row.white,
        black: row.black,
        result: row.result,
        event: row.event,
        site: row.site,
        eco: row.eco,
        date: row.played_on,
        plyCount: row.ply_count,
        startingFen: row.starting_fen,
        whiteElo: row.white_elo,
        blackElo: row.black_elo,
        pgn: row.pgn_text,
        moveTree: row.move_tree,
      };
    }
  );

  app.get<{ Params: { id: string } }>(
    "/api/games/:id/pgn",
    { preHandler: requireUser },
    async (request, reply) => {
      const gameId = Number(request.params.id);
      if (!Number.isInteger(gameId) || gameId <= 0) {
        return reply.status(400).send({ error: "Invalid game id" });
      }

      const result = await pool.query<{ pgn_text: string }>(
        `SELECT gp.pgn_text
         FROM games g
         JOIN game_pgn gp ON gp.game_id = g.id
         WHERE g.id = $1 AND g.user_id = $2`,
        [gameId, request.user!.id]
      );

      if (!result.rowCount) {
        return reply.status(404).send({ error: "Game not found" });
      }

      reply.type("application/x-chess-pgn");
      return reply.send(result.rows[0].pgn_text);
    }
  );

  app.get<{ Params: { id: string }; Querystring: { ply?: string } }>(
    "/api/games/:id/engine-lines",
    { preHandler: requireUser },
    async (request, reply) => {
      const gameId = Number(request.params.id);
      if (!Number.isInteger(gameId) || gameId <= 0) {
        return reply.status(400).send({ error: "Invalid game id" });
      }
      const gameExists = await ensureGameOwnership(pool, gameId, request.user!.id);
      if (!gameExists) {
        return reply.status(404).send({ error: "Game not found" });
      }

      const ply = request.query.ply ? Number(request.query.ply) : undefined;
      if (request.query.ply !== undefined && (!Number.isInteger(ply) || ply! < 0)) {
        return reply.status(400).send({ error: "Invalid ply" });
      }

      const rows = await pool.query<{
        id: number | string;
        ply: number;
        fen_norm: string;
        engine: string;
        depth: number | null;
        multipv: number | null;
        pv_uci: string[] | null;
        pv_san: string[] | null;
        eval_cp: number | null;
        eval_mate: number | null;
        nodes: number | null;
        time_ms: number | null;
        source: string;
        created_at: Date;
      }>(
        `SELECT
          id,
          ply,
          fen_norm,
          engine,
          depth,
          multipv,
          pv_uci,
          pv_san,
          eval_cp,
          eval_mate,
          nodes,
          time_ms,
          source,
          created_at
        FROM engine_lines
        WHERE user_id = $1
          AND game_id = $2
          AND ($3::int IS NULL OR ply = $3::int)
        ORDER BY ply ASC, multipv ASC NULLS LAST, id DESC`,
        [request.user!.id, gameId, ply ?? null]
      );

      return {
        gameId,
        items: rows.rows.map((row) => ({
          id: toId(row.id),
          ply: row.ply,
          fenNorm: row.fen_norm,
          engine: row.engine,
          depth: row.depth,
          multipv: row.multipv,
          pvUci: row.pv_uci ?? [],
          pvSan: row.pv_san ?? [],
          evalCp: row.eval_cp,
          evalMate: row.eval_mate,
          nodes: row.nodes,
          timeMs: row.time_ms,
          source: row.source,
          createdAt: row.created_at.toISOString(),
        })),
      };
    }
  );

  app.get<{ Params: { id: string } }>(
    "/api/games/:id/annotations",
    { preHandler: requireUser },
    async (request, reply) => {
      const gameId = Number(request.params.id);
      if (!Number.isInteger(gameId) || gameId <= 0) {
        return reply.status(400).send({ error: "Invalid game id" });
      }

      const gameExists = await ensureGameOwnership(pool, gameId, request.user!.id);
      if (!gameExists) {
        return reply.status(404).send({ error: "Game not found" });
      }

      const result = await pool.query<{
        schema_version: number;
        annotations: Record<string, unknown>;
        move_notes: Record<string, unknown>;
      }>(
        `SELECT schema_version, annotations, move_notes
         FROM user_annotations
         WHERE game_id = $1 AND user_id = $2`,
        [gameId, request.user!.id]
      );

      return {
        gameId,
        schemaVersion: result.rowCount ? result.rows[0].schema_version : 1,
        annotations: result.rowCount ? result.rows[0].annotations : {},
        moveNotes: result.rowCount ? result.rows[0].move_notes : {},
      };
    }
  );

  app.put<{ Params: { id: string } }>(
    "/api/games/:id/annotations",
    { preHandler: requireUser },
    async (request, reply) => {
      const gameId = Number(request.params.id);
      if (!Number.isInteger(gameId) || gameId <= 0) {
        return reply.status(400).send({ error: "Invalid game id" });
      }

      const parsed = UpdateAnnotationsSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid request body",
          details: parsed.error.flatten(),
        });
      }

      const gameExists = await ensureGameOwnership(pool, gameId, request.user!.id);
      if (!gameExists) {
        return reply.status(404).send({ error: "Game not found" });
      }

      const schemaVersion = parsed.data.schemaVersion ?? 1;
      const moveNotes = parsed.data.moveNotes ?? {};

      await pool.query(
        `INSERT INTO user_annotations (user_id, game_id, schema_version, annotations, move_notes)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
         ON CONFLICT (user_id, game_id)
         DO UPDATE SET
           schema_version = EXCLUDED.schema_version,
           annotations = EXCLUDED.annotations,
           move_notes = EXCLUDED.move_notes,
           updated_at = NOW()`,
        [
          request.user!.id,
          gameId,
          schemaVersion,
          JSON.stringify(parsed.data.annotations),
          JSON.stringify(moveNotes),
        ]
      );

      return {
        gameId,
        schemaVersion,
        annotations: parsed.data.annotations,
        moveNotes,
      };
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/api/engine-lines/:id",
    { preHandler: requireUser },
    async (request, reply) => {
      const lineId = Number(request.params.id);
      if (!Number.isInteger(lineId) || lineId <= 0) {
        return reply.status(400).send({ error: "Invalid engine line id" });
      }

      const result = await pool.query(
        `DELETE FROM engine_lines
         WHERE id = $1 AND user_id = $2`,
        [lineId, request.user!.id]
      );

      if (!result.rowCount) {
        return reply.status(404).send({ error: "Engine line not found" });
      }

      return reply.status(204).send();
    }
  );
}

