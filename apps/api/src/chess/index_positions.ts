import { Chess } from "chess.js";
import { normalizeFen } from "./fen.js";

export type IndexedPosition = {
  ply: number;
  fenNorm: string;
  stm: "w" | "b";
  castling: string;
  epSquare: string | null;
  halfmove: number;
  fullmove: number;
  materialKey: string;
  nextMoveUci: string | null;
  nextFenNorm: string | null;
};

function toUci(move: { from: string; to: string; promotion?: string }): string {
  return `${move.from}${move.to}${move.promotion ?? ""}`;
}

export function buildPositionIndex(
  startingFen: string | null,
  mainlineSans: string[]
): IndexedPosition[] {
  const initialFen =
    startingFen && startingFen !== "startpos"
      ? startingFen
      : undefined;
  const chess = new Chess(initialFen);
  const indexed: IndexedPosition[] = [];

  const initial = normalizeFen(chess.fen());
  indexed.push({
    ply: 0,
    fenNorm: initial.fenNorm,
    stm: initial.stm,
    castling: initial.castling,
    epSquare: initial.epSquare,
    halfmove: initial.halfmove,
    fullmove: initial.fullmove,
    materialKey: initial.materialKey,
    nextMoveUci: null,
    nextFenNorm: null,
  });

  for (let i = 0; i < mainlineSans.length; i += 1) {
    const move = chess.move(mainlineSans[i], { strict: false });
    if (!move) {
      break;
    }
    const after = normalizeFen(chess.fen());
    indexed[indexed.length - 1] = {
      ...indexed[indexed.length - 1],
      nextMoveUci: toUci(move),
      nextFenNorm: after.fenNorm,
    };

    indexed.push({
      ply: i + 1,
      fenNorm: after.fenNorm,
      stm: after.stm,
      castling: after.castling,
      epSquare: after.epSquare,
      halfmove: after.halfmove,
      fullmove: after.fullmove,
      materialKey: after.materialKey,
      nextMoveUci: null,
      nextFenNorm: null,
    });
  }

  return indexed;
}
