import { Chess } from "chess.js";
import type { Pool, QueryResultRow } from "pg";
import { normalizeFen } from "../chess/fen.js";
import type { AnalysisLineResult } from "./stockfish.js";

export type PersistableAnalysisLine = {
  multipv: number;
  pvUci: string[];
  pvSan: string[];
  evalCp: number | null;
  evalMate: number | null;
  nodes: number | null;
  timeMs: number | null;
};

function parseUciMove(uci: string): { from: string; to: string; promotion?: "q" | "r" | "b" | "n" } | null {
  const trimmed = uci.trim().toLowerCase();
  const match = trimmed.match(/^([a-h][1-8])([a-h][1-8])([qrbn])?$/);
  if (!match) {
    return null;
  }

  return {
    from: match[1],
    to: match[2],
    promotion: match[3] as "q" | "r" | "b" | "n" | undefined,
  };
}

export function pvUciFromString(pv: string | null): string[] {
  if (!pv) {
    return [];
  }
  return pv
    .split(/\s+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(entry));
}

export function pvSanFromFen(fen: string, pvUci: string[]): string[] {
  const chess = new Chess();
  chess.load(fen);
  const san: string[] = [];

  for (const uci of pvUci) {
    const move = parseUciMove(uci);
    if (!move) {
      break;
    }
    const applied = chess.move(move);
    if (!applied) {
      break;
    }
    san.push(applied.san);
  }

  return san;
}

export function serializeResultLines(lines: AnalysisLineResult[]): Array<Record<string, unknown>> {
  return lines.map((line) => ({
    multipv: line.multipv,
    bestMove: line.bestMove,
    pv: line.pv,
    evalCp: line.evalCp,
    evalMate: line.evalMate,
  }));
}

export function persistableLinesFromAnalysis(
  fen: string,
  lines: AnalysisLineResult[],
  limits: { nodes: number | null; timeMs: number | null }
): PersistableAnalysisLine[] {
  return lines.map((line) => {
    const pvUci = pvUciFromString(line.pv);
    return {
      multipv: line.multipv,
      pvUci,
      pvSan: pvSanFromFen(fen, pvUci),
      evalCp: line.evalCp,
      evalMate: line.evalMate,
      nodes: limits.nodes,
      timeMs: limits.timeMs,
    };
  });
}

export async function replaceEngineLinesForPosition(params: {
  pool: Pool;
  userId: number;
  gameId: number;
  ply: number;
  fen: string;
  engine: string;
  depth: number | null;
  source: string;
  lines: PersistableAnalysisLine[];
}): Promise<number> {
  const fenNorm = normalizeFen(params.fen).fenNorm;

  await params.pool.query(
    `DELETE FROM engine_lines
     WHERE user_id = $1
       AND game_id = $2
       AND ply = $3
       AND engine = $4
       AND source = $5`,
    [params.userId, params.gameId, params.ply, params.engine, params.source]
  );

  for (const line of params.lines) {
    await params.pool.query(
      `INSERT INTO engine_lines (
        user_id,
        game_id,
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
        source
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8::text[], $9::text[], $10, $11, $12, $13, $14
      )`,
      [
        params.userId,
        params.gameId,
        params.ply,
        fenNorm,
        params.engine,
        params.depth,
        line.multipv,
        line.pvUci,
        line.pvSan,
        line.evalCp,
        line.evalMate,
        line.nodes,
        line.timeMs,
        params.source,
      ]
    );
  }

  return params.lines.length;
}

export async function loadCachedAnalysisLines<Row extends QueryResultRow>(params: {
  pool: Pool;
  userId: number;
  fenNorm: string;
  engine: string;
  depth: number | null;
  multipv: number;
  query: string;
  mapRow: (row: Row) => PersistableAnalysisLine;
}): Promise<PersistableAnalysisLine[]> {
  const result = await params.pool.query<Row>(params.query, [
    params.userId,
    params.fenNorm,
    params.engine,
    params.depth,
    params.multipv,
  ]);

  return result.rows.map((row) => params.mapRow(row));
}
