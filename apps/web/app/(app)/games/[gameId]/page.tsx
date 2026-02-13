"use client";

import { Chess, type PieceSymbol } from "chess.js";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchJson, fetchText } from "../../../../lib/api";

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

export default function GameViewerPage() {
  const params = useParams<{ gameId: string }>();
  const gameId = Number(params.gameId);
  const [cursor, setCursor] = useState(0);

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

  const pgn = useQuery({
    queryKey: ["game-pgn", { gameId }],
    enabled: Number.isFinite(gameId) && gameId > 0,
    queryFn: async (): Promise<string> => {
      const response = await fetchText(`/api/games/${gameId}/pgn`, { method: "GET" });
      if (response.status === 200) {
        return response.text;
      }
      return game.data?.pgn ?? "";
    },
  });

  const derived = useMemo(() => {
    const startingFen = game.data?.startingFen ?? "startpos";
    const pgnText = pgn.data ?? "";
    const chess = new Chess(startingFen && startingFen !== "startpos" ? startingFen : undefined);
    const loaded = pgnText.trim().length > 0 ? chess.loadPgn(pgnText) : false;
    const history = loaded ? chess.history() : [];

    const replay = new Chess(startingFen && startingFen !== "startpos" ? startingFen : undefined);
    const fens: string[] = [replay.fen()];
    for (const move of history) {
      replay.move(move);
      fens.push(replay.fen());
    }
    const safeCursor = Math.max(0, Math.min(cursor, Math.max(0, fens.length - 1)));
    const cursorChess = new Chess();
    cursorChess.load(fens[safeCursor]!);
    return {
      history,
      fens,
      safeCursor,
      board: buildBoard(cursorChess),
      fen: fens[safeCursor] ?? "",
    };
  }, [cursor, game.data?.startingFen, pgn.data]);

  async function copyFen(): Promise<void> {
    if (!derived.fen) {
      return;
    }
    try {
      await navigator.clipboard.writeText(derived.fen);
    } catch {
      // ignore
    }
  }

  return (
    <main>
      <section className="card">
        <div className="section-head">
          <h2>Game Viewer</h2>
          <div className="button-row">
            <Link href="/games">Back to games</Link>
            <Link href="/diagnostics">Diagnostics</Link>
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
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Board</h2>
          <div className="button-row">
            <button type="button" onClick={() => setCursor(0)} disabled={derived.safeCursor <= 0}>
              |&lt;
            </button>
            <button
              type="button"
              onClick={() => setCursor((v) => Math.max(0, v - 1))}
              disabled={derived.safeCursor <= 0}
            >
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
            <button type="button" onClick={() => void copyFen()} disabled={!derived.fen}>
              Copy FEN
            </button>
          </div>
        </div>

        <div className="viewer-grid">
          <div>
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
            <p className="muted" style={{ wordBreak: "break-word" }}>
              {derived.fen}
            </p>
          </div>

          <div>
            <h3>Moves</h3>
            <div className="notation-list">
              {derived.history.map((move, index) => (
                <button
                  key={`${move}-${index}`}
                  type="button"
                  className={derived.safeCursor === index + 1 ? "active" : undefined}
                  onClick={() => setCursor(index + 1)}
                >
                  {index + 1}. {move}
                </button>
              ))}
            </div>
            <h3>PGN</h3>
            <pre className="pgn-pre">{pgn.data ?? game.data?.pgn ?? ""}</pre>
          </div>
        </div>
      </section>
    </main>
  );
}

