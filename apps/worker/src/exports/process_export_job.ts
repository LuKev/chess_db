import type { Pool } from "pg";
import type { ObjectStorage } from "../infrastructure/storage.js";

type ProcessExportJobParams = {
  pool: Pool;
  storage: ObjectStorage;
  exportJobId: number;
  userId: number;
};

type ExportPgnRow = {
  game_id: number | string;
  pgn_text: string;
  annotations: Record<string, unknown> | null;
  move_notes: Record<string, unknown> | null;
  schema_version: number | null;
};

type FilterQuery = {
  player?: string;
  eco?: string;
  openingPrefix?: string;
  result?: string;
  timeControl?: string;
  event?: string;
  site?: string;
  rated?: "true" | "false";
  fromDate?: string;
  toDate?: string;
  whiteEloMin?: number;
  whiteEloMax?: number;
  blackEloMin?: number;
  blackEloMax?: number;
  avgEloMin?: number;
  avgEloMax?: number;
  collectionId?: number;
  tagId?: number;
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

function withAnnotationsComment(
  pgnText: string,
  includeAnnotations: boolean,
  annotations: Record<string, unknown> | null,
  moveNotes: Record<string, unknown> | null,
  schemaVersion: number | null
): string {
  const trimmed = pgnText.trim();
  if (
    !includeAnnotations ||
    ((!annotations || Object.keys(annotations).length === 0) &&
      (!moveNotes || Object.keys(moveNotes).length === 0))
  ) {
    return trimmed;
  }

  const blocks: string[] = [trimmed];
  const annotationComment = annotations?.comment;
  if (typeof annotationComment === "string" && annotationComment.trim().length > 0) {
    blocks.push(`{${annotationComment.trim()}}`);
  }

  const highlights = Array.isArray(annotations?.highlights)
    ? (annotations!.highlights as unknown[])
        .map((value) => (typeof value === "string" ? value.trim().toUpperCase() : ""))
        .filter((value) => value.length > 0)
    : [];
  if (highlights.length > 0) {
    blocks.push(`{[%csl ${highlights.map((sq) => `Y${sq}`).join(",")}]}`);
  }

  const arrows = Array.isArray(annotations?.arrows)
    ? (annotations!.arrows as unknown[])
        .map((value) => (typeof value === "string" ? value.trim().toLowerCase() : ""))
        .filter((value) => value.length >= 4)
    : [];
  if (arrows.length > 0) {
    const cal = arrows
      .map((arrow) => `${arrow.slice(0, 2).toUpperCase()}${arrow.slice(2, 4).toUpperCase()}`)
      .map((arrow) => `G${arrow}`)
      .join(",");
    blocks.push(`{[%cal ${cal}]}`);
  }

  const notesEntries = Object.entries(moveNotes ?? {}).sort(
    (a, b) => Number(a[0]) - Number(b[0])
  );
  for (const [ply, rawNote] of notesEntries) {
    if (!rawNote || typeof rawNote !== "object") {
      continue;
    }
    const note = rawNote as { comment?: unknown; glyphs?: unknown };
    const comment =
      typeof note.comment === "string" && note.comment.trim().length > 0
        ? note.comment.trim()
        : "";
    const glyphs = Array.isArray(note.glyphs)
      ? note.glyphs
          .map((glyph) =>
            typeof glyph === "number" && Number.isInteger(glyph) ? glyph : null
          )
          .filter((glyph): glyph is number => glyph !== null)
      : [];

    if (glyphs.length > 0) {
      blocks.push(`${glyphs.map((glyph) => `$${glyph}`).join(" ")} {Move note at ply ${ply}}`);
    }
    if (comment) {
      blocks.push(`{Move ${ply}: ${comment}}`);
    }
  }

  blocks.push(
    `{ChessDBAnnotations schema=${schemaVersion ?? 1} ${JSON.stringify({
      annotations: annotations ?? {},
      moveNotes: moveNotes ?? {},
    })}}`
  );

  return blocks.join("\n");
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
  if (query.rated === "true" || query.rated === "false") {
    addCondition("g.rated = ?", query.rated === "true");
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
  if (query.collectionId !== undefined) {
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
  if (query.tagId !== undefined) {
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
    include_annotations: boolean;
  }>(
    `SELECT id, user_id, mode, game_ids, filter_query, include_annotations
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
    let pgnRows: ExportPgnRow[] = [];

    const annotationSelect = job.include_annotations
      ? "ua.annotations AS annotations, ua.move_notes AS move_notes, ua.schema_version AS schema_version"
      : "NULL::jsonb AS annotations, NULL::jsonb AS move_notes, NULL::int AS schema_version";
    const annotationJoin = job.include_annotations
      ? "LEFT JOIN user_annotations ua ON ua.game_id = g.id AND ua.user_id = $1"
      : "";

    if (job.mode === "ids") {
      const ids = job.game_ids ?? [];
      if (ids.length > 0) {
        const result = await params.pool.query<ExportPgnRow>(
          `SELECT g.id AS game_id, gp.pgn_text, ${annotationSelect}
           FROM games g
           JOIN game_pgn gp ON gp.game_id = g.id
           ${annotationJoin}
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
      const result = await params.pool.query<ExportPgnRow>(
        `SELECT g.id AS game_id, gp.pgn_text, ${annotationSelect}
         FROM games g
         JOIN game_pgn gp ON gp.game_id = g.id
         ${annotationJoin}
         WHERE ${whereSql}
         ORDER BY g.id ASC`,
        whereParams
      );
      pgnRows = result.rows;
    }

    const exportText = pgnRows
      .map((row) =>
        withAnnotationsComment(
          row.pgn_text,
          job.include_annotations,
          row.annotations,
          row.move_notes,
          row.schema_version
        )
      )
      .join("\n\n");
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
