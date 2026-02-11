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

type NormalizedMoveNote = {
  comment?: string;
  nags: number[];
  highlights: string[];
  arrows: string[];
  variationNote?: string;
};

function splitPgnSections(pgnText: string): { headers: string; moveText: string } {
  const normalized = pgnText.replace(/\r\n/g, "\n").trim();
  const divider = normalized.indexOf("\n\n");
  if (divider < 0) {
    return {
      headers: "",
      moveText: normalized,
    };
  }
  return {
    headers: normalized.slice(0, divider).trim(),
    moveText: normalized.slice(divider + 2).trim(),
  };
}

function tokenizeMovetext(moveText: string): string[] {
  const tokens: string[] = [];
  let index = 0;
  while (index < moveText.length) {
    const char = moveText[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "{") {
      let end = index + 1;
      while (end < moveText.length && moveText[end] !== "}") {
        end += 1;
      }
      tokens.push(moveText.slice(index, Math.min(end + 1, moveText.length)));
      index = Math.min(end + 1, moveText.length);
      continue;
    }
    if (char === "(" || char === ")") {
      tokens.push(char);
      index += 1;
      continue;
    }

    let end = index + 1;
    while (
      end < moveText.length &&
      !/\s/.test(moveText[end]) &&
      moveText[end] !== "{" &&
      moveText[end] !== "}" &&
      moveText[end] !== "(" &&
      moveText[end] !== ")"
    ) {
      end += 1;
    }
    tokens.push(moveText.slice(index, end));
    index = end;
  }
  return tokens;
}

function isMoveNumberToken(token: string): boolean {
  return /^\d+\.(\.\.)?$/.test(token);
}

function isResultToken(token: string): boolean {
  return token === "1-0" || token === "0-1" || token === "1/2-1/2" || token === "*";
}

function isNagToken(token: string): boolean {
  return /^\$\d+$/.test(token);
}

function normalizeMoveNotes(
  moveNotes: Record<string, unknown> | null
): Record<string, NormalizedMoveNote> {
  if (!moveNotes) {
    return {};
  }
  const normalized: Record<string, NormalizedMoveNote> = {};
  for (const [ply, value] of Object.entries(moveNotes)) {
    if (!/^\d+$/.test(ply) || !value || typeof value !== "object") {
      continue;
    }
    const raw = value as Record<string, unknown>;
    const nagsRaw = Array.isArray(raw.nags)
      ? raw.nags
      : Array.isArray(raw.glyphs)
        ? raw.glyphs
        : [];
    const nags = nagsRaw
      .map((nag) =>
        typeof nag === "number" && Number.isInteger(nag) && nag >= 1 && nag <= 255 ? nag : null
      )
      .filter((nag): nag is number => nag !== null)
      .slice(0, 32);
    const highlights = Array.isArray(raw.highlights)
      ? raw.highlights
          .map((sq) => (typeof sq === "string" ? sq.trim().toUpperCase() : ""))
          .filter((sq) => /^[A-H][1-8]$/.test(sq))
          .slice(0, 64)
      : [];
    const arrows = Array.isArray(raw.arrows)
      ? raw.arrows
          .map((arrow) => (typeof arrow === "string" ? arrow.trim().toUpperCase() : ""))
          .filter((arrow) => /^[A-H][1-8][A-H][1-8]$/.test(arrow))
          .slice(0, 64)
      : [];
    const comment =
      typeof raw.comment === "string" && raw.comment.trim().length > 0
        ? raw.comment.trim()
        : undefined;
    const variationNote =
      typeof raw.variationNote === "string" && raw.variationNote.trim().length > 0
        ? raw.variationNote.trim()
        : undefined;

    if (!comment && !variationNote && nags.length === 0 && highlights.length === 0 && arrows.length === 0) {
      continue;
    }
    normalized[ply] = {
      comment,
      nags,
      highlights,
      arrows,
      variationNote,
    };
  }
  return normalized;
}

