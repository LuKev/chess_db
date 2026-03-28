import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { randomBytes } from "node:crypto";
import { requireUser } from "../auth.js";

function toId(value: number | string): number {
  if (typeof value === "number") {
    return value;
  }
  return Number(value);
}

function createShareToken(): string {
  return randomBytes(12).toString("hex");
}

export async function registerPublicRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  app.get<{ Params: { token: string } }>("/api/public/collections/:token", async (request, reply) => {
    const collection = await pool.query<{
      id: number | string;
      name: string;
      description: string | null;
      updated_at: Date;
    }>(
      `SELECT id, name, description, updated_at
       FROM collections
       WHERE share_token = $1
         AND is_public = TRUE`,
      [request.params.token]
    );
    if (!collection.rowCount) {
      return reply.status(404).send({ error: "Published collection not found" });
    }
    const games = await pool.query<{
      id: number | string;
      white: string;
      black: string;
      result: string;
      event: string | null;
      eco: string | null;
      played_on: string | null;
    }>(
      `SELECT g.id, g.white, g.black, g.result, g.event, g.eco, g.played_on::text
       FROM collections c
       JOIN collection_games cg ON cg.collection_id = c.id
       JOIN games g ON g.id = cg.game_id
       WHERE c.share_token = $1
         AND c.is_public = TRUE
       ORDER BY g.played_on DESC NULLS LAST, g.id DESC
       LIMIT 200`,
      [request.params.token]
    );
    const row = collection.rows[0];
    return {
      collection: {
        id: toId(row.id),
        name: row.name,
        description: row.description,
        updatedAt: row.updated_at.toISOString(),
      },
      items: games.rows.map((game) => ({
        id: toId(game.id),
        white: game.white,
        black: game.black,
        result: game.result,
        event: game.event,
        eco: game.eco,
        date: game.played_on,
      })),
    };
  });

  app.get<{ Params: { token: string } }>("/api/public/repertoires/:token", async (request, reply) => {
    const repertoire = await pool.query<{
      id: number | string;
      name: string;
      description: string | null;
      orientation: string;
      color: string | null;
      updated_at: Date;
    }>(
      `SELECT id, name, description, orientation, color, updated_at
       FROM repertoires
       WHERE share_token = $1
         AND is_public = TRUE`,
      [request.params.token]
    );
    if (!repertoire.rowCount) {
      return reply.status(404).send({ error: "Published repertoire not found" });
    }
    const entries = await pool.query<{
      id: number | string;
      parent_entry_id: number | string | null;
      position_fen: string;
      move_uci: string;
      move_san: string | null;
      note: string | null;
      practice_count: number;
      correct_count: number;
    }>(
      `SELECT id, parent_entry_id, position_fen, move_uci, move_san, note, practice_count, correct_count
       FROM repertoire_entries re
       JOIN repertoires r ON r.id = re.repertoire_id
       WHERE r.share_token = $1
         AND r.is_public = TRUE
       ORDER BY re.created_at ASC, re.id ASC`,
      [request.params.token]
    );
    const row = repertoire.rows[0];
    return {
      repertoire: {
        id: toId(row.id),
        name: row.name,
        description: row.description,
        orientation: row.orientation,
        color: row.color,
        updatedAt: row.updated_at.toISOString(),
      },
      items: entries.rows.map((entry) => ({
        id: toId(entry.id),
        parentEntryId: entry.parent_entry_id === null ? null : toId(entry.parent_entry_id),
        positionFen: entry.position_fen,
        moveUci: entry.move_uci,
        moveSan: entry.move_san,
        note: entry.note,
        practiceCount: entry.practice_count,
        correctCount: entry.correct_count,
      })),
    };
  });

  app.post<{ Params: { token: string } }>("/api/public/repertoires/:token/clone", { preHandler: requireUser }, async (request, reply) => {
    const publicRepertoire = await pool.query<{
      id: number | string;
      name: string;
      description: string | null;
      orientation: string;
      color: string | null;
    }>(
      `SELECT id, name, description, orientation, color
       FROM repertoires
       WHERE share_token = $1
         AND is_public = TRUE`,
      [request.params.token]
    );
    if (!publicRepertoire.rowCount) {
      return reply.status(404).send({ error: "Published repertoire not found" });
    }
    const source = publicRepertoire.rows[0];
    const created = await pool.query<{ id: number | string }>(
      `INSERT INTO repertoires (user_id, name, description, orientation, color, share_token, is_public)
       VALUES ($1, $2, $3, $4, $5, $6, FALSE)
       RETURNING id`,
      [
        request.user!.id,
        `${source.name} (Copy)`,
        source.description,
        source.orientation,
        source.color,
        createShareToken(),
      ]
    );
    const newId = toId(created.rows[0].id);
    const entries = await pool.query<{
      id: number | string;
      parent_entry_id: number | string | null;
      position_fen: string;
      fen_norm: string;
      move_uci: string;
      move_san: string | null;
      next_fen: string | null;
      next_fen_norm: string | null;
      note: string | null;
      practice_count: number;
      correct_count: number;
      last_drilled_at: Date | null;
    }>(
      `SELECT id, parent_entry_id, position_fen, fen_norm, move_uci, move_san, next_fen, next_fen_norm, note, practice_count, correct_count, last_drilled_at
       FROM repertoire_entries re
       JOIN repertoires r ON r.id = re.repertoire_id
       WHERE r.share_token = $1
         AND r.is_public = TRUE
       ORDER BY re.created_at ASC, re.id ASC`,
      [request.params.token]
    );
    const idMap = new Map<number, number>();
    for (const entry of entries.rows) {
      const inserted = await pool.query<{ id: number | string }>(
        `INSERT INTO repertoire_entries (
          repertoire_id, user_id, parent_entry_id, position_fen, fen_norm, move_uci, move_san, next_fen, next_fen_norm, note, practice_count, correct_count, last_drilled_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
        )
        RETURNING id`,
        [
          newId,
          request.user!.id,
          entry.parent_entry_id === null ? null : idMap.get(toId(entry.parent_entry_id)) ?? null,
          entry.position_fen,
          entry.fen_norm,
          entry.move_uci,
          entry.move_san,
          entry.next_fen,
          entry.next_fen_norm,
          entry.note,
          entry.practice_count,
          entry.correct_count,
          entry.last_drilled_at,
        ]
      );
      idMap.set(toId(entry.id), toId(inserted.rows[0].id));
    }
    return reply.status(201).send({ id: newId });
  });
}
