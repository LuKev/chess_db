import { randomBytes } from "node:crypto";
import { Chess } from "chess.js";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { requireUser } from "../auth.js";
import { normalizeFen } from "../chess/fen.js";

const CreateRepertoireSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  orientation: z.enum(["white", "black", "either"]).default("either"),
  color: z.string().trim().regex(/^#?[0-9a-fA-F]{6}$/).optional(),
});

const UpdateRepertoireSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  orientation: z.enum(["white", "black", "either"]).optional(),
  color: z.string().trim().regex(/^#?[0-9a-fA-F]{6}$/).nullable().optional(),
  isPublic: z.boolean().optional(),
});

const CreateEntrySchema = z.object({
  parentEntryId: z.number().int().positive().optional(),
  positionFen: z.string().trim().min(1).max(2048),
  moveUci: z.string().trim().min(4).max(5),
  note: z.string().trim().max(4000).optional(),
});

const UpdateEntrySchema = z.object({
  note: z.string().trim().max(4000).nullable().optional(),
});

const DrillResultSchema = z.object({
  correct: z.boolean(),
});

function toId(value: number | string): number {
  if (typeof value === "number") {
    return value;
  }
  return Number(value);
}

function createShareToken(): string {
  return randomBytes(12).toString("hex");
}

function normalizeColor(value: string | null | undefined): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  return value.startsWith("#") ? value : `#${value}`;
}

function toSan(fen: string, moveUci: string): { san: string | null; nextFen: string | null; nextFenNorm: string | null } {
  try {
    const chess = new Chess();
    chess.load(fen);
    const match = moveUci.trim().toLowerCase().match(/^([a-h][1-8])([a-h][1-8])([qrbn])?$/);
    if (!match) {
      return { san: null, nextFen: null, nextFenNorm: null };
    }
    const move = chess.move({
      from: match[1],
      to: match[2],
      promotion: match[3] as "q" | "r" | "b" | "n" | undefined,
    });
    if (!move) {
      return { san: null, nextFen: null, nextFenNorm: null };
    }
    const nextFen = chess.fen();
    return {
      san: move.san,
      nextFen,
      nextFenNorm: normalizeFen(nextFen).fenNorm,
    };
  } catch {
    return { san: null, nextFen: null, nextFenNorm: null };
  }
}

async function assertRepertoireOwnership(pool: Pool, repertoireId: number, userId: number): Promise<boolean> {
  const row = await pool.query<{ id: number | string }>(
    "SELECT id FROM repertoires WHERE id = $1 AND user_id = $2",
    [repertoireId, userId]
  );
  return Boolean(row.rowCount);
}

