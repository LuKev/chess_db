import type { PieceSymbol } from "chess.js";
import { addBasePath } from "../lib/basePath";

type ObjectPiece = {
  type: PieceSymbol;
  color: "w" | "b";
};

type ChessPieceProps = {
  piece: ObjectPiece | string | null | undefined;
};

type PieceSetName = "alpha" | "uscf" | "wikipedia";

const DEFAULT_PIECE_SET: PieceSetName = "alpha";
const PIECE_ASSET_ROOT = addBasePath("/pieces");

const PIECE_CODES = new Set(["wP", "wN", "wB", "wR", "wQ", "wK", "bP", "bN", "bB", "bR", "bQ", "bK"]);

function normalizePieceCode(piece: ChessPieceProps["piece"]): string | null {
  if (!piece) {
    return null;
  }

  if (typeof piece === "string") {
    const trimmed = piece.trim();
    if (!trimmed) {
      return null;
    }

    if (PIECE_CODES.has(trimmed)) {
      return trimmed;
    }

    if (trimmed.length !== 1 || !/[prnbqkPRNBQK]/.test(trimmed)) {
      return null;
    }

    const color = trimmed === trimmed.toUpperCase() ? "w" : "b";
    return `${color}${trimmed.toUpperCase()}`;
  }

  return `${piece.color}${piece.type.toUpperCase()}`;
}

export function ChessPiece(props: ChessPieceProps) {
  const pieceCode = normalizePieceCode(props.piece);

  if (!pieceCode) {
    return null;
  }

  return (
    <img
      alt=""
      aria-hidden="true"
      className="piece-image"
      draggable={false}
      height={45}
      loading="eager"
      src={`${PIECE_ASSET_ROOT}/${DEFAULT_PIECE_SET}/${pieceCode}.png`}
      width={45}
    />
  );
}
