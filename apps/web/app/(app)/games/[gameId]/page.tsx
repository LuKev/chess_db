"use client";

import { Chess, type PieceSymbol } from "chess.js";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson, fetchText } from "../../../../lib/api";
import { useToasts } from "../../../../components/ToastsProvider";
import { extractMainlineSans } from "../../../../lib/chess/moveTree";

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

type AnnotationResponse = {
  gameId: number;
  schemaVersion: number;
  annotations: Record<string, unknown>;
  moveNotes: Record<string, unknown>;
};

type EngineLine = {
  id: number;
  ply: number;
  fenNorm: string;
  engine: string;
  depth: number | null;
  multipv: number | null;
  pvUci: string[];
  pvSan: string[];
  evalCp: number | null;
  evalMate: number | null;
  nodes: number | null;
  timeMs: number | null;
  source: string;
  createdAt: string;
};

type EngineLinesResponse = {
  gameId: number;
  items: EngineLine[];
};

type AnalysisCreateResponse = {
  id: number;
  status: string;
  cached?: boolean;
  idempotentReplay?: boolean;
};

type AnalysisStatusResponse = {
  id: number;
  status: string;
  fen: string;
  limits: {
    depth: number | null;
    nodes: number | null;
    timeMs: number | null;
  };
  result: {
    bestMove: string | null;
    pv: string | null;
    evalCp: number | null;
    evalMate: number | null;
  };
  error: string | null;
  createdAt: string;
  updatedAt: string;
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

function buildNotationRows(sans: string[]): NotationRow[] {
  const rows: NotationRow[] = [];
  for (let i = 0; i < sans.length; i += 2) {
    rows.push({
      moveNo: Math.floor(i / 2) + 1,
      white: sans[i] ? { san: sans[i]!, cursor: i + 1 } : null,
      black: sans[i + 1] ? { san: sans[i + 1]!, cursor: i + 2 } : null,
    });
  }
  return rows;
}

export default function GameViewerPage() {
  const params = useParams<{ gameId: string }>();
  const gameId = Number(params.gameId);
  const [cursor, setCursor] = useState(0);
  const queryClient = useQueryClient();
  const toasts = useToasts();

  const [rootComment, setRootComment] = useState("");
  const [annotationStatus, setAnnotationStatus] = useState("Load annotations to start.");
  const [annotationDirty, setAnnotationDirty] = useState(false);
  const [analysisDepth, setAnalysisDepth] = useState(18);
  const [analysisRequestId, setAnalysisRequestId] = useState<number | null>(null);
  const [analysisStatus, setAnalysisStatus] = useState<string>("No analysis request yet.");
  const [analysisResult, setAnalysisResult] = useState<AnalysisStatusResponse | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const parsed = new URLSearchParams(window.location.search);
    const plyRaw = parsed.get("ply");
    if (!plyRaw) {
      return;
    }
    const ply = Number(plyRaw);
    if (Number.isInteger(ply) && ply >= 0) {
      setCursor(ply);
    }
  }, []);

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

  const annotations = useQuery({
    queryKey: ["annotations", { gameId }],
    enabled: Number.isFinite(gameId) && gameId > 0,
    queryFn: async (): Promise<AnnotationResponse> => {
      const response = await fetchJson<AnnotationResponse>(`/api/games/${gameId}/annotations`, { method: "GET" });
      if (response.status === 200 && "annotations" in response.data) {
        return response.data;
      }
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to load annotations (status ${response.status})`;
      throw new Error(msg);
    },
  });

  useEffect(() => {
    if (!annotations.data || annotationDirty) {
      return;
    }
    const existing = annotations.data.annotations;
    const comment = typeof existing.comment === "string" ? existing.comment : "";
    setRootComment(comment);
    setAnnotationStatus("Annotations loaded.");
  }, [annotations.data, annotationDirty]);

  const engineLines = useQuery({
    queryKey: ["engine-lines", { gameId, ply: cursor }],
    enabled: Number.isFinite(gameId) && gameId > 0,
    queryFn: async (): Promise<EngineLinesResponse> => {
      const response = await fetchJson<EngineLinesResponse>(`/api/games/${gameId}/engine-lines?ply=${cursor}`, {
        method: "GET",
      });
      if (response.status === 200 && "items" in response.data) {
        return response.data;
      }
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to load engine lines (status ${response.status})`;
      throw new Error(msg);
    },
  });

  useEffect(() => {
    if (!analysisRequestId) {
      return;
    }

    let stopped = false;
    setAnalysisStatus(`Polling analysis #${analysisRequestId}...`);

    const interval = setInterval(() => {
      if (stopped) {
        return;
      }
      void (async () => {
        const response = await fetchJson<AnalysisStatusResponse>(`/api/analysis/${analysisRequestId}`, {
          method: "GET",
        });
        if (response.status !== 200 || !("status" in response.data)) {
          setAnalysisStatus(
            "error" in response.data && response.data.error
              ? response.data.error
              : `Failed to poll analysis (status ${response.status})`
          );
          return;
        }
        setAnalysisResult(response.data);
        const status = response.data.status;
        if (status === "completed") {
          setAnalysisStatus("Analysis completed.");
          stopped = true;
        } else if (status === "failed") {
          setAnalysisStatus(`Analysis failed: ${response.data.error ?? "unknown error"}`);
          stopped = true;
        } else if (status === "cancelled") {
          setAnalysisStatus("Analysis cancelled.");
          stopped = true;
        } else {
          setAnalysisStatus(`Analysis ${status}...`);
        }
      })();
    }, 1000);

    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [analysisRequestId]);

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

  async function runAnalysis(): Promise<void> {
    if (!derived.fen) {
      return;
    }
    setAnalysisStatus("Queueing analysis...");
    setAnalysisResult(null);
    const response = await fetchJson<AnalysisCreateResponse>("/api/analysis", {
      method: "POST",
      body: JSON.stringify({
        fen: derived.fen,
        depth: analysisDepth,
      }),
    });
    if ((response.status !== 201 && response.status !== 200) || !("id" in response.data)) {
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to queue analysis (status ${response.status})`;
      setAnalysisStatus(msg);
      toasts.pushToast({ kind: "error", message: msg });
      return;
    }
    setAnalysisRequestId(response.data.id);
    setAnalysisStatus(`Queued analysis #${response.data.id}`);
  }

  async function cancelAnalysis(): Promise<void> {
    if (!analysisRequestId) {
      return;
    }
    const response = await fetchJson<{ id: number; status: string }>(`/api/analysis/${analysisRequestId}/cancel`, {
      method: "POST",
    });
    if (response.status !== 200 || !("status" in response.data)) {
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to cancel analysis (status ${response.status})`;
      setAnalysisStatus(msg);
      toasts.pushToast({ kind: "error", message: msg });
      return;
    }
    setAnalysisStatus(`Cancel requested (status: ${response.data.status}).`);
  }

  async function saveAnalysisLine(): Promise<void> {
    if (!analysisResult || analysisResult.status !== "completed") {
      return;
    }
    const pvUci = analysisResult.result.pv ? analysisResult.result.pv.split(/\s+/g).filter(Boolean) : [];
    const response = await fetchJson<{ id: number; createdAt: string }>("/api/analysis/store", {
      method: "POST",
      body: JSON.stringify({
        gameId,
        ply: cursor,
        fen: analysisResult.fen,
        engine: "stockfish",
        depth: analysisResult.limits.depth ?? analysisDepth,
        multipv: 1,
        pvUci,
        pvSan: [],
        evalCp: analysisResult.result.evalCp ?? undefined,
        evalMate: analysisResult.result.evalMate ?? undefined,
        nodes: analysisResult.limits.nodes ?? undefined,
        timeMs: analysisResult.limits.timeMs ?? undefined,
        source: "manual",
      }),
    });
    if (response.status !== 201) {
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to store line (status ${response.status})`;
      toasts.pushToast({ kind: "error", message: msg });
      return;
    }
    toasts.pushToast({ kind: "success", message: "Saved engine line" });
    await queryClient.invalidateQueries({ queryKey: ["engine-lines", { gameId, ply: cursor }] });
  }

  async function saveAnnotations(): Promise<void> {
    if (!annotations.data) {
      return;
    }
    setAnnotationStatus("Saving...");
    const response = await fetchJson<AnnotationResponse>(`/api/games/${gameId}/annotations`, {
      method: "PUT",
      body: JSON.stringify({
        schemaVersion: Math.max(2, annotations.data.schemaVersion ?? 2),
        annotations: {
          ...(annotations.data.annotations ?? {}),
          comment: rootComment,
          cursor,
        },
        moveNotes: annotations.data.moveNotes ?? {},
      }),
    });

    if (response.status !== 200 || !("annotations" in response.data)) {
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to save annotations (status ${response.status})`;
      setAnnotationStatus(msg);
      toasts.pushToast({ kind: "error", message: msg });
      return;
    }

    setAnnotationDirty(false);
    setAnnotationStatus(`Saved at ${new Date().toLocaleTimeString()}`);
    toasts.pushToast({ kind: "success", message: "Annotations saved" });
    await queryClient.invalidateQueries({ queryKey: ["annotations", { gameId }] });
  }

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
            <h3>PGN</h3>
            <pre className="pgn-pre">{pgn.data ?? game.data?.pgn ?? ""}</pre>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Annotations</h2>
          <div className="button-row">
            <button
              type="button"
              onClick={() => void saveAnnotations()}
              disabled={!annotationDirty || annotations.isLoading || annotations.isError}
            >
              Save
            </button>
            <button type="button" onClick={() => void annotations.refetch()} disabled={annotations.isFetching}>
              Refresh
            </button>
          </div>
        </div>

        {annotations.isLoading ? <p className="muted">Loading annotations...</p> : null}
        {annotations.isError ? <p className="muted">Error: {String(annotations.error)}</p> : null}
        <label>
          Game notes
          <textarea
            rows={6}
            value={rootComment}
            onChange={(event) => {
              setRootComment(event.target.value);
              setAnnotationDirty(true);
            }}
            placeholder="Write comments about this game..."
          />
        </label>
        <p className="muted">{annotationStatus}</p>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Saved Engine Lines (This Ply)</h2>
          <div className="button-row">
            <button type="button" onClick={() => void engineLines.refetch()} disabled={engineLines.isFetching}>
              Refresh
            </button>
          </div>
        </div>
        {engineLines.isLoading ? <p className="muted">Loading engine lines...</p> : null}
        {engineLines.isError ? <p className="muted">Error: {String(engineLines.error)}</p> : null}
        {engineLines.data ? (
          <div className="table-wrap">
            <table style={{ minWidth: 900 }}>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Engine</th>
                  <th>Depth</th>
                  <th>Eval</th>
                  <th>PV (SAN)</th>
                  <th>Source</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {engineLines.data.items.map((line) => (
                  <tr key={line.id}>
                    <td>{line.id}</td>
                    <td>{line.engine}</td>
                    <td>{line.depth ?? "-"}</td>
                    <td>
                      {line.evalMate !== null
                        ? `#${line.evalMate}`
                        : line.evalCp !== null
                          ? `${(line.evalCp / 100).toFixed(2)}`
                          : "-"}
                    </td>
                    <td style={{ maxWidth: 420 }}>
                      {line.pvSan?.length ? line.pvSan.join(" ") : line.pvUci.join(" ")}
                    </td>
                    <td>{line.source}</td>
                    <td>{new Date(line.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
                {engineLines.data.items.length === 0 ? (
                  <tr>
                    <td colSpan={7}>No saved lines at this ply.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Analysis</h2>
          <div className="button-row">
            <button type="button" onClick={() => void runAnalysis()} disabled={!derived.fen}>
              Run analysis
            </button>
            <button type="button" onClick={() => void cancelAnalysis()} disabled={!analysisRequestId}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void saveAnalysisLine()}
              disabled={!analysisResult || analysisResult.status !== "completed"}
            >
              Save line
            </button>
          </div>
        </div>

        <div className="auth-grid">
          <label>
            Depth
            <input
              value={String(analysisDepth)}
              onChange={(event) => setAnalysisDepth(Number(event.target.value))}
              placeholder="18"
            />
          </label>
          <label>
            Current FEN
            <input value={derived.fen} readOnly />
          </label>
        </div>

        <p className="muted">{analysisStatus}</p>
        {analysisResult ? (
          <pre className="pgn-pre">{JSON.stringify(analysisResult.result, null, 2)}</pre>
        ) : null}
      </section>
    </main>
  );
}