export async function registerRepertoireRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  app.post("/api/repertoires", { preHandler: requireUser }, async (request, reply) => {
    const parsed = CreateRepertoireSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const result = await pool.query<{
          id: number | string;
          name: string;
          description: string | null;
          orientation: string;
          color: string | null;
          share_token: string;
          is_public: boolean;
          created_at: Date;
          updated_at: Date;
        }>(
          `INSERT INTO repertoires (user_id, name, description, orientation, color, share_token)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, name, description, orientation, color, share_token, is_public, created_at, updated_at`,
          [
            request.user!.id,
            parsed.data.name,
            parsed.data.description ?? null,
            parsed.data.orientation,
            normalizeColor(parsed.data.color) ?? null,
            createShareToken(),
          ]
        );
        const row = result.rows[0];
        return reply.status(201).send({
          id: toId(row.id),
          name: row.name,
          description: row.description,
          orientation: row.orientation,
          color: row.color,
          shareToken: row.share_token,
          isPublic: row.is_public,
          createdAt: row.created_at.toISOString(),
          updatedAt: row.updated_at.toISOString(),
        });
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          continue;
        }
        request.log.error(error);
        return reply.status(500).send({ error: "Failed to create repertoire" });
      }
    }

    return reply.status(500).send({ error: "Failed to allocate repertoire share token" });
  });

  app.get("/api/repertoires", { preHandler: requireUser }, async (request) => {
    const result = await pool.query<{
      id: number | string;
      name: string;
      description: string | null;
      orientation: string;
      color: string | null;
      share_token: string;
      is_public: boolean;
      created_at: Date;
      updated_at: Date;
      entry_count: string;
      practiced_count: string;
    }>(
      `SELECT
        r.id,
        r.name,
        r.description,
        r.orientation,
        r.color,
        r.share_token,
        r.is_public,
        r.created_at,
        r.updated_at,
        COUNT(re.id)::text AS entry_count,
        COUNT(*) FILTER (WHERE re.practice_count > 0)::text AS practiced_count
       FROM repertoires r
       LEFT JOIN repertoire_entries re
         ON re.repertoire_id = r.id
        AND re.user_id = r.user_id
       WHERE r.user_id = $1
       GROUP BY r.id
       ORDER BY r.updated_at DESC, r.id DESC`,
      [request.user!.id]
    );

    return {
      items: result.rows.map((row) => ({
        id: toId(row.id),
        name: row.name,
        description: row.description,
        orientation: row.orientation,
        color: row.color,
        shareToken: row.share_token,
        isPublic: row.is_public,
        entryCount: Number(row.entry_count),
        practicedCount: Number(row.practiced_count),
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      })),
    };
  });

  app.patch<{ Params: { id: string } }>("/api/repertoires/:id", { preHandler: requireUser }, async (request, reply) => {
    const repertoireId = Number(request.params.id);
    if (!Number.isInteger(repertoireId) || repertoireId <= 0) {
      return reply.status(400).send({ error: "Invalid repertoire id" });
    }
    const parsed = UpdateRepertoireSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
    }
    if (Object.keys(parsed.data).length === 0) {
      return reply.status(400).send({ error: "No updates provided" });
    }

    const hasName = Object.prototype.hasOwnProperty.call(parsed.data, "name");
    const hasDescription = Object.prototype.hasOwnProperty.call(parsed.data, "description");
    const hasOrientation = Object.prototype.hasOwnProperty.call(parsed.data, "orientation");
    const hasColor = Object.prototype.hasOwnProperty.call(parsed.data, "color");
    const hasPublic = Object.prototype.hasOwnProperty.call(parsed.data, "isPublic");
    const result = await pool.query<{
      id: number | string;
      name: string;
      description: string | null;
      orientation: string;
      color: string | null;
      share_token: string;
      is_public: boolean;
      created_at: Date;
      updated_at: Date;
    }>(
      `UPDATE repertoires
       SET
         name = CASE WHEN $4::boolean THEN $3 ELSE name END,
         description = CASE WHEN $6::boolean THEN $5 ELSE description END,
         orientation = CASE WHEN $8::boolean THEN $7 ELSE orientation END,
         color = CASE WHEN $10::boolean THEN $9 ELSE color END,
         is_public = CASE WHEN $12::boolean THEN $11 ELSE is_public END,
         updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING id, name, description, orientation, color, share_token, is_public, created_at, updated_at`,
      [
        repertoireId,
        request.user!.id,
        parsed.data.name ?? null,
        hasName,
        parsed.data.description === undefined ? null : parsed.data.description,
        hasDescription,
        parsed.data.orientation ?? null,
        hasOrientation,
        normalizeColor(parsed.data.color),
        hasColor,
        parsed.data.isPublic ?? false,
        hasPublic,
      ]
    );
    if (!result.rowCount) {
      return reply.status(404).send({ error: "Repertoire not found" });
    }
    const row = result.rows[0];
    return {
      id: toId(row.id),
      name: row.name,
      description: row.description,
      orientation: row.orientation,
      color: row.color,
      shareToken: row.share_token,
      isPublic: row.is_public,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  });

  app.delete<{ Params: { id: string } }>("/api/repertoires/:id", { preHandler: requireUser }, async (request, reply) => {
    const repertoireId = Number(request.params.id);
    if (!Number.isInteger(repertoireId) || repertoireId <= 0) {
      return reply.status(400).send({ error: "Invalid repertoire id" });
    }
    const result = await pool.query("DELETE FROM repertoires WHERE id = $1 AND user_id = $2", [
      repertoireId,
      request.user!.id,
    ]);
    if (!result.rowCount) {
      return reply.status(404).send({ error: "Repertoire not found" });
    }
    return reply.status(204).send();
  });

  app.get<{ Params: { id: string } }>("/api/repertoires/:id/entries", { preHandler: requireUser }, async (request, reply) => {
    const repertoireId = Number(request.params.id);
    if (!Number.isInteger(repertoireId) || repertoireId <= 0) {
      return reply.status(400).send({ error: "Invalid repertoire id" });
    }
    const owns = await assertRepertoireOwnership(pool, repertoireId, request.user!.id);
    if (!owns) {
      return reply.status(404).send({ error: "Repertoire not found" });
    }
    const result = await pool.query<{
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
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT
        id, parent_entry_id, position_fen, fen_norm, move_uci, move_san, next_fen, next_fen_norm,
        note, practice_count, correct_count, last_drilled_at, created_at, updated_at
       FROM repertoire_entries
       WHERE repertoire_id = $1 AND user_id = $2
       ORDER BY created_at ASC, id ASC`,
      [repertoireId, request.user!.id]
    );
    return {
      repertoireId,
      items: result.rows.map((row) => ({
        id: toId(row.id),
        parentEntryId: row.parent_entry_id === null ? null : toId(row.parent_entry_id),
        positionFen: row.position_fen,
        fenNorm: row.fen_norm,
        moveUci: row.move_uci,
        moveSan: row.move_san,
        nextFen: row.next_fen,
        nextFenNorm: row.next_fen_norm,
        note: row.note,
        practiceCount: row.practice_count,
        correctCount: row.correct_count,
        lastDrilledAt: row.last_drilled_at?.toISOString() ?? null,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      })),
    };
  });

  app.post<{ Params: { id: string } }>("/api/repertoires/:id/entries", { preHandler: requireUser }, async (request, reply) => {
    const repertoireId = Number(request.params.id);
    if (!Number.isInteger(repertoireId) || repertoireId <= 0) {
      return reply.status(400).send({ error: "Invalid repertoire id" });
    }
    const parsed = CreateEntrySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
    }
    const owns = await assertRepertoireOwnership(pool, repertoireId, request.user!.id);
    if (!owns) {
      return reply.status(404).send({ error: "Repertoire not found" });
    }
    let normalizedPosition;
    try {
      normalizedPosition = normalizeFen(parsed.data.positionFen);
    } catch (error) {
      return reply.status(400).send({ error: String(error) });
    }
    const applied = toSan(parsed.data.positionFen, parsed.data.moveUci);
    if (!applied.san) {
      return reply.status(400).send({ error: "Move is not legal from the provided position" });
    }
    const result = await pool.query<{
      id: number | string;
      created_at: Date;
      updated_at: Date;
    }>(
      `INSERT INTO repertoire_entries (
        repertoire_id, user_id, parent_entry_id, position_fen, fen_norm, move_uci, move_san, next_fen, next_fen_norm, note
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
      )
      RETURNING id, created_at, updated_at`,
      [
        repertoireId,
        request.user!.id,
        parsed.data.parentEntryId ?? null,
        parsed.data.positionFen,
        normalizedPosition.fenNorm,
        parsed.data.moveUci.toLowerCase(),
        applied.san,
        applied.nextFen,
        applied.nextFenNorm,
        parsed.data.note ?? null,
      ]
    );
    return reply.status(201).send({
      id: toId(result.rows[0].id),
      createdAt: result.rows[0].created_at.toISOString(),
      updatedAt: result.rows[0].updated_at.toISOString(),
    });
  });

  app.patch<{ Params: { entryId: string } }>("/api/repertoire-entries/:entryId", { preHandler: requireUser }, async (request, reply) => {
    const entryId = Number(request.params.entryId);
    if (!Number.isInteger(entryId) || entryId <= 0) {
      return reply.status(400).send({ error: "Invalid entry id" });
    }
    const parsed = UpdateEntrySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
    }
    const result = await pool.query(
      `UPDATE repertoire_entries
       SET note = CASE WHEN $3::boolean THEN $2 ELSE note END,
           updated_at = NOW()
       WHERE id = $1 AND user_id = $4
       RETURNING id`,
      [entryId, parsed.data.note ?? null, Object.prototype.hasOwnProperty.call(parsed.data, "note"), request.user!.id]
    );
    if (!result.rowCount) {
      return reply.status(404).send({ error: "Repertoire entry not found" });
    }
    return { id: entryId, ok: true };
  });

  app.delete<{ Params: { entryId: string } }>("/api/repertoire-entries/:entryId", { preHandler: requireUser }, async (request, reply) => {
    const entryId = Number(request.params.entryId);
    if (!Number.isInteger(entryId) || entryId <= 0) {
      return reply.status(400).send({ error: "Invalid entry id" });
    }
    const result = await pool.query("DELETE FROM repertoire_entries WHERE id = $1 AND user_id = $2", [
      entryId,
      request.user!.id,
    ]);
    if (!result.rowCount) {
      return reply.status(404).send({ error: "Repertoire entry not found" });
    }
    return reply.status(204).send();
  });

  app.get<{ Params: { id: string } }>("/api/repertoires/:id/drill/next", { preHandler: requireUser }, async (request, reply) => {
    const repertoireId = Number(request.params.id);
    if (!Number.isInteger(repertoireId) || repertoireId <= 0) {
      return reply.status(400).send({ error: "Invalid repertoire id" });
    }
    const owns = await assertRepertoireOwnership(pool, repertoireId, request.user!.id);
    if (!owns) {
      return reply.status(404).send({ error: "Repertoire not found" });
    }

    const candidate = await pool.query<{
      fen_norm: string;
      position_fen: string;
      total_candidates: string;
      total_practice: string;
      last_drilled_at: Date | null;
    }>(
      `SELECT
        fen_norm,
        MIN(position_fen) AS position_fen,
        COUNT(*)::text AS total_candidates,
        COALESCE(SUM(practice_count), 0)::text AS total_practice,
        MIN(last_drilled_at) AS last_drilled_at
       FROM repertoire_entries
       WHERE repertoire_id = $1 AND user_id = $2
       GROUP BY fen_norm
       ORDER BY COALESCE(SUM(practice_count), 0) ASC, MIN(last_drilled_at) ASC NULLS FIRST, COUNT(*) DESC
       LIMIT 1`,
      [repertoireId, request.user!.id]
    );
    if (!candidate.rowCount) {
      return reply.status(404).send({ error: "No repertoire entries available for drill" });
    }
    const position = candidate.rows[0];
    const options = await pool.query<{
      id: number | string;
      move_uci: string;
      move_san: string | null;
      note: string | null;
      practice_count: number;
      correct_count: number;
    }>(
      `SELECT id, move_uci, move_san, note, practice_count, correct_count
       FROM repertoire_entries
       WHERE repertoire_id = $1
         AND user_id = $2
         AND fen_norm = $3
       ORDER BY correct_count DESC, move_san ASC NULLS LAST, id ASC`,
      [repertoireId, request.user!.id, position.fen_norm]
    );
    return {
      repertoireId,
      positionFen: position.position_fen,
      fenNorm: position.fen_norm,
      totalCandidates: Number(position.total_candidates),
      totalPractice: Number(position.total_practice),
      options: options.rows.map((row) => ({
        id: toId(row.id),
        moveUci: row.move_uci,
        moveSan: row.move_san,
        note: row.note,
        practiceCount: row.practice_count,
        correctCount: row.correct_count,
      })),
    };
  });

  app.post<{ Params: { entryId: string } }>("/api/repertoire-entries/:entryId/drill-result", { preHandler: requireUser }, async (request, reply) => {
    const entryId = Number(request.params.entryId);
    if (!Number.isInteger(entryId) || entryId <= 0) {
      return reply.status(400).send({ error: "Invalid entry id" });
    }
    const parsed = DrillResultSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid request body", details: parsed.error.flatten() });
    }
    const result = await pool.query(
      `UPDATE repertoire_entries
       SET
         practice_count = practice_count + 1,
         correct_count = correct_count + CASE WHEN $2::boolean THEN 1 ELSE 0 END,
         last_drilled_at = NOW(),
         updated_at = NOW()
       WHERE id = $1 AND user_id = $3
       RETURNING id, practice_count, correct_count, last_drilled_at`,
      [entryId, parsed.data.correct, request.user!.id]
    );
    if (!result.rowCount) {
      return reply.status(404).send({ error: "Repertoire entry not found" });
    }
    return {
      id: entryId,
      practiceCount: result.rows[0].practice_count,
      correctCount: result.rows[0].correct_count,
      lastDrilledAt: result.rows[0].last_drilled_at?.toISOString() ?? null,
    };
  });
}
