import { Chess } from "chess.js";
import type { Pool } from "pg";
import { extractMainlineSans } from "../backfill/indexing.js";
import { normalizeFen } from "../chess/fen.js";
import { loadCachedAnalysisLines, pvSanFromFen, pvUciFromString, type PersistableAnalysisLine } from "./persistence.js";
import { runStockfishAnalysis } from "./stockfish.js";

type ProcessAutoAnnotationJobParams = {
  pool: Pool;
  autoAnnotationJobId: number;
  userId: number;
  stockfishBinary: string;
  cancelPollMs: number;
};

type TimelineEntry = {
  notePly: number;
  currentFen: string;
  nextFen: string;
  playedSan: string;
  playedUci: string;
};

type ExistingMoveNote = {
  comment?: string;
  nags?: number[];
  highlights?: string[];
  arrows?: string[];
  variationNote?: string;
};

function toId(value: number | string): number {
  if (typeof value === "number") {
    return value;
  }
  return Number(value);
}

function moveToUci(move: { from: string; to: string; promotion?: string }): string {
  return `${move.from}${move.to}${move.promotion ?? ""}`.toLowerCase();
}

function buildTimeline(startingFen: string | null, sans: string[]): TimelineEntry[] {
  const chess = new Chess(startingFen && startingFen !== "startpos" ? startingFen : undefined);
  const timeline: TimelineEntry[] = [];

  for (let index = 0; index < sans.length; index += 1) {
    const currentFen = chess.fen();
    const move = chess.move(sans[index] ?? "", { strict: false });
    if (!move) {
      break;
    }
    timeline.push({
      notePly: index + 1,
      currentFen,
      nextFen: chess.fen(),
      playedSan: move.san,
      playedUci: moveToUci(move),
    });
  }

  return timeline;
}

function hasExistingAnnotation(note: ExistingMoveNote | undefined): boolean {
  if (!note) {
    return false;
  }
  return Boolean(note.comment?.trim())
    || (note.nags?.length ?? 0) > 0
    || (note.highlights?.length ?? 0) > 0
    || (note.arrows?.length ?? 0) > 0
    || Boolean(note.variationNote?.trim());
}

function scoreForComparison(evalCp: number | null, evalMate: number | null): number {
  if (evalMate !== null) {
    const sign = evalMate >= 0 ? 1 : -1;
    return sign * (100_000 - Math.min(999, Math.abs(evalMate)) * 1_000);
  }
  return evalCp ?? 0;
}

function invertEvaluation(line: PersistableAnalysisLine | null): { evalCp: number | null; evalMate: number | null } {
  if (!line) {
    return { evalCp: null, evalMate: null };
  }
  return {
    evalCp: line.evalCp === null ? null : -line.evalCp,
    evalMate: line.evalMate === null ? null : -line.evalMate,
  };
}

function classifyLoss(lossCpEquivalent: number): { label: string; nags: number[] } | null {
  if (lossCpEquivalent >= 250) {
    return { label: "Blunder", nags: [4] };
  }
  if (lossCpEquivalent >= 120) {
    return { label: "Mistake", nags: [2] };
  }
  if (lossCpEquivalent >= 60) {
    return { label: "Inaccuracy", nags: [6] };
  }
  return null;
}

function formatEval(evalCp: number | null, evalMate: number | null): string {
  if (evalMate !== null) {
    return `#${evalMate}`;
  }
  if (evalCp !== null) {
    return `${(evalCp / 100).toFixed(2)}`;
  }
  return "-";
}

function describePv(fen: string, pvUci: string[]): string {
  const pvSan = pvSanFromFen(fen, pvUci).slice(0, 6);
  return pvSan.join(" ");
}

async function isCancelled(pool: Pool, autoAnnotationJobId: number): Promise<boolean> {
  const result = await pool.query<{ cancel_requested: boolean; status: string }>(
    `SELECT cancel_requested, status
     FROM auto_annotation_jobs
     WHERE id = $1`,
    [autoAnnotationJobId]
  );

  if (!result.rowCount) {
    return true;
  }

  return result.rows[0].cancel_requested || result.rows[0].status === "cancelled";
}

