import { createHash } from "node:crypto";

type ParsedMove = {
  notation?: {
    notation?: string;
  };
};

type ParsedGame = {
  tags?: Record<string, unknown>;
  moves?: unknown[];
};

export type NormalizedGame = {
  white: string;
  whiteNorm: string;
  black: string;
  blackNorm: string;
  result: string;
  event: string | null;
  eventNorm: string | null;
  site: string | null;
  eco: string | null;
  timeControl: string | null;
  rated: boolean | null;
  playedOn: string | null;
  plyCount: number | null;
  startingFen: string | null;
  movesHash: string;
  moveTree: Record<string, unknown>;
  source: string | null;
  license: string | null;
};

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function sanitizeTag(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parsePgnDate(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const match = value.match(/^(\d{4})\.(\d{2})\.(\d{2})$/);
  if (!match) {
    return null;
  }

  const [year, month, day] = [match[1], match[2], match[3]];
  if (year.includes("?") || month.includes("?") || day.includes("?")) {
    return null;
  }

  const iso = `${year}-${month}-${day}`;
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf())) {
    return null;
  }

  return iso;
}

function parseRated(value: unknown): boolean | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "1"].includes(normalized)) {
    return true;
  }
  if (["false", "no", "0"].includes(normalized)) {
    return false;
  }
  return null;
}

function parsePlyCount(value: unknown, fallbackLength: number): number | null {
  if (typeof value !== "string") {
    return fallbackLength > 0 ? fallbackLength : null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return fallbackLength > 0 ? fallbackLength : null;
  }

  return parsed;
}

function isParsedMove(value: unknown): value is ParsedMove {
  if (!value || typeof value !== "object") {
    return false;
  }

  const maybeMove = value as ParsedMove;
  if (!maybeMove.notation) {
    return false;
  }

  return typeof maybeMove.notation.notation === "string";
}

function extractMainlineSan(moves: unknown[]): string[] {
  return moves
    .filter(isParsedMove)
    .map((move) => move.notation?.notation)
    .filter((value): value is string => Boolean(value));
}

function buildMovesHash(params: {
  startingFen: string | null;
  result: string;
  mainlineSan: string[];
}): string {
  return createHash("sha256")
    .update(params.startingFen ?? "startpos")
    .update("\n")
    .update(params.mainlineSan.join(" "))
    .update("\n")
    .update(params.result)
    .digest("hex");
}

export function normalizeParsedGame(parsedGame: ParsedGame): NormalizedGame {
  const tags = parsedGame.tags ?? {};
  const moves = Array.isArray(parsedGame.moves) ? parsedGame.moves : [];
  const white = sanitizeTag(tags.White) ?? "Unknown White";
  const black = sanitizeTag(tags.Black) ?? "Unknown Black";
  const result = sanitizeTag(tags.Result) ?? "*";
  const event = sanitizeTag(tags.Event);
  const site = sanitizeTag(tags.Site);
  const eco = sanitizeTag(tags.ECO);
  const timeControl = sanitizeTag(tags.TimeControl);
  const startingFen = sanitizeTag(tags.FEN);
  const source = sanitizeTag(tags.Source);
  const license = sanitizeTag(tags.License);
  const mainlineSan = extractMainlineSan(moves);

  return {
    white,
    whiteNorm: normalizeText(white),
    black,
    blackNorm: normalizeText(black),
    result,
    event,
    eventNorm: event ? normalizeText(event) : null,
    site,
    eco,
    timeControl,
    rated: parseRated(tags.Rated),
    playedOn: parsePgnDate(tags.Date),
    plyCount: parsePlyCount(tags.PlyCount, moves.length),
    startingFen,
    movesHash: buildMovesHash({
      startingFen,
      mainlineSan,
      result,
    }),
    moveTree: {
      moves,
    },
    source,
    license,
  };
}