function rootAnnotationChunks(
  annotations: Record<string, unknown> | null
): { chunks: string[]; unsupportedFallback: Record<string, unknown> } {
  if (!annotations) {
    return { chunks: [], unsupportedFallback: {} };
  }

  const chunks: string[] = [];
  const unsupportedFallback: Record<string, unknown> = {};

  if (typeof annotations.comment === "string" && annotations.comment.trim().length > 0) {
    chunks.push(`{${annotations.comment.trim()}}`);
  }

  const highlights = Array.isArray(annotations.highlights)
    ? annotations.highlights
        .map((value) => (typeof value === "string" ? value.trim().toUpperCase() : ""))
        .filter((value) => /^[A-H][1-8]$/.test(value))
    : [];
  if (highlights.length > 0) {
    chunks.push(`{[%csl ${highlights.map((sq) => `Y${sq}`).join(",")}]}`);
  }

  const arrows = Array.isArray(annotations.arrows)
    ? annotations.arrows
        .map((value) => (typeof value === "string" ? value.trim().toUpperCase() : ""))
        .filter((value) => /^[A-H][1-8][A-H][1-8]$/.test(value))
    : [];
  if (arrows.length > 0) {
    chunks.push(`{[%cal ${arrows.map((arrow) => `G${arrow}`).join(",")}]}`);
  }

  if (typeof annotations.cursor === "number" && Number.isInteger(annotations.cursor)) {
    unsupportedFallback.cursor = annotations.cursor;
  }
  if (typeof annotations.lineId === "string" && annotations.lineId.trim().length > 0) {
    unsupportedFallback.lineId = annotations.lineId.trim();
  }

  return {
    chunks,
    unsupportedFallback,
  };
}

function moveNoteChunks(note: NormalizedMoveNote, ply: number): string[] {
  const chunks: string[] = [];
  if (note.nags.length > 0) {
    chunks.push(...note.nags.map((nag) => `$${nag}`));
  }
  if (note.comment) {
    chunks.push(`{${note.comment}}`);
  }
  if (note.highlights.length > 0) {
    chunks.push(`{[%csl ${note.highlights.map((sq) => `Y${sq}`).join(",")}]}`);
  }
  if (note.arrows.length > 0) {
    chunks.push(`{[%cal ${note.arrows.map((arrow) => `G${arrow}`).join(",")}]}`);
  }
  if (note.variationNote) {
    chunks.push(`{Variation note (ply ${ply}): ${note.variationNote}}`);
  }
  return chunks;
}

function withAnnotationsComment(
  pgnText: string,
  includeAnnotations: boolean,
  annotations: Record<string, unknown> | null,
  moveNotes: Record<string, unknown> | null,
  schemaVersion: number | null
): string {
  const trimmed = pgnText.trim();
  if (!includeAnnotations) {
    return trimmed;
  }
  if (
    ((!annotations || Object.keys(annotations).length === 0) &&
      (!moveNotes || Object.keys(moveNotes).length === 0))
  ) {
    return trimmed;
  }

  const normalizedMoveNotes = normalizeMoveNotes(moveNotes);
  const { headers, moveText } = splitPgnSections(trimmed);
  const tokens = tokenizeMovetext(moveText);
  const { chunks: rootChunks, unsupportedFallback } = rootAnnotationChunks(annotations);

  const renderedTokens: string[] = [...rootChunks];
  let mainlinePly = 0;
  let variationDepth = 0;
  for (const token of tokens) {
    renderedTokens.push(token);
    if (token === "(") {
      variationDepth += 1;
      continue;
    }
    if (token === ")") {
      variationDepth = Math.max(0, variationDepth - 1);
      continue;
    }
    if (token.startsWith("{") && token.endsWith("}")) {
      continue;
    }
    if (isMoveNumberToken(token) || isResultToken(token) || isNagToken(token)) {
      continue;
    }
    if (variationDepth > 0) {
      continue;
    }

    mainlinePly += 1;
    const note = normalizedMoveNotes[String(mainlinePly)];
    if (!note) {
      continue;
    }
    renderedTokens.push(...moveNoteChunks(note, mainlinePly));
  }

  if (Object.keys(unsupportedFallback).length > 0) {
    renderedTokens.push(
      `{ChessDBAnnotationsUnsupported schema=${schemaVersion ?? 2} ${JSON.stringify(
        unsupportedFallback
      )}}`
    );
  }

  const renderedMoveText = renderedTokens.join(" ").replace(/\s+/g, " ").trim();
  return headers.length > 0 ? `${headers}\n\n${renderedMoveText}` : renderedMoveText;
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
