import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { requireUser } from "../auth.js";

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

    try {
      const result = await pool.query<{ id: number | string }>(
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
          played_on,
          ply_count,
          starting_fen,
          moves_hash,
          source,
          license
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
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
          payload.date ?? null,
          payload.plyCount ?? null,
          payload.startingFen ?? null,
          payload.movesHash,
          payload.source ?? null,
          payload.license ?? null,
        ]
      );

      const gameId = toId(result.rows[0].id);
      await pool.query("INSERT INTO game_pgn (game_id, pgn_text) VALUES ($1, $2)", [
        gameId,
        payload.pgn,
      ]);
      await pool.query(
        "INSERT INTO game_moves (game_id, move_tree) VALUES ($1, $2::jsonb)",
        [gameId, JSON.stringify(payload.moveTree)]
      );

      return reply.status(201).send({ id: gameId });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        return reply.status(409).send({ error: "Duplicate game" });
      }

      request.log.error(error);
      return reply.status(500).send({ error: "Failed to create game" });
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
    const whereClauses = ["user_id = $1"];
    const params: unknown[] = [request.user!.id];

    const addCondition = (clause: string, value: unknown): void => {
      params.push(value);
      whereClauses.push(clause.replace("?", `$${params.length}`));
    };

    if (query.player) {
      const normalized = `%${normalizeValue(query.player)}%`;
      params.push(normalized);
      const placeholder = `$${params.length}`;
      whereClauses.push(`(white_norm LIKE ${placeholder} OR black_norm LIKE ${placeholder})`);
    }

    if (query.eco) {
      addCondition("eco = ?", query.eco);
    }

    if (query.result) {
      addCondition("result = ?", query.result);
    }

    if (query.timeControl) {
      addCondition("time_control = ?", query.timeControl);
    }

    if (query.event) {
      addCondition("event_norm LIKE ?", `%${normalizeValue(query.event)}%`);
    }

    if (query.site) {
      addCondition("site ILIKE ?", `%${query.site}%`);
    }

    if (typeof query.rated === "boolean") {
      addCondition("rated = ?", query.rated);
    }

    if (query.fromDate) {
      addCondition("played_on >= ?", query.fromDate);
    }

    if (query.toDate) {
      addCondition("played_on <= ?", query.toDate);
    }

    const sortClause = {
      date_desc: "played_on DESC NULLS LAST, id DESC",
      date_asc: "played_on ASC NULLS LAST, id ASC",
      white: "white_norm ASC, id ASC",
      black: "black_norm ASC, id ASC",
      eco: "eco ASC NULLS LAST, id ASC",
    }[query.sort];

    const whereSql = whereClauses.join(" AND ");
    const offset = (query.page - 1) * query.pageSize;

    const countResult = await pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM games WHERE ${whereSql}`,
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
    }>(
      `SELECT id, white, black, result, played_on, event, eco, ply_count, time_control
       FROM games
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
        pgn: row.pgn_text,
        moveTree: row.move_tree,
      };
    }
  );
}
