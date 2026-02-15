"use client";

import { Chess, type PieceSymbol } from "chess.js";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "../lib/api";
import { extractMainlineSans } from "../lib/chess/moveTree";

type GameDetail = {
  id: number;
  white: string;
  black: string;
  result: string;
  event: string | null;
  site: string | null;
  eco: string | null;
  date: string | null;
  plyCount: number | null;
  startingFen: string | null;
  whiteElo: number | null;
  blackElo: number | null;
  pgn: string;
  moveTree: Record<string, unknown>;
};

type BoardSquare = {
  square: string;
  piece: { type: PieceSymbol; color: "w" | "b" } | null;
};

function pieceToSymbol(piece: { type: PieceSymbol; color: "w" | "b" } | null): string {
  if (!piece) {
    return "";
  }
  const key = `${piece.color}${piece.type}`;
  const map: Record<string, string> = {
    wp: "♙",
    wn: "♘",
    wb: "♗",
    wr: "♖",
    wq: "♕",
    wk: "♔",
    bp: "♟",
    bn: "♞",
    bb: "♝",
    br: "♜",
    bq: "♛",
    bk: "♚",
  };
  return map[key] ?? "";
}

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

type NotationRow = {
  moveNo: number;
  white: { san: string; cursor: number } | null;
  black: { san: string; cursor: number } | null;
};

function buildNotationRows(history: string[]): NotationRow[] {
  const rows: NotationRow[] = [];
  for (let i = 0; i < history.length; i += 2) {
    rows.push({
      moveNo: Math.floor(i / 2) + 1,
      white: history[i] ? { san: history[i]!, cursor: i + 1 } : null,
      black: history[i + 1] ? { san: history[i + 1]!, cursor: i + 2 } : null,
    });
  }
  return rows;
}

export function GameViewerPanel(props: { gameId: number; onClose?: () => void }) {
  const { gameId, onClose } = props;
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    setCursor(0);
  }, [gameId]);

  const game = useQuery({
    queryKey: ["game", { gameId }],
    enabled: Number.isFinite(gameId) && gameId > 0,
    queryFn: async (): Promise<GameDetail> => {
      const response = await fetchJson<GameDetail>(`/api/games/${gameId}`, { method: "GET" });
      if (response.status === 200 && "id" in response.data) {
        return response.data;
      }
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to load game (status ${response.status})`;
      throw new Error(msg);
    },
  });

  const derived = useMemo(() => {
    const startingFen = game.data?.startingFen ?? "startpos";
    const moveSans = extractMainlineSans(game.data?.moveTree);

    const replay = new Chess(startingFen && startingFen !== "startpos" ? startingFen : undefined);
    const fens: string[] = [replay.fen()];
    const appliedSans: string[] = [];
    for (const san of moveSans) {
      const move = replay.move(san, { strict: false });
      if (!move) {
        break;
      }
      appliedSans.push(san);
      fens.push(replay.fen());
    }

    const safeCursor = Math.max(0, Math.min(cursor, Math.max(0, fens.length - 1)));
    const cursorChess = new Chess();
    cursorChess.load(fens[safeCursor]!);

    return {
      history: appliedSans,
      rows: buildNotationRows(appliedSans),
      fens,
      safeCursor,
      board: buildBoard(cursorChess),
      fen: fens[safeCursor] ?? "",
    };
  }, [cursor, game.data?.startingFen, game.data?.moveTree]);

  return (
    <section className="card games-viewer">
      <div className="section-head">
        <h2>Viewer</h2>
        <div className="button-row">
          <Link href={`/games/${gameId}`}>Open page</Link>
          {onClose ? (
            <button type="button" onClick={onClose}>
              Close
            </button>
          ) : null}
        </div>
      </div>

      {game.isLoading ? <p className="muted">Loading game...</p> : null}
      {game.isError ? <p className="muted">Error: {String(game.error)}</p> : null}
      {game.data ? (
        <p className="muted">
          #{game.data.id}: {game.data.white} vs {game.data.black} ({game.data.result})
          {game.data.eco ? ` · ${game.data.eco}` : ""}
        </p>
      ) : null}

      <div className="viewer-grid">
        <div>
          <div className="button-row button-row-top">
            <button type="button" onClick={() => setCursor(0)} disabled={derived.safeCursor <= 0}>
              |&lt;
            </button>
            <button type="button" onClick={() => setCursor((v) => Math.max(0, v - 1))} disabled={derived.safeCursor <= 0}>
              &lt;
            </button>
            <button
              type="button"
              onClick={() => setCursor((v) => Math.min(derived.fens.length - 1, v + 1))}
              disabled={derived.safeCursor >= derived.fens.length - 1}
            >
              &gt;
            </button>
            <button
              type="button"
              onClick={() => setCursor(Math.max(0, derived.fens.length - 1))}
              disabled={derived.safeCursor >= derived.fens.length - 1}
            >
              &gt;|
            </button>
          </div>

          <div className="board">
            {derived.board.map((rank, rankIndex) => (
              <div key={`rank-${rankIndex}`} className="board-rank">
                {rank.map((sq) => (
                  <div
                    key={sq.square}
                    className={`square ${(rankIndex + "abcdefgh".indexOf(sq.square[0]!)) % 2 === 0 ? "light" : "dark"}`}
                    title={sq.square}
                  >
                    {pieceToSymbol(sq.piece)}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <p className="muted">
            Ply: {derived.safeCursor}/{Math.max(0, derived.fens.length - 1)}
          </p>
          <p className="muted muted-small" style={{ wordBreak: "break-word" }}>
            {derived.fen}
          </p>
        </div>

        <div>
          <h3>Notation</h3>
          <div className="notation-bar" role="list">
            {derived.rows.map((row) => (
              <div key={row.moveNo} className="notation-row" role="listitem">
                <span className="notation-no">{row.moveNo}.</span>
                <button
                  type="button"
                  className={row.white && derived.safeCursor === row.white.cursor ? "active" : undefined}
                  onClick={() => row.white && setCursor(row.white.cursor)}
                  disabled={!row.white}
                >
                  {row.white?.san ?? ""}
                </button>
                <button
                  type="button"
                  className={row.black && derived.safeCursor === row.black.cursor ? "active" : undefined}
                  onClick={() => row.black && setCursor(row.black.cursor)}
                  disabled={!row.black}
                >
                  {row.black?.san ?? ""}
                </button>
              </div>
            ))}
            {derived.rows.length === 0 ? <p className="muted">No moves parsed.</p> : null}
          </div>
        </div>
      </div>
    </section>
  );
}
