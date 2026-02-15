"use client";

import { Chess, type PieceSymbol } from "chess.js";
import Link from "next/link";
import { useMemo, useState } from "react";

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

const DemoPgnText = [
  `[Event "World Chess Championship 1985"]`,
  `[Site "Moscow URS"]`,
  `[Date "1985.10.15"]`,
  `[Round "16"]`,
  `[White "Karpov, Anatoly"]`,
  `[Black "Kasparov, Garry"]`,
  `[Result "0-1"]`,
  `[ECO "B44"]`,
  ``,
  `1. e4 c5 2. Nf3 e6 3. d4 cxd4 4. Nxd4 Nc6 5. Nb5 d6 6. c4 Nf6 7. N1c3 a6 8. Na3 d5 9. cxd5 exd5 10. exd5 Nb4 11. Be2 Bc5 12. O-O O-O 13. Bf3 Bf5 14. Bg5 Re8 15. Qd2 b5 16. Rad1 Nd3 17. Nab1 h6 18. Bh4 b4 19. Na4 Bd6 20. Bg3 Rc8 21. b3 g5 22. Bxd6 Qxd6 23. g3 Nd7 24. Bg2 Qf6 25. a3 a5 26. axb4 axb4 27. Qa2 Bg6 28. d6 g4 29. Qd2 Kg7 30. f3 Qxd6 31. fxg4 Qd4+ 32. Kh1 Nf6 33. Rf4 Ne4 34. Qxd3 Nf2+ 35. Rxf2 Bxd3 36. Rfd2 Qe3 37. Rxd3 Rc1 38. Nb2 Qf2 39. Nd2 Rxd1+ 40. Nxd1 Re1+ 0-1`,
].join("\n");

export default function ViewerDemoPage() {
  const [cursor, setCursor] = useState(0);

  const derived = useMemo(() => {
    const chess = new Chess();
    chess.loadPgn(DemoPgnText);
    const history = chess.history();

    const replay = new Chess();
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
      rows: buildNotationRows(history),
      fens,
      safeCursor,
      board: buildBoard(cursorChess),
      fen: fens[safeCursor] ?? "",
    };
  }, [cursor]);

  return (
    <main>
      <section className="card">
        <div className="section-head">
          <h2>Viewer Demo</h2>
          <div className="button-row">
            <Link href="/login">Login</Link>
          </div>
        </div>
        <p className="muted">
          This page is API-free and exists to debug viewer UI (board sizing, notation layout, etc.).
        </p>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Board + Notation</h2>
          <div className="button-row">
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
        </div>

        <div className="viewer-grid">
          <div>
            <div className="board" data-testid="viewer-demo-board">
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
            </div>
            <h3>PGN</h3>
            <pre className="pgn-pre">{DemoPgnText}</pre>
          </div>
        </div>
      </section>
    </main>
  );
}