async function loadAnalysis(params: {
  pool: Pool;
  userId: number;
  fen: string;
  engine: string;
  depth: number | null;
  timeMs: number | null;
  stockfishBinary: string;
  cancelPollMs: number;
  autoAnnotationJobId: number;
  multipv: number;
}): Promise<PersistableAnalysisLine[] | null> {
  const fenNorm = normalizeFen(params.fen).fenNorm;
  const cached = await loadCachedAnalysisLines<{
    multipv_rank: number;
    pv_uci: string[] | null;
    pv_san: string[] | null;
    eval_cp: number | null;
    eval_mate: number | null;
    nodes: number | null;
    time_ms: number | null;
  }>({
    pool: params.pool,
    userId: params.userId,
    fenNorm,
    engine: params.engine,
    depth: params.depth,
    multipv: params.multipv,
    query: `SELECT DISTINCT ON (COALESCE(multipv, 1))
        COALESCE(multipv, 1) AS multipv_rank,
        pv_uci,
        pv_san,
        eval_cp,
        eval_mate,
        nodes,
        time_ms
      FROM engine_lines
      WHERE user_id = $1
        AND fen_norm = $2
        AND engine = $3
        AND ($4::int IS NULL OR depth >= $4::int)
        AND COALESCE(multipv, 1) <= $5::int
      ORDER BY COALESCE(multipv, 1), depth DESC NULLS LAST, created_at DESC`,
    mapRow: (row) => ({
      multipv: row.multipv_rank,
      pvUci: row.pv_uci ?? [],
      pvSan: row.pv_san ?? [],
      evalCp: row.eval_cp,
      evalMate: row.eval_mate,
      nodes: row.nodes,
      timeMs: row.time_ms,
    }),
  });

  if (cached.length >= params.multipv) {
    return cached.slice(0, params.multipv);
  }

  const result = await runStockfishAnalysis({
    stockfishBinary: params.stockfishBinary,
    fen: params.fen,
    engine: params.engine,
    multipv: params.multipv,
    limits: {
      depth: params.depth,
      nodes: null,
      timeMs: params.timeMs,
    },
    onCancelPoll: async () => isCancelled(params.pool, params.autoAnnotationJobId),
    onInfo: async () => {},
    cancelPollMs: params.cancelPollMs,
  });

  if ("cancelled" in result) {
    return null;
  }

  return result.lines.map((line) => {
    const pvUci = pvUciFromString(line.pv);
    return {
      multipv: line.multipv,
      pvUci,
      pvSan: pvSanFromFen(params.fen, pvUci),
      evalCp: line.evalCp,
      evalMate: line.evalMate,
      nodes: null,
      timeMs: params.timeMs,
    };
  });
}

