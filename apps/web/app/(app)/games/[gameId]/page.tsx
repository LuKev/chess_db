"use client";

import { Chess, type PieceSymbol } from "chess.js";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson, fetchText } from "../../../../lib/api";
import { ChessPiece } from "../../../../components/ChessPiece";
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

type MoveNoteDraft = {
  comment: string;
  nagsText: string;
  highlightsText: string;
  arrowsText: string;
  variationNote: string;
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
  engine: string;
  multipv: number;
  context: {
    gameId: number | null;
    ply: number | null;
    autoStore: boolean;
    source: string;
  };
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
    lines: Array<{
      multipv: number;
      bestMove: string | null;
      pv: string | null;
      evalCp: number | null;
      evalMate: number | null;
    }>;
  };
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

type GameAnalysisJob = {
  id: number;
  status: string;
  engine: string;
  depth: number | null;
  nodes: number | null;
  timeMs: number | null;
  multipv: number;
  startPly: number;
  endPly: number | null;
  processedPositions: number;
  storedLines: number;
  cancelRequested: boolean;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

type GameAnalysisJobsResponse = {
  gameId: number;
  items: GameAnalysisJob[];
};

type AutoAnnotationJob = {
  id: number;
  status: string;
  engine: string;
  depth: number | null;
  timeMs: number | null;
  processedPlies: number;
  annotatedPlies: number;
  overwriteExisting: boolean;
  cancelRequested: boolean;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

type AutoAnnotationJobsResponse = {
  gameId: number;
  items: AutoAnnotationJob[];
};

type RepertoireItem = {
  id: number;
  name: string;
  description: string | null;
  orientation: "white" | "black" | "either";
  entryCount: number;
  practicedCount: number;
  isPublic: boolean;
  shareToken: string;
};

type RepertoireListResponse = {
  items: RepertoireItem[];
};

type BoardSquare = {
  square: string;
  piece: { type: PieceSymbol; color: "w" | "b" } | null;
};

type BoardArrow = {
  from: string;
  to: string;
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

function parseTextList(value: string): string[] {
  return value
    .split(/[,\s]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseMoveNote(raw: unknown): MoveNoteDraft {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const nags = Array.isArray(value.nags)
    ? value.nags.filter((entry): entry is number => typeof entry === "number" && Number.isInteger(entry))
    : [];
  const highlights = Array.isArray(value.highlights)
    ? value.highlights.filter((entry): entry is string => typeof entry === "string")
    : [];
  const arrows = Array.isArray(value.arrows)
    ? value.arrows.filter((entry): entry is string => typeof entry === "string")
    : [];
  return {
    comment: typeof value.comment === "string" ? value.comment : "",
    nagsText: nags.join(", "),
    highlightsText: highlights.join(" "),
    arrowsText: arrows.join(" "),
    variationNote: typeof value.variationNote === "string" ? value.variationNote : "",
  };
}

function emptyMoveNote(): MoveNoteDraft {
  return {
    comment: "",
    nagsText: "",
    highlightsText: "",
    arrowsText: "",
    variationNote: "",
  };
}

function serializeMoveNote(draft: MoveNoteDraft): Record<string, unknown> | null {
  const nags = parseTextList(draft.nagsText)
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= 255);
  const highlights = parseTextList(draft.highlightsText).filter((value) => /^[a-h][1-8]$/i.test(value));
  const arrows = parseTextList(draft.arrowsText).filter((value) => /^[a-h][1-8][a-h][1-8]$/i.test(value));
  const next = {
    comment: draft.comment.trim(),
    nags,
    highlights: highlights.map((value) => value.toLowerCase()),
    arrows: arrows.map((value) => value.toLowerCase()),
    variationNote: draft.variationNote.trim(),
  };

  if (!next.comment && next.nags.length === 0 && next.highlights.length === 0 && next.arrows.length === 0 && !next.variationNote) {
    return null;
  }

  return next;
}

function formatEval(evalCp: number | null, evalMate: number | null): string {
  if (evalMate !== null) {
    return `#${evalMate}`;
  }
  if (evalCp !== null) {
    return (evalCp / 100).toFixed(2);
  }
  return "-";
}

function parseBoardArrows(values: string[]): BoardArrow[] {
  return values
    .map((value) => value.trim().toLowerCase())
    .filter((value) => /^[a-h][1-8][a-h][1-8]$/.test(value))
    .map((value) => ({
      from: value.slice(0, 2),
      to: value.slice(2, 4),
    }));
}

function squareCenter(square: string): { x: number; y: number } {
  const file = "abcdefgh".indexOf(square[0] ?? "");
  const rank = Number(square[1] ?? "0");
  return {
    x: file * 12.5 + 6.25,
    y: (8 - rank) * 12.5 + 6.25,
  };
}

function pvSanText(fen: string, pv: string | null): string {
  if (!pv) {
    return "-";
  }
  try {
    const chess = new Chess();
    chess.load(fen);
    const san: string[] = [];
    for (const token of pv.split(/\s+/g).filter(Boolean)) {
      const match = token.trim().toLowerCase().match(/^([a-h][1-8])([a-h][1-8])([qrbn])?$/);
      if (!match) {
        break;
      }
      const move = chess.move({
        from: match[1],
        to: match[2],
        promotion: match[3] as "q" | "r" | "b" | "n" | undefined,
      });
      if (!move) {
        break;
      }
      san.push(move.san);
    }
    return san.length > 0 ? san.join(" ") : pv;
  } catch {
    return pv;
  }
}

function uciFromSan(fen: string, san: string): string | null {
  try {
    const chess = new Chess();
    chess.load(fen);
    const move = chess.move(san, { strict: false });
    if (!move) {
      return null;
    }
    return `${move.from}${move.to}${move.promotion ?? ""}`.toLowerCase();
  } catch {
    return null;
  }
}

export default function GameViewerPage() {
  const params = useParams<{ gameId: string }>();
  const gameId = Number(params.gameId);
  const [cursor, setCursor] = useState(0);
  const queryClient = useQueryClient();
  const toasts = useToasts();

  const [rootComment, setRootComment] = useState("");
  const [moveNote, setMoveNote] = useState<MoveNoteDraft>(emptyMoveNote());
  const [annotationStatus, setAnnotationStatus] = useState("Load annotations to start.");
  const [annotationDirty, setAnnotationDirty] = useState(false);
  const [analysisDepth, setAnalysisDepth] = useState(18);
  const [analysisMultiPv, setAnalysisMultiPv] = useState(1);
  const [analysisRequestId, setAnalysisRequestId] = useState<number | null>(null);
  const [analysisStatus, setAnalysisStatus] = useState<string>("No analysis request yet.");
  const [analysisResult, setAnalysisResult] = useState<AnalysisStatusResponse | null>(null);
  const [gameAnalysisStartPly, setGameAnalysisStartPly] = useState(0);
  const [gameAnalysisEndPly, setGameAnalysisEndPly] = useState("");
  const [gameAnalysisStatus, setGameAnalysisStatus] = useState("No background game analysis yet.");
  const [autoAnnotationOverwrite, setAutoAnnotationOverwrite] = useState(false);
  const [autoAnnotationStatus, setAutoAnnotationStatus] = useState("No automated annotation job yet.");
  const [selectedRepertoireId, setSelectedRepertoireId] = useState<number | null>(null);

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
    setMoveNote(parseMoveNote(annotations.data.moveNotes?.[String(cursor)]));
    setAnnotationStatus("Annotations loaded.");
  }, [annotations.data, annotationDirty, cursor]);

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

  const gameAnalysisJobs = useQuery({
    queryKey: ["game-analysis-jobs", { gameId }],
    enabled: Number.isFinite(gameId) && gameId > 0,
    refetchInterval: 2000,
    queryFn: async (): Promise<GameAnalysisJobsResponse> => {
      const response = await fetchJson<GameAnalysisJobsResponse>(`/api/games/${gameId}/analysis-jobs`, {
        method: "GET",
      });
      if (response.status === 200 && "items" in response.data) {
        return response.data;
      }
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to load game analysis jobs (status ${response.status})`;
      throw new Error(msg);
    },
  });

  const autoAnnotationJobs = useQuery({
    queryKey: ["auto-annotation-jobs", { gameId }],
    enabled: Number.isFinite(gameId) && gameId > 0,
    refetchInterval: 2000,
    queryFn: async (): Promise<AutoAnnotationJobsResponse> => {
      const response = await fetchJson<AutoAnnotationJobsResponse>(`/api/games/${gameId}/auto-annotations`, {
        method: "GET",
      });
      if (response.status === 200 && "items" in response.data) {
        return response.data;
      }
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to load auto annotation jobs (status ${response.status})`;
      throw new Error(msg);
    },
  });

  const repertoires = useQuery({
    queryKey: ["repertoires"],
    queryFn: async (): Promise<RepertoireItem[]> => {
      const response = await fetchJson<RepertoireListResponse>("/api/repertoires", { method: "GET" });
      if (response.status === 200 && "items" in response.data) {
        return response.data.items;
      }
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to load repertoires (status ${response.status})`;
      throw new Error(msg);
    },
  });

  useEffect(() => {
    const runningJob = gameAnalysisJobs.data?.items.find(
      (job) => job.status === "queued" || job.status === "running"
    );
    const latestJob = gameAnalysisJobs.data?.items[0];
    if (runningJob) {
      setGameAnalysisStatus(
        `Game analysis #${runningJob.id} ${runningJob.status}: ${runningJob.processedPositions} positions, ${runningJob.storedLines} stored lines.`
      );
      return;
    }
    if (latestJob) {
      if (latestJob.status === "completed") {
        setGameAnalysisStatus(
          `Latest game analysis #${latestJob.id} completed with ${latestJob.processedPositions} positions and ${latestJob.storedLines} stored lines.`
        );
      } else if (latestJob.status === "failed") {
        setGameAnalysisStatus(`Game analysis #${latestJob.id} failed: ${latestJob.error ?? "unknown error"}`);
      } else if (latestJob.status === "cancelled") {
        setGameAnalysisStatus(`Game analysis #${latestJob.id} cancelled.`);
      }
    }
  }, [gameAnalysisJobs.data]);

  useEffect(() => {
    const runningJob = autoAnnotationJobs.data?.items.find(
      (job) => job.status === "queued" || job.status === "running"
    );
    const latestJob = autoAnnotationJobs.data?.items[0];
    if (runningJob) {
      setAutoAnnotationStatus(
        `Auto annotation #${runningJob.id} ${runningJob.status}: ${runningJob.processedPlies} processed, ${runningJob.annotatedPlies} annotated.`
      );
      return;
    }
    if (latestJob) {
      if (latestJob.status === "completed") {
        setAutoAnnotationStatus(
          `Latest auto annotation #${latestJob.id} completed with ${latestJob.annotatedPlies} annotated plies.`
        );
      } else if (latestJob.status === "failed") {
        setAutoAnnotationStatus(`Auto annotation #${latestJob.id} failed: ${latestJob.error ?? "unknown error"}`);
      } else if (latestJob.status === "cancelled") {
        setAutoAnnotationStatus(`Auto annotation #${latestJob.id} cancelled.`);
      }
    }
  }, [autoAnnotationJobs.data]);

  useEffect(() => {
    const latestJob = autoAnnotationJobs.data?.items[0];
    if (latestJob?.status === "completed") {
      void queryClient.invalidateQueries({ queryKey: ["annotations", { gameId }] });
    }
  }, [autoAnnotationJobs.data, gameId, queryClient]);

  useEffect(() => {
    if (!repertoires.data || repertoires.data.length === 0) {
      setSelectedRepertoireId(null);
      return;
    }
    if (selectedRepertoireId && repertoires.data.some((item) => item.id === selectedRepertoireId)) {
      return;
    }
    setSelectedRepertoireId(repertoires.data[0].id);
  }, [repertoires.data, selectedRepertoireId]);

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

  const activeMoveNote = annotationDirty
    ? moveNote
    : parseMoveNote(annotations.data?.moveNotes?.[String(cursor)]);
  const activeHighlights = parseTextList(activeMoveNote.highlightsText).map((value) => value.toLowerCase());
  const activeArrows = parseTextList(activeMoveNote.arrowsText).map((value) => value.toLowerCase());
  const activeArrowPairs = parseBoardArrows(activeArrows);
  const savedMoveNotes = annotations.data?.moveNotes ?? {};
  const nextGameMoveSan = derived.history[derived.safeCursor] ?? null;
  const nextGameMoveUci = nextGameMoveSan ? uciFromSan(derived.fen, nextGameMoveSan) : null;
  const selectedRepertoire = repertoires.data?.find((item) => item.id === selectedRepertoireId) ?? null;

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
        multipv: analysisMultiPv,
        gameId,
        ply: cursor,
        source: "viewer",
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

  async function saveAnalysisLine(targetLine?: AnalysisStatusResponse["result"]["lines"][number]): Promise<void> {
    if (!analysisResult || analysisResult.status !== "completed") {
      return;
    }
    const selectedLine = targetLine ?? analysisResult.result.lines[0];
    const pvString = selectedLine?.pv ?? analysisResult.result.pv;
    const pvUci = pvString ? pvString.split(/\s+/g).filter(Boolean) : [];
    const response = await fetchJson<{ id: number; createdAt: string }>("/api/analysis/store", {
      method: "POST",
      body: JSON.stringify({
        gameId,
        ply: cursor,
        fen: analysisResult.fen,
        engine: analysisResult.engine,
        depth: analysisResult.limits.depth ?? analysisDepth,
        multipv: selectedLine?.multipv ?? analysisResult.multipv ?? 1,
        pvUci,
        pvSan: [],
        evalCp: selectedLine?.evalCp ?? analysisResult.result.evalCp ?? undefined,
        evalMate: selectedLine?.evalMate ?? analysisResult.result.evalMate ?? undefined,
        nodes: analysisResult.limits.nodes ?? undefined,
        timeMs: analysisResult.limits.timeMs ?? undefined,
        source: "viewer",
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

  async function queueGameAnalysis(): Promise<void> {
    setGameAnalysisStatus("Queueing background game analysis...");
    const response = await fetchJson<{ id: number; status: string }>(`/api/games/${gameId}/analysis-jobs`, {
      method: "POST",
      body: JSON.stringify({
        depth: analysisDepth,
        multipv: analysisMultiPv,
        startPly: gameAnalysisStartPly,
        endPly: gameAnalysisEndPly.length > 0 ? Number(gameAnalysisEndPly) : undefined,
      }),
    });
    if (response.status !== 201 || !("id" in response.data)) {
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to queue game analysis (status ${response.status})`;
      setGameAnalysisStatus(msg);
      toasts.pushToast({ kind: "error", message: msg });
      return;
    }
    setGameAnalysisStatus(`Queued background game analysis #${response.data.id}.`);
    toasts.pushToast({ kind: "success", message: `Queued game analysis #${response.data.id}` });
    await gameAnalysisJobs.refetch();
  }

  async function cancelGameAnalysis(jobId: number): Promise<void> {
    const response = await fetchJson<{ id: number; status: string }>(
      `/api/games/${gameId}/analysis-jobs/${jobId}/cancel`,
      { method: "POST" }
    );
    if (response.status !== 200 || !("status" in response.data)) {
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to cancel game analysis (status ${response.status})`;
      setGameAnalysisStatus(msg);
      toasts.pushToast({ kind: "error", message: msg });
      return;
    }
    setGameAnalysisStatus(`Game analysis #${jobId} ${response.data.status}.`);
    await gameAnalysisJobs.refetch();
  }

  async function queueAutoAnnotation(): Promise<void> {
    setAutoAnnotationStatus("Queueing automated annotations...");
    const response = await fetchJson<{ id: number; status: string }>(`/api/games/${gameId}/auto-annotations`, {
      method: "POST",
      body: JSON.stringify({
        depth: analysisDepth,
        overwriteExisting: autoAnnotationOverwrite,
      }),
    });
    if (response.status !== 201 || !("id" in response.data)) {
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to queue auto annotations (status ${response.status})`;
      setAutoAnnotationStatus(msg);
      toasts.pushToast({ kind: "error", message: msg });
      return;
    }
    setAutoAnnotationStatus(`Queued auto annotation job #${response.data.id}.`);
    toasts.pushToast({ kind: "success", message: `Queued auto annotation #${response.data.id}` });
    await autoAnnotationJobs.refetch();
  }

  async function cancelAutoAnnotation(jobId: number): Promise<void> {
    const response = await fetchJson<{ id: number; status: string }>(
      `/api/games/${gameId}/auto-annotations/${jobId}/cancel`,
      { method: "POST" }
    );
    if (response.status !== 200 || !("status" in response.data)) {
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to cancel auto annotation job (status ${response.status})`;
      setAutoAnnotationStatus(msg);
      toasts.pushToast({ kind: "error", message: msg });
      return;
    }
    setAutoAnnotationStatus(`Auto annotation #${jobId} ${response.data.status}.`);
    await autoAnnotationJobs.refetch();
  }

  async function addMoveToRepertoire(moveUci: string | null, note?: string): Promise<void> {
    if (!selectedRepertoireId) {
      toasts.pushToast({ kind: "error", message: "Choose a repertoire first" });
      return;
    }
    if (!derived.fen || !moveUci) {
      toasts.pushToast({ kind: "error", message: "No move available for this position" });
      return;
    }
    const response = await fetchJson<{ id: number }>(`/api/repertoires/${selectedRepertoireId}/entries`, {
      method: "POST",
      body: JSON.stringify({
        positionFen: derived.fen,
        moveUci,
        note: note?.trim() || undefined,
      }),
    });
    if (response.status !== 201) {
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to add move to repertoire (status ${response.status})`;
      toasts.pushToast({ kind: "error", message: msg });
      return;
    }
    toasts.pushToast({ kind: "success", message: "Move added to repertoire" });
    await queryClient.invalidateQueries({ queryKey: ["repertoires"] });
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
        moveNotes: {
          ...(annotations.data.moveNotes ?? {}),
          ...(serializeMoveNote(moveNote)
            ? { [String(cursor)]: serializeMoveNote(moveNote) }
            : Object.fromEntries(Object.entries(annotations.data.moveNotes ?? {}).filter(([ply]) => ply !== String(cursor)))),
        },
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
            <div className="board board-annotated">
              {derived.board.map((rank, rankIndex) => (
                <div key={`rank-${rankIndex}`} className="board-rank">
                  {rank.map((sq) => (
                    <div
                      key={sq.square}
                      className={`square ${(rankIndex + "abcdefgh".indexOf(sq.square[0]!)) % 2 === 0 ? "light" : "dark"}`}
                      title={sq.square}
                      style={activeHighlights.includes(sq.square.toLowerCase()) ? { outline: "3px solid #f4c542", outlineOffset: -3 } : undefined}
                    >
                      <ChessPiece piece={sq.piece} />
                    </div>
                  ))}
                </div>
              ))}
              {activeArrowPairs.length > 0 ? (
                <svg className="board-arrows" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  <defs>
                    <marker id="board-arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                      <path d="M 0 0 L 10 5 L 0 10 z" fill="#d94f39" />
                    </marker>
                  </defs>
                  {activeArrowPairs.map((arrow) => {
                    const from = squareCenter(arrow.from);
                    const to = squareCenter(arrow.to);
                    return (
                      <line
                        key={`${arrow.from}-${arrow.to}`}
                        x1={from.x}
                        y1={from.y}
                        x2={to.x}
                        y2={to.y}
                        stroke="#d94f39"
                        strokeWidth="2.1"
                        strokeLinecap="round"
                        markerEnd="url(#board-arrowhead)"
                        opacity="0.86"
                      />
                    );
                  })}
                </svg>
              ) : null}
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
                    {row.white && savedMoveNotes[String(row.white.cursor)] ? " *" : ""}
                  </button>
                  <button
                    type="button"
                    className={row.black && derived.safeCursor === row.black.cursor ? "active" : undefined}
                    onClick={() => row.black && setCursor(row.black.cursor)}
                    disabled={!row.black}
                  >
                    {row.black?.san ?? ""}
                    {row.black && savedMoveNotes[String(row.black.cursor)] ? " *" : ""}
                  </button>
                </div>
              ))}
              {derived.rows.length === 0 ? <p className="muted">No moves parsed.</p> : null}
            </div>
            {activeMoveNote.comment.trim() || activeMoveNote.variationNote.trim() ? (
              <div className="games-note-preview">
                {activeMoveNote.comment.trim() ? <p>{activeMoveNote.comment.trim()}</p> : null}
                {activeMoveNote.variationNote.trim() ? (
                  <p className="muted">Variation note: {activeMoveNote.variationNote.trim()}</p>
                ) : null}
              </div>
            ) : null}
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
        <div className="auth-grid" style={{ marginTop: 12 }}>
          <label>
            Move note (ply {cursor})
            <textarea
              rows={4}
              value={moveNote.comment}
              onChange={(event) => {
                setMoveNote((current) => ({ ...current, comment: event.target.value }));
                setAnnotationDirty(true);
              }}
              placeholder="Annotate the current move or position..."
            />
          </label>
          <label>
            NAGs
            <input
              value={moveNote.nagsText}
              onChange={(event) => {
                setMoveNote((current) => ({ ...current, nagsText: event.target.value }));
                setAnnotationDirty(true);
              }}
              placeholder="1, 3, 14"
            />
          </label>
          <label>
            Highlights
            <input
              value={moveNote.highlightsText}
              onChange={(event) => {
                setMoveNote((current) => ({ ...current, highlightsText: event.target.value }));
                setAnnotationDirty(true);
              }}
              placeholder="e4 d5"
            />
          </label>
          <label>
            Arrows
            <input
              value={moveNote.arrowsText}
              onChange={(event) => {
                setMoveNote((current) => ({ ...current, arrowsText: event.target.value }));
                setAnnotationDirty(true);
              }}
              placeholder="e2e4 g1f3"
            />
          </label>
        </div>
        <label style={{ marginTop: 12 }}>
          Variation note
          <textarea
            rows={3}
            value={moveNote.variationNote}
            onChange={(event) => {
              setMoveNote((current) => ({ ...current, variationNote: event.target.value }));
              setAnnotationDirty(true);
            }}
            placeholder="Optional note for the line at the current cursor..."
          />
        </label>
        {activeArrows.length > 0 ? (
          <p className="muted">Active arrows: {activeArrows.join(", ")}</p>
        ) : null}
        <p className="muted">{annotationStatus}</p>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Repertoire</h2>
          <div className="button-row">
            <Link href="/repertoires">Manage repertoires</Link>
            {selectedRepertoire ? <Link href={`/drill?repertoireId=${selectedRepertoire.id}`}>Drill</Link> : null}
          </div>
        </div>
        <div className="auth-grid">
          <label>
            Target repertoire
            <select
              value={selectedRepertoireId ?? ""}
              onChange={(event) => setSelectedRepertoireId(event.target.value ? Number(event.target.value) : null)}
            >
              <option value="">Select a repertoire</option>
              {(repertoires.data ?? []).map((repertoire) => (
                <option key={repertoire.id} value={repertoire.id}>
                  {repertoire.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Current move from game
            <input value={nextGameMoveSan ?? "No next move at this cursor"} readOnly />
          </label>
          <div className="button-row" style={{ alignSelf: "end" }}>
            <button
              type="button"
              onClick={() => void addMoveToRepertoire(nextGameMoveUci, nextGameMoveSan ? `From game ${game.data?.white ?? ""} vs ${game.data?.black ?? ""}` : undefined)}
              disabled={!selectedRepertoireId || !nextGameMoveUci}
            >
              Add next game move
            </button>
          </div>
        </div>
        {selectedRepertoire ? (
          <p className="muted">
            {selectedRepertoire.name}: {selectedRepertoire.entryCount} entries, {selectedRepertoire.practicedCount} practiced.
            {selectedRepertoire.isPublic ? " Published." : ""}
          </p>
        ) : (
          <p className="muted">Create a repertoire or select one to save current moves and engine suggestions.</p>
        )}
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Automated Annotation</h2>
          <div className="button-row">
            <button type="button" onClick={() => void queueAutoAnnotation()} disabled={!game.data}>
              Analyze and annotate
            </button>
            <button type="button" onClick={() => void autoAnnotationJobs.refetch()} disabled={autoAnnotationJobs.isFetching}>
              Refresh
            </button>
          </div>
        </div>
        <div className="auth-grid">
          <label>
            Annotation depth
            <input
              type="number"
              min={8}
              max={30}
              value={String(analysisDepth)}
              onChange={(event) => setAnalysisDepth(Math.max(8, Math.min(30, Number(event.target.value) || 14)))}
            />
          </label>
          <label>
            Overwrite existing notes
            <select
              value={autoAnnotationOverwrite ? "yes" : "no"}
              onChange={(event) => setAutoAnnotationOverwrite(event.target.value === "yes")}
            >
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </label>
        </div>
        <p className="muted">{autoAnnotationStatus}</p>
        {autoAnnotationJobs.data ? (
          <div className="table-wrap">
            <table style={{ minWidth: 900 }}>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Status</th>
                  <th>Depth</th>
                  <th>Progress</th>
                  <th>Overwrite</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {autoAnnotationJobs.data.items.map((job) => (
                  <tr key={job.id}>
                    <td>{job.id}</td>
                    <td>{job.status}</td>
                    <td>{job.depth ?? "-"}</td>
                    <td>
                      {job.annotatedPlies}/{job.processedPlies}
                    </td>
                    <td>{job.overwriteExisting ? "Yes" : "No"}</td>
                    <td>{new Date(job.updatedAt).toLocaleString()}</td>
                    <td>
                      {(job.status === "queued" || job.status === "running") ? (
                        <button type="button" onClick={() => void cancelAutoAnnotation(job.id)}>
                          Cancel
                        </button>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                ))}
                {autoAnnotationJobs.data.items.length === 0 ? (
                  <tr>
                    <td colSpan={7}>No automated annotation jobs yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}
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
                  <th>MultiPV</th>
                  <th>Eval</th>
                  <th>PV (SAN)</th>
                  <th>Source</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {engineLines.data.items.map((line) => (
                  <tr key={line.id}>
                    <td>{line.id}</td>
                    <td>{line.engine}</td>
                    <td>{line.depth ?? "-"}</td>
                    <td>{line.multipv ?? 1}</td>
                    <td>
                      {formatEval(line.evalCp, line.evalMate)}
                    </td>
                    <td style={{ maxWidth: 420 }}>
                      {line.pvSan?.length ? line.pvSan.join(" ") : line.pvUci.join(" ")}
                    </td>
                    <td>{line.source}</td>
                    <td>{new Date(line.createdAt).toLocaleString()}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => void addMoveToRepertoire(line.pvUci[0] ?? null, `Saved engine line ${line.id}`)}
                        disabled={!selectedRepertoireId || !(line.pvUci[0] ?? null)}
                      >
                        Add to repertoire
                      </button>
                    </td>
                  </tr>
                ))}
                {engineLines.data.items.length === 0 ? (
                  <tr>
                    <td colSpan={9}>No saved lines at this ply.</td>
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
            Multi-PV
            <input
              type="number"
              min={1}
              max={20}
              value={String(analysisMultiPv)}
              onChange={(event) => setAnalysisMultiPv(Math.max(1, Math.min(20, Number(event.target.value) || 1)))}
              placeholder="1"
            />
          </label>
          <label>
            Current FEN
            <input value={derived.fen} readOnly />
          </label>
        </div>

        <p className="muted">{analysisStatus}</p>
        {analysisResult ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Line</th>
                  <th>Best Move</th>
                  <th>Eval</th>
                  <th>PV</th>
                  <th />
                  <th />
                </tr>
              </thead>
              <tbody>
                {analysisResult.result.lines.map((line) => (
                  <tr key={line.multipv}>
                    <td>{line.multipv}</td>
                    <td>{line.bestMove ?? "-"}</td>
                    <td>{formatEval(line.evalCp, line.evalMate)}</td>
                    <td style={{ maxWidth: 520 }}>{pvSanText(analysisResult.fen, line.pv)}</td>
                    <td>
                      <button type="button" onClick={() => void saveAnalysisLine(line)} disabled={!line.pv}>
                        Store line
                      </button>
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => void addMoveToRepertoire(line.bestMove, `Engine PV ${line.multipv}`)}
                        disabled={!selectedRepertoireId || !line.bestMove}
                      >
                        Add to repertoire
                      </button>
                    </td>
                  </tr>
                ))}
                {analysisResult.result.lines.length === 0 ? (
                  <tr>
                    <td colSpan={6}>No principal variations returned yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Background Game Analysis</h2>
          <div className="button-row">
            <button type="button" onClick={() => void queueGameAnalysis()} disabled={!game.data}>
              Analyze This Game
            </button>
            <button type="button" onClick={() => void gameAnalysisJobs.refetch()} disabled={gameAnalysisJobs.isFetching}>
              Refresh
            </button>
          </div>
        </div>

        <div className="auth-grid">
          <label>
            Start ply
            <input
              type="number"
              min={0}
              value={String(gameAnalysisStartPly)}
              onChange={(event) => setGameAnalysisStartPly(Math.max(0, Number(event.target.value) || 0))}
            />
          </label>
          <label>
            End ply
            <input
              type="number"
              min={0}
              value={gameAnalysisEndPly}
              onChange={(event) => setGameAnalysisEndPly(event.target.value)}
              placeholder="Full game"
            />
          </label>
        </div>

        <p className="muted">{gameAnalysisStatus}</p>
        {gameAnalysisJobs.isLoading ? <p className="muted">Loading background jobs...</p> : null}
        {gameAnalysisJobs.isError ? <p className="muted">Error: {String(gameAnalysisJobs.error)}</p> : null}
        {gameAnalysisJobs.data ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Status</th>
                  <th>Depth</th>
                  <th>MultiPV</th>
                  <th>Ply Range</th>
                  <th>Positions</th>
                  <th>Stored Lines</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {gameAnalysisJobs.data.items.map((job) => (
                  <tr key={job.id}>
                    <td>{job.id}</td>
                    <td>{job.status}</td>
                    <td>{job.depth ?? "-"}</td>
                    <td>{job.multipv}</td>
                    <td>
                      {job.startPly}
                      {job.endPly !== null ? `-${job.endPly}` : "+"}
                    </td>
                    <td>{job.processedPositions}</td>
                    <td>{job.storedLines}</td>
                    <td>{new Date(job.updatedAt).toLocaleString()}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => void cancelGameAnalysis(job.id)}
                        disabled={!(job.status === "queued" || job.status === "running")}
                      >
                        Cancel
                      </button>
                    </td>
                  </tr>
                ))}
                {gameAnalysisJobs.data.items.length === 0 ? (
                  <tr>
                    <td colSpan={9}>No background analysis jobs for this game.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </main>
  );
}
