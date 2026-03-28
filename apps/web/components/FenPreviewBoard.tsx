"use client";

import { Chess, type PieceSymbol } from "chess.js";
import { ChessPiece } from "./ChessPiece";

type BoardSquare = {
  square: string;
  piece: { type: PieceSymbol; color: "w" | "b" } | null;
};

function buildBoard(chess: Chess): BoardSquare[][] {
  const board = chess.board();
  return board.map((rank, rankIndex) =>
    rank.map((piece, fileIndex) => {
      const square = `${"abcdefgh"[fileIndex]}${8 - rankIndex}`;
      return {
        square,
        piece: piece ? { type: piece.type, color: piece.color } : null,
      };
    })
  );
}

function toChessFen(fen: string): string | undefined {
  const trimmed = fen.trim();
  if (!trimmed || trimmed === "startpos") {
    return undefined;
  }
  const fields = trimmed.split(/\s+/);
  if (fields.length === 4) {
    return `${trimmed} 0 1`;
  }
  return trimmed;
}

export function FenPreviewBoard(props: { fen: string; title?: string }) {
  const rawFen = props.fen.trim();
  const initialFen = toChessFen(rawFen);

  try {
    const chess = new Chess(initialFen);
    const board = buildBoard(chess);

    return (
      <div>
        {props.title ? <h3>{props.title}</h3> : null}
        <div className="board">
          {board.map((rank, rankIndex) => (
            <div key={`rank-${rankIndex}`} className="board-rank">
              {rank.map((sq) => (
                <div
                  key={sq.square}
                  className={`square ${(rankIndex + "abcdefgh".indexOf(sq.square[0]!)) % 2 === 0 ? "light" : "dark"}`}
                  title={sq.square}
                >
                  <ChessPiece piece={sq.piece} />
                </div>
              ))}
            </div>
          ))}
        </div>
        <p className="muted">Turn: {chess.turn() === "w" ? "White" : "Black"}</p>
        <p className="muted muted-small" style={{ wordBreak: "break-word" }}>
          {chess.fen()}
        </p>
      </div>
    );
  } catch (error) {
    return <p className="muted">Invalid FEN preview: {String(error)}</p>;
  }
}