export async function processAutoAnnotationJob(params: ProcessAutoAnnotationJobParams): Promise<void> {
  const jobRow = await params.pool.query<{
    id: number | string;
    user_id: number | string;
    game_id: number | string;
    status: string;
    cancel_requested: boolean;
    engine: string;
    depth: number | null;
    time_ms: number | null;
    overwrite_existing: boolean;
    starting_fen: string | null;
    move_tree: Record<string, unknown>;
    schema_version: number | null;
    annotations: Record<string, unknown> | null;
    move_notes: Record<string, ExistingMoveNote> | null;
  }>(
    `SELECT
      j.id,
      j.user_id,
      j.game_id,
      j.status,
      j.cancel_requested,
      j.engine,
      j.depth,
      j.time_ms,
      j.overwrite_existing,
      g.starting_fen,
      gm.move_tree,
      ua.schema_version,
      ua.annotations,
      ua.move_notes
     FROM auto_annotation_jobs j
     JOIN games g ON g.id = j.game_id
     JOIN game_moves gm ON gm.game_id = g.id
     LEFT JOIN user_annotations ua
       ON ua.game_id = g.id
      AND ua.user_id = j.user_id
     WHERE j.id = $1`,
    [params.autoAnnotationJobId]
  );

  if (!jobRow.rowCount) {
    throw new Error(`Auto annotation job ${params.autoAnnotationJobId} not found`);
  }

  const job = jobRow.rows[0];
  if (toId(job.user_id) !== params.userId) {
    throw new Error(`Auto annotation job user mismatch for ${params.autoAnnotationJobId}`);
  }

  if (job.cancel_requested || job.status === "cancelled") {
    await params.pool.query(
      `UPDATE auto_annotation_jobs
       SET status = 'cancelled',
           updated_at = NOW()
       WHERE id = $1`,
      [params.autoAnnotationJobId]
    );
    return;
  }

  await params.pool.query(
    `UPDATE auto_annotation_jobs
     SET status = 'running',
         processed_plies = 0,
         annotated_plies = 0,
         error_message = NULL,
         updated_at = NOW()
     WHERE id = $1`,
    [params.autoAnnotationJobId]
  );

  const timeline = buildTimeline(job.starting_fen, extractMainlineSans(job.move_tree ?? {}));
  const moveNotes: Record<string, ExistingMoveNote> = { ...(job.move_notes ?? {}) };
  let processedPlies = 0;
  let annotatedPlies = 0;

  try {
    for (const entry of timeline) {
      if (await isCancelled(params.pool, params.autoAnnotationJobId)) {
        await params.pool.query(
          `UPDATE auto_annotation_jobs
           SET status = 'cancelled',
               processed_plies = $2,
               annotated_plies = $3,
               updated_at = NOW()
           WHERE id = $1`,
          [params.autoAnnotationJobId, processedPlies, annotatedPlies]
        );
        return;
      }

      const existing = moveNotes[String(entry.notePly)];
      if (!job.overwrite_existing && hasExistingAnnotation(existing)) {
        processedPlies += 1;
        continue;
      }

      const currentLines = await loadAnalysis({
        pool: params.pool,
        userId: params.userId,
        fen: entry.currentFen,
        engine: job.engine,
        depth: job.depth,
        timeMs: job.time_ms,
        stockfishBinary: params.stockfishBinary,
        cancelPollMs: params.cancelPollMs,
        autoAnnotationJobId: params.autoAnnotationJobId,
        multipv: 3,
      });
      if (currentLines === null) {
        await params.pool.query(
          `UPDATE auto_annotation_jobs
           SET status = 'cancelled',
               processed_plies = $2,
               annotated_plies = $3,
               updated_at = NOW()
           WHERE id = $1`,
          [params.autoAnnotationJobId, processedPlies, annotatedPlies]
        );
        return;
      }

      const primary = currentLines[0] ?? null;
      const playedReply = await loadAnalysis({
        pool: params.pool,
        userId: params.userId,
        fen: entry.nextFen,
        engine: job.engine,
        depth: job.depth,
        timeMs: job.time_ms,
        stockfishBinary: params.stockfishBinary,
        cancelPollMs: params.cancelPollMs,
        autoAnnotationJobId: params.autoAnnotationJobId,
        multipv: 1,
      });
      if (playedReply === null) {
        await params.pool.query(
          `UPDATE auto_annotation_jobs
           SET status = 'cancelled',
               processed_plies = $2,
               annotated_plies = $3,
               updated_at = NOW()
           WHERE id = $1`,
          [params.autoAnnotationJobId, processedPlies, annotatedPlies]
        );
        return;
      }

      const playedEval = invertEvaluation(playedReply[0] ?? null);
      const bestScore = scoreForComparison(primary?.evalCp ?? null, primary?.evalMate ?? null);
      const playedScore = scoreForComparison(playedEval.evalCp, playedEval.evalMate);
      const classification = classifyLoss(bestScore - playedScore);

      if (classification && primary) {
        const bestMove = primary.pvSan[0] ?? primary.pvUci[0] ?? primary.pvSan[0] ?? null;
        const bestLine = describePv(entry.currentFen, primary.pvUci);
        const commentParts = [
          `[Auto] ${classification.label}.`,
          `${entry.playedSan} shifts the evaluation from ${formatEval(primary.evalCp, primary.evalMate)} to ${formatEval(playedEval.evalCp, playedEval.evalMate)}.`,
        ];
        if (bestMove && bestMove !== entry.playedSan) {
          commentParts.push(`Preferred move: ${bestMove}.`);
        }
        if (bestLine) {
          commentParts.push(`Engine line: ${bestLine}.`);
        }

        moveNotes[String(entry.notePly)] = {
          ...(existing ?? {}),
          comment: commentParts.join(" "),
          nags: classification.nags,
          variationNote: bestLine || existing?.variationNote,
        };
        annotatedPlies += 1;
      } else if (job.overwrite_existing && existing && hasExistingAnnotation(existing)) {
        moveNotes[String(entry.notePly)] = {
          ...(existing.highlights?.length ? { highlights: existing.highlights } : {}),
          ...(existing.arrows?.length ? { arrows: existing.arrows } : {}),
        };
      }

      processedPlies += 1;
      await params.pool.query(
        `UPDATE auto_annotation_jobs
         SET processed_plies = $2,
             annotated_plies = $3,
             updated_at = NOW()
         WHERE id = $1`,
        [params.autoAnnotationJobId, processedPlies, annotatedPlies]
      );
    }

    await params.pool.query(
      `INSERT INTO user_annotations (user_id, game_id, schema_version, annotations, move_notes)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
       ON CONFLICT (user_id, game_id)
       DO UPDATE SET
         schema_version = EXCLUDED.schema_version,
         annotations = EXCLUDED.annotations,
         move_notes = EXCLUDED.move_notes,
         updated_at = NOW()`,
      [
        params.userId,
        toId(job.game_id),
        Math.max(2, job.schema_version ?? 2),
        JSON.stringify(job.annotations ?? {}),
        JSON.stringify(moveNotes),
      ]
    );

    await params.pool.query(
      `UPDATE auto_annotation_jobs
       SET status = 'completed',
           processed_plies = $2,
           annotated_plies = $3,
           updated_at = NOW()
       WHERE id = $1`,
      [params.autoAnnotationJobId, processedPlies, annotatedPlies]
    );
  } catch (error) {
    await params.pool.query(
      `UPDATE auto_annotation_jobs
       SET status = 'failed',
           processed_plies = $2,
           annotated_plies = $3,
           error_message = $4,
           updated_at = NOW()
       WHERE id = $1`,
      [params.autoAnnotationJobId, processedPlies, annotatedPlies, String(error).slice(0, 1000)]
    );
    throw error;
  }
}
