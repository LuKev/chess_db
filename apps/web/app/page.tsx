"use client";

import { Chess } from "chess.js";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type User = {
  id: number;
  email: string;
  createdAt: string;
};

type GameRow = {
  id: number;
  white: string;
  black: string;
  result: string;
  date: string | null;
  event: string | null;
  eco: string | null;
  plyCount: number | null;
  timeControl: string | null;
};

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
  pgn: string;
  moveTree: Record<string, unknown>;
};

type GamesResponse = {
  page: number;
  pageSize: number;
  total: number;
  items: GameRow[];
};

type ImportJob = {
  id: number;
  status: string;
  totals: {
    parsed: number;
    inserted: number;
    duplicates: number;
    parseErrors: number;
  };
  createdAt: string;
  updatedAt: string;
};

type ImportListResponse = {
  page: number;
  pageSize: number;
  total: number;
  items: ImportJob[];
};

type SavedFilter = {
  id: number;
  name: string;
  query: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type AnalysisResponse = {
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

type ExportJob = {
  id: number;
  status: string;
  mode: string;
  outputObjectKey: string | null;
  exportedGames: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

type MoveNode = {
  notation?: {
    notation?: string;
  };
  variations?: unknown[];
};

type NotationLine = {
  id: string;
  label: string;
  moves: string[];
  depth: number;
  anchorPly: number;
};

function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
}

function toQuery(params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      query.set(key, String(value));
    }
  }

  const result = query.toString();
  return result ? `?${result}` : "";
}

async function fetchJson<T>(
  path: string,
  init: RequestInit = {},
  options: { jsonBody?: boolean } = { jsonBody: true }
): Promise<{ status: number; data: T | { error?: string } }> {
  const headers = new Headers(init.headers);

  if (options.jsonBody && !(init.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    credentials: "include",
    headers,
  });

  let data: T | { error?: string };
  try {
    data = (await response.json()) as T | { error?: string };
  } catch {
    data = {};
  }

  return { status: response.status, data };
}

async function fetchText(path: string, init: RequestInit = {}): Promise<{
  status: number;
  text: string;
}> {
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    credentials: "include",
  });

  return {
    status: response.status,
    text: await response.text(),
  };
}

function isMoveNode(value: unknown): value is MoveNode {
  return Boolean(value) && typeof value === "object";
}

function extractSansFromMoves(moves: unknown[]): string[] {
  const sans: string[] = [];
  for (const move of moves) {
    if (!isMoveNode(move)) {
      continue;
    }
    const san = move.notation?.notation;
    if (typeof san === "string" && san.trim().length > 0) {
      sans.push(san.trim());
    }
  }
  return sans;
}

function extractNotationLines(moveTree: Record<string, unknown>): NotationLine[] {
  const direct = moveTree.mainline;
  if (Array.isArray(direct) && direct.every((value) => typeof value === "string")) {
    return [
      {
        id: "mainline",
        label: "Mainline",
        moves: direct as string[],
        depth: 0,
        anchorPly: 0,
      },
    ];
  }

  const rootMoves = moveTree.moves;
  if (!Array.isArray(rootMoves)) {
    return [];
  }

  const rootSans = extractSansFromMoves(rootMoves);
  const lines: NotationLine[] = [
    {
      id: "mainline",
      label: "Mainline",
      moves: rootSans,
      depth: 0,
      anchorPly: 0,
    },
  ];

  let counter = 1;

  const walkVariations = (moves: unknown[], prefixSans: string[], depth: number): void => {
    const mainSans = extractSansFromMoves(moves);

    for (let moveIndex = 0; moveIndex < moves.length; moveIndex += 1) {
      const move = moves[moveIndex];
      if (!isMoveNode(move) || !Array.isArray(move.variations)) {
        continue;
      }

      for (const variation of move.variations) {
        if (!Array.isArray(variation)) {
          continue;
        }

        const variationSans = extractSansFromMoves(variation);
        if (variationSans.length === 0) {
          continue;
        }

        const anchorSans = [...prefixSans, ...mainSans.slice(0, moveIndex)];
        const lineMoves = [...anchorSans, ...variationSans];
        const lineId = `var-${counter}`;
        lines.push({
          id: lineId,
          label: `Variation ${counter} (ply ${anchorSans.length + 1})`,
          moves: lineMoves,
          depth,
          anchorPly: anchorSans.length,
        });
        counter += 1;

        walkVariations(variation, anchorSans, depth + 1);
      }
    }
  };

  walkVariations(rootMoves, [], 1);
  return lines;
}

function parseAnnotationStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim().toLowerCase() : ""))
      .filter((item) => item.length > 0);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length > 0);
  }

  return [];
}

function asAnnotationInput(value: unknown): string {
  return parseAnnotationStringList(value).join(", ");
}

function buildFenHistory(startingFen: string | null, sans: string[]): string[] {
  const initialFen =
    startingFen && startingFen !== "startpos"
      ? startingFen
      : undefined;

  const chess = new Chess(initialFen);
  const history = [chess.fen()];

  for (const san of sans) {
    const move = chess.move(san, { strict: false });
    if (!move) {
      break;
    }
    history.push(chess.fen());
  }

  return history;
}

function fenToBoard(fen: string): string[][] {
  const piecePlacement = fen.split(" ")[0];
  const ranks = piecePlacement.split("/");

  return ranks.map((rank) => {
    const squares: string[] = [];
    for (const char of rank) {
      if (/\d/.test(char)) {
        squares.push(...Array.from({ length: Number(char) }, () => ""));
      } else {
        squares.push(char);
      }
    }
    return squares;
  });
}

function pieceToSymbol(piece: string): string {
  const map: Record<string, string> = {
    p: "♟",
    r: "♜",
    n: "♞",
    b: "♝",
    q: "♛",
    k: "♚",
    P: "♙",
    R: "♖",
    N: "♘",
    B: "♗",
    Q: "♕",
    K: "♔",
  };

  return map[piece] ?? "";
}

export default function Home() {
  const [email, setEmail] = useState("player@example.com");
  const [password, setPassword] = useState("password123");
  const [user, setUser] = useState<User | null>(null);
  const [authMessage, setAuthMessage] = useState("Checking session...");

  const [player, setPlayer] = useState("");
  const [eco, setEco] = useState("");
  const [eventFilter, setEventFilter] = useState("");
  const [siteFilter, setSiteFilter] = useState("");
  const [result, setResult] = useState("");
  const [timeControl, setTimeControl] = useState("");
  const [rated, setRated] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sort, setSort] = useState("date_desc");
  const [page, setPage] = useState(1);

  const [games, setGames] = useState<GamesResponse | null>(null);
  const [tableStatus, setTableStatus] = useState("Sign in to load games");

  const [selectedGameId, setSelectedGameId] = useState<number | null>(null);
  const [selectedGame, setSelectedGame] = useState<GameDetail | null>(null);
  const [viewerStatus, setViewerStatus] = useState("Select a game to open viewer");
  const [pgnText, setPgnText] = useState("");
  const [notationLines, setNotationLines] = useState<NotationLine[]>([]);
  const [activeLineId, setActiveLineId] = useState("mainline");
  const [notationSans, setNotationSans] = useState<string[]>([]);
  const [fenHistory, setFenHistory] = useState<string[]>([]);
  const [cursor, setCursor] = useState(0);
  const [autoplay, setAutoplay] = useState(false);
  const [annotationText, setAnnotationText] = useState("");
  const [annotationHighlightsInput, setAnnotationHighlightsInput] = useState("");
  const [annotationArrowsInput, setAnnotationArrowsInput] = useState("");
  const [annotationStatus, setAnnotationStatus] = useState("No annotations loaded");

  const [importFile, setImportFile] = useState<File | null>(null);
  const [importStatus, setImportStatus] = useState("Sign in to import PGN files");
  const [imports, setImports] = useState<ImportJob[]>([]);

  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
  const [filterName, setFilterName] = useState("");
  const [filterMessage, setFilterMessage] = useState("Sign in to manage saved filters");

  const [analysisFen, setAnalysisFen] = useState(
    "rn1qkbnr/pppb1ppp/3p4/4p3/3PP3/2N2N2/PPP2PPP/R1BQKB1R w KQkq - 0 5"
  );
  const [analysisDepth, setAnalysisDepth] = useState(12);
  const [analysisStatus, setAnalysisStatus] = useState("Sign in to run analysis");
  const [activeAnalysis, setActiveAnalysis] = useState<AnalysisResponse | null>(null);
  const analysisStreamRef = useRef<EventSource | null>(null);

  const [exportJobs, setExportJobs] = useState<ExportJob[]>([]);
  const [exportStatus, setExportStatus] = useState("Sign in to create exports");
  const [includeExportAnnotations, setIncludeExportAnnotations] = useState(false);

  const pageCount = useMemo(() => {
    if (!games) {
      return 1;
    }
    return Math.max(1, Math.ceil(games.total / games.pageSize));
  }, [games]);

  const currentFen = fenHistory[Math.min(cursor, Math.max(0, fenHistory.length - 1))] ?? null;
  const board = currentFen ? fenToBoard(currentFen) : null;
  const highlightedSquares = useMemo(
    () => new Set(parseAnnotationStringList(annotationHighlightsInput)),
    [annotationHighlightsInput]
  );
  const annotationArrows = useMemo(
    () => parseAnnotationStringList(annotationArrowsInput),
    [annotationArrowsInput]
  );

  function applyNotationLine(
    startingFen: string | null,
    line: NotationLine,
    requestedCursor = 0
  ): void {
    const history = buildFenHistory(startingFen, line.moves);
    setActiveLineId(line.id);
    setNotationSans(line.moves);
    setFenHistory(history);
    const maxCursor = Math.max(0, history.length - 1);
    setCursor(Math.min(Math.max(0, requestedCursor), maxCursor));
  }

  async function refreshSession(): Promise<void> {
    const response = await fetchJson<{ user: User }>("/api/auth/me", {
      method: "GET",
    });

    if (response.status === 200 && "user" in response.data) {
      setUser(response.data.user);
      setAuthMessage(`Signed in as ${response.data.user.email}`);
      return;
    }

    setUser(null);
    setGames(null);
    setImports([]);
    setExportJobs([]);
    setSavedFilters([]);
    setSelectedGame(null);
    setSelectedGameId(null);
    setNotationLines([]);
    setActiveLineId("mainline");
    setNotationSans([]);
    setFenHistory([]);
    setCursor(0);
    setAnnotationText("");
    setAnnotationHighlightsInput("");
    setAnnotationArrowsInput("");
    setAuthMessage("Not signed in");
  }

  async function refreshGames(nextPage = page): Promise<void> {
    if (!user) {
      setGames(null);
      setTableStatus("Sign in to load games");
      return;
    }

    const query = toQuery({
      page: nextPage,
      pageSize: 25,
      sort,
      player,
      eco,
      event: eventFilter,
      site: siteFilter,
      result,
      timeControl,
      rated,
      fromDate,
      toDate,
    });

    setTableStatus("Loading games...");
    const response = await fetchJson<GamesResponse>(`/api/games${query}`, {
      method: "GET",
    });

    if (response.status !== 200 || !("items" in response.data)) {
      setGames(null);
      setTableStatus(
        `Failed to load games${"error" in response.data && response.data.error ? `: ${response.data.error}` : ""}`
      );
      return;
    }

    setGames(response.data);
    setTableStatus(
      response.data.total > 0
        ? `${response.data.total} game(s) matched`
        : "No games match current filters"
    );
  }

  async function openGameViewer(gameId: number): Promise<void> {
    setSelectedGameId(gameId);
    setViewerStatus(`Loading game #${gameId}...`);

    const gameResponse = await fetchJson<GameDetail>(`/api/games/${gameId}`, {
      method: "GET",
    });

    if (gameResponse.status !== 200 || !("id" in gameResponse.data)) {
      setViewerStatus(
        `Failed to load game${"error" in gameResponse.data && gameResponse.data.error ? `: ${gameResponse.data.error}` : ""}`
      );
      return;
    }

    const game = gameResponse.data;
    const lines = extractNotationLines(game.moveTree);
    const defaultLine: NotationLine = lines[0] ?? {
      id: "mainline",
      label: "Mainline",
      moves: [],
      depth: 0,
      anchorPly: 0,
    };

    setSelectedGame(game);
    setNotationLines(lines);
    applyNotationLine(game.startingFen, defaultLine, 0);
    setAutoplay(false);
    setViewerStatus(`Viewing game #${game.id}: ${game.white} vs ${game.black}`);

    const pgnResponse = await fetchText(`/api/games/${gameId}/pgn`, {
      method: "GET",
    });

    if (pgnResponse.status === 200) {
      setPgnText(pgnResponse.text);
    } else {
      setPgnText(game.pgn);
    }

    const annotations = await fetchJson<{ gameId: number; annotations: Record<string, unknown> }>(
      `/api/games/${gameId}/annotations`,
      {
        method: "GET",
      }
    );

    if (annotations.status === 200 && "annotations" in annotations.data) {
      const saved = annotations.data.annotations;
      const comment = saved.comment;
      const savedLineId = typeof saved.lineId === "string" ? saved.lineId : defaultLine.id;
      const savedCursor = typeof saved.cursor === "number" ? saved.cursor : 0;
      const savedLine =
        lines.find((line) => line.id === savedLineId) ?? defaultLine;

      applyNotationLine(game.startingFen, savedLine, savedCursor);
      setAnnotationText(typeof comment === "string" ? comment : "");
      setAnnotationHighlightsInput(asAnnotationInput(saved.highlights));
      setAnnotationArrowsInput(asAnnotationInput(saved.arrows));
      setAnnotationStatus("Annotations loaded");
    } else {
      setAnnotationText("");
      setAnnotationHighlightsInput("");
      setAnnotationArrowsInput("");
      setAnnotationStatus("No annotations found");
    }
  }

  async function saveAnnotations(): Promise<void> {
    if (!selectedGameId) {
      return;
    }

    const response = await fetchJson<{ gameId: number }>(
      `/api/games/${selectedGameId}/annotations`,
      {
        method: "PUT",
        body: JSON.stringify({
          annotations: {
            comment: annotationText,
            cursor,
            lineId: activeLineId,
            highlights: parseAnnotationStringList(annotationHighlightsInput),
            arrows: parseAnnotationStringList(annotationArrowsInput),
          },
        }),
      }
    );

    if (response.status !== 200) {
      setAnnotationStatus(
        `Failed to save annotations${"error" in response.data && response.data.error ? `: ${response.data.error}` : ""}`
      );
      return;
    }

    setAnnotationStatus("Annotations saved");
  }

  async function copyFen(): Promise<void> {
    if (!currentFen) {
      return;
    }

    try {
      await navigator.clipboard.writeText(currentFen);
      setViewerStatus("FEN copied to clipboard");
    } catch {
      setViewerStatus("Failed to copy FEN");
    }
  }

  async function refreshImports(): Promise<void> {
    if (!user) {
      setImports([]);
      setImportStatus("Sign in to import PGN files");
      return;
    }

    const response = await fetchJson<ImportListResponse>("/api/imports?page=1&pageSize=15", {
      method: "GET",
    });

    if (response.status !== 200 || !("items" in response.data)) {
      setImportStatus(
        `Failed to load imports${"error" in response.data && response.data.error ? `: ${response.data.error}` : ""}`
      );
      return;
    }

    setImports(response.data.items);
    setImportStatus(
      response.data.items.length > 0
        ? `${response.data.total} import job(s)`
        : "No import jobs yet"
    );
  }

  async function refreshSavedFilters(): Promise<void> {
    if (!user) {
      setSavedFilters([]);
      setFilterMessage("Sign in to manage saved filters");
      return;
    }

    const response = await fetchJson<{ items: SavedFilter[] }>("/api/filters", {
      method: "GET",
    });

    if (response.status !== 200 || !("items" in response.data)) {
      setFilterMessage(
        `Failed to load filters${"error" in response.data && response.data.error ? `: ${response.data.error}` : ""}`
      );
      return;
    }

    setSavedFilters(response.data.items);
    setFilterMessage(
      response.data.items.length > 0
        ? `${response.data.items.length} saved filter(s)`
        : "No saved filters"
    );
  }

  async function refreshExports(): Promise<void> {
    if (!user) {
      setExportJobs([]);
      setExportStatus("Sign in to create exports");
      return;
    }

    const response = await fetchJson<{ items: ExportJob[] }>("/api/exports", {
      method: "GET",
    });

    if (response.status !== 200 || !("items" in response.data)) {
      setExportStatus(
        `Failed to load exports${"error" in response.data && response.data.error ? `: ${response.data.error}` : ""}`
      );
      return;
    }

    setExportJobs(response.data.items);
    setExportStatus(
      response.data.items.length > 0
        ? `${response.data.items.length} export job(s)`
        : "No export jobs yet"
    );
  }

  async function submitAuth(mode: "register" | "login"): Promise<void> {
    const endpoint = mode === "register" ? "/api/auth/register" : "/api/auth/login";
    const response = await fetchJson<{ user: User }>(endpoint, {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });

    if (response.status >= 400) {
      setAuthMessage(
        `Auth failed${"error" in response.data && response.data.error ? `: ${response.data.error}` : ""}`
      );
      return;
    }

    await refreshSession();
    setPage(1);
    await Promise.all([
      refreshGames(1),
      refreshImports(),
      refreshSavedFilters(),
      refreshExports(),
    ]);
  }

  async function logout(): Promise<void> {
    await fetchJson<{ ok: boolean }>("/api/auth/logout", {
      method: "POST",
    });

    if (analysisStreamRef.current) {
      analysisStreamRef.current.close();
      analysisStreamRef.current = null;
    }

    await refreshSession();
  }

  async function createSampleGame(): Promise<void> {
    if (!user) {
      return;
    }

    const sampleHash = `sample-${Date.now()}`;
    const response = await fetchJson<{ id: number }>("/api/games", {
      method: "POST",
      body: JSON.stringify({
        white: "Kasparov, Garry",
        black: "Karpov, Anatoly",
        result: "1-0",
        eco: "B44",
        event: "World Championship",
        site: "Moscow",
        date: "1985-10-15",
        timeControl: "40/7200:20/3600",
        plyCount: 58,
        startingFen: "startpos",
        movesHash: sampleHash,
        pgn: "[Event \"World Championship\"]\n\n1. e4 c5 2. Nf3 e6 3. d4 cxd4 1-0",
        moveTree: {
          mainline: ["e4", "c5", "Nf3", "e6", "d4", "cxd4"],
        },
      }),
    });

    if (response.status >= 400) {
      setTableStatus(
        `Failed to insert sample game${"error" in response.data && response.data.error ? `: ${response.data.error}` : ""}`
      );
      return;
    }

    await refreshGames(1);
    setPage(1);
  }

  async function uploadImportFile(): Promise<void> {
    if (!user || !importFile) {
      return;
    }

    const form = new FormData();
    form.append("file", importFile);

    setImportStatus("Uploading and queueing import job...");
    const response = await fetchJson<{ id: number }>(
      "/api/imports",
      {
        method: "POST",
        body: form,
      },
      { jsonBody: false }
    );

    if (response.status !== 201) {
      setImportStatus(
        `Import upload failed${"error" in response.data && response.data.error ? `: ${response.data.error}` : ""}`
      );
      return;
    }

    setImportStatus(`Queued import job #${"id" in response.data ? response.data.id : "?"}`);
    setImportFile(null);
    await refreshImports();
  }

  async function saveCurrentFilter(): Promise<void> {
    if (!user || !filterName.trim()) {
      return;
    }

    const response = await fetchJson<{ id: number }>("/api/filters", {
      method: "POST",
      body: JSON.stringify({
        name: filterName.trim(),
        query: {
          player,
          eco,
          event: eventFilter,
          site: siteFilter,
          result,
          timeControl,
          rated,
          fromDate,
          toDate,
          sort,
        },
      }),
    });

    if (response.status !== 201) {
      setFilterMessage(
        `Failed to save filter${"error" in response.data && response.data.error ? `: ${response.data.error}` : ""}`
      );
      return;
    }

    setFilterName("");
    await refreshSavedFilters();
  }

  async function deleteFilter(id: number): Promise<void> {
    if (!user) {
      return;
    }

    const response = await fetchJson<{ error?: string }>(`/api/filters/${id}`, {
      method: "DELETE",
    });

    if (response.status !== 204) {
      setFilterMessage(
        `Failed to delete filter${"error" in response.data && response.data.error ? `: ${response.data.error}` : ""}`
      );
      return;
    }

    await refreshSavedFilters();
  }

  async function refreshAnalysis(analysisId: number): Promise<void> {
    const response = await fetchJson<AnalysisResponse>(`/api/analysis/${analysisId}`, {
      method: "GET",
    });

    if (response.status !== 200 || !("status" in response.data)) {
      setAnalysisStatus(
        `Failed to load analysis${"error" in response.data && response.data.error ? `: ${response.data.error}` : ""}`
      );
      return;
    }

    setActiveAnalysis(response.data);
    setAnalysisStatus(`Analysis #${response.data.id}: ${response.data.status}`);
  }

  function openAnalysisStream(analysisId: number): void {
    if (analysisStreamRef.current) {
      analysisStreamRef.current.close();
    }

    const stream = new EventSource(`${apiBaseUrl()}/api/analysis/${analysisId}/stream`, {
      withCredentials: true,
    });

    stream.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as {
          id: number;
          status: string;
          result: AnalysisResponse["result"];
          error: string | null;
          updatedAt: string;
        };

        setActiveAnalysis((current) => {
          if (!current || current.id !== payload.id) {
            return {
              id: payload.id,
              status: payload.status,
              fen: analysisFen,
              limits: {
                depth: analysisDepth,
                nodes: null,
                timeMs: null,
              },
              result: payload.result,
              error: payload.error,
              createdAt: payload.updatedAt,
              updatedAt: payload.updatedAt,
            };
          }

          return {
            ...current,
            status: payload.status,
            result: payload.result,
            error: payload.error,
            updatedAt: payload.updatedAt,
          };
        });

        setAnalysisStatus(`Analysis #${payload.id}: ${payload.status}`);

        if (["completed", "failed", "cancelled"].includes(payload.status)) {
          stream.close();
          analysisStreamRef.current = null;
        }
      } catch {
        setAnalysisStatus("Analysis stream payload error");
      }
    };

    stream.onerror = () => {
      setAnalysisStatus("Analysis stream disconnected; using polling fallback");
      stream.close();
      analysisStreamRef.current = null;
      void refreshAnalysis(analysisId);
    };

    analysisStreamRef.current = stream;
  }

  async function createAnalysis(): Promise<void> {
    if (!user) {
      return;
    }

    const response = await fetchJson<{ id: number; status: string }>("/api/analysis", {
      method: "POST",
      body: JSON.stringify({
        fen: analysisFen,
        depth: analysisDepth,
      }),
    });

    if (response.status !== 201 || !("id" in response.data)) {
      setAnalysisStatus(
        `Failed to create analysis${"error" in response.data && response.data.error ? `: ${response.data.error}` : ""}`
      );
      return;
    }

    setAnalysisStatus(`Queued analysis #${response.data.id}`);
    await refreshAnalysis(response.data.id);
    openAnalysisStream(response.data.id);
  }

  async function cancelAnalysis(): Promise<void> {
    if (!activeAnalysis) {
      return;
    }

    const response = await fetchJson<{ status: string }>(
      `/api/analysis/${activeAnalysis.id}/cancel`,
      {
        method: "POST",
      }
    );

    if (response.status !== 200) {
      setAnalysisStatus(
        `Failed to cancel analysis${"error" in response.data && response.data.error ? `: ${response.data.error}` : ""}`
      );
      return;
    }

    if (analysisStreamRef.current) {
      analysisStreamRef.current.close();
      analysisStreamRef.current = null;
    }

    setAnalysisStatus(`Analysis #${activeAnalysis.id}: cancelled`);
    await refreshAnalysis(activeAnalysis.id);
  }

  async function createExportByCurrentFilter(): Promise<void> {
    if (!user) {
      return;
    }

    const response = await fetchJson<{ id: number }>("/api/exports", {
      method: "POST",
      body: JSON.stringify({
        mode: "query",
        query: {
          player,
          eco,
          event: eventFilter,
          site: siteFilter,
          result,
          timeControl,
          rated,
          fromDate,
          toDate,
        },
        includeAnnotations: includeExportAnnotations,
      }),
    });

    if (response.status !== 201 || !("id" in response.data)) {
      setExportStatus(
        `Failed to queue export${"error" in response.data && response.data.error ? `: ${response.data.error}` : ""}`
      );
      return;
    }

    setExportStatus(`Queued export job #${response.data.id}`);
    await refreshExports();
  }

  function selectNotationLine(line: NotationLine): void {
    if (!selectedGame) {
      return;
    }
    setAutoplay(false);
    applyNotationLine(selectedGame.startingFen, line, 0);
  }

  function applySavedFilter(savedFilter: SavedFilter): void {
    const query = savedFilter.query;

    setPlayer(String(query.player ?? ""));
    setEco(String(query.eco ?? ""));
    setEventFilter(String(query.event ?? ""));
    setSiteFilter(String(query.site ?? ""));
    setResult(String(query.result ?? ""));
    setTimeControl(String(query.timeControl ?? ""));
    setRated(String(query.rated ?? ""));
    setFromDate(String(query.fromDate ?? ""));
    setToDate(String(query.toDate ?? ""));
    setSort(String(query.sort ?? "date_desc"));
    setPage(1);
    void refreshGames(1);
  }

  function onFilterSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setPage(1);
    void refreshGames(1);
  }

  useEffect(() => {
    void refreshSession();
  }, []);

  useEffect(() => {
    if (!user) {
      return;
    }

    void Promise.all([refreshGames(1), refreshImports(), refreshSavedFilters(), refreshExports()]);
    setPage(1);
  }, [user]);

  useEffect(() => {
    void refreshGames(page);
  }, [sort, page]);

  useEffect(() => {
    if (!user) {
      return;
    }

    const interval = setInterval(() => {
      void refreshImports();
    }, 3000);

    return () => clearInterval(interval);
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    const interval = setInterval(() => {
      void refreshExports();
    }, 3000);

    return () => clearInterval(interval);
  }, [user]);

  useEffect(() => {
    if (!autoplay || fenHistory.length <= 1) {
      return;
    }

    const interval = setInterval(() => {
      setCursor((value) => {
        const next = value + 1;
        if (next >= fenHistory.length) {
          setAutoplay(false);
          return value;
        }
        return next;
      });
    }, 700);

    return () => clearInterval(interval);
  }, [autoplay, fenHistory.length]);

  useEffect(() => {
    return () => {
      if (analysisStreamRef.current) {
        analysisStreamRef.current.close();
      }
    };
  }, []);

  return (
    <main>
      <h1>Chess DB</h1>
      <p className="muted">
        MVP in progress: auth, import/search/view, analysis, annotations, and export queues.
      </p>

      <section className="card">
        <h2>Account</h2>
        <form
          className="auth-grid"
          onSubmit={(event) => {
            event.preventDefault();
            void submitAuth("login");
          }}
        >
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={8}
            />
          </label>
          <div className="button-row">
            <button type="button" onClick={() => void submitAuth("register")}>Register</button>
            <button type="submit">Login</button>
            <button type="button" onClick={() => void logout()}>Logout</button>
          </div>
        </form>
        <p className="muted">{authMessage}</p>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Database Home</h2>
          <button onClick={() => void createSampleGame()} disabled={!user}>
            Insert Sample Game
          </button>
        </div>

        <form className="filters" onSubmit={onFilterSubmit}>
          <input placeholder="Player" value={player} onChange={(event) => setPlayer(event.target.value)} />
          <input placeholder="ECO" value={eco} onChange={(event) => setEco(event.target.value)} />
          <input
            placeholder="Event"
            value={eventFilter}
            onChange={(event) => setEventFilter(event.target.value)}
          />
          <input
            placeholder="Site"
            value={siteFilter}
            onChange={(event) => setSiteFilter(event.target.value)}
          />
          <input placeholder="Result" value={result} onChange={(event) => setResult(event.target.value)} />
          <input
            placeholder="Time control"
            value={timeControl}
            onChange={(event) => setTimeControl(event.target.value)}
          />
          <select value={rated} onChange={(event) => setRated(event.target.value)}>
            <option value="">Rated/Unrated</option>
            <option value="true">Rated</option>
            <option value="false">Unrated</option>
          </select>
          <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
          <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="date_desc">Date desc</option>
            <option value="date_asc">Date asc</option>
            <option value="white">White</option>
            <option value="black">Black</option>
            <option value="eco">ECO</option>
          </select>
          <button type="submit" disabled={!user}>Apply Filters</button>
        </form>

        <p className="muted">{tableStatus}</p>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>White</th>
                <th>Black</th>
                <th>Result</th>
                <th>Date</th>
                <th>ECO</th>
                <th>Event</th>
                <th>Ply</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {games?.items.map((game) => (
                <tr key={game.id}>
                  <td>{game.id}</td>
                  <td>{game.white}</td>
                  <td>{game.black}</td>
                  <td>{game.result}</td>
                  <td>{game.date ?? "-"}</td>
                  <td>{game.eco ?? "-"}</td>
                  <td>{game.event ?? "-"}</td>
                  <td>{game.plyCount ?? "-"}</td>
                  <td>
                    <button onClick={() => void openGameViewer(game.id)} disabled={!user}>
                      Open
                    </button>
                  </td>
                </tr>
              ))}
              {games && games.items.length === 0 ? (
                <tr>
                  <td colSpan={9}>No rows</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="button-row">
          <button
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={!user || page <= 1}
          >
            Previous
          </button>
          <span>Page {page} / {pageCount}</span>
          <button
            onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
            disabled={!user || page >= pageCount}
          >
            Next
          </button>
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Game Viewer</h2>
          <div className="button-row">
            <button onClick={() => setCursor(0)} disabled={!selectedGame || cursor <= 0}>|&lt;</button>
            <button
              onClick={() => setCursor((value) => Math.max(0, value - 1))}
              disabled={!selectedGame || cursor <= 0}
            >
              &lt;
            </button>
            <button
              onClick={() => setCursor((value) => Math.min(fenHistory.length - 1, value + 1))}
              disabled={!selectedGame || cursor >= fenHistory.length - 1}
            >
              &gt;
            </button>
            <button
              onClick={() => setCursor(Math.max(0, fenHistory.length - 1))}
              disabled={!selectedGame || cursor >= fenHistory.length - 1}
            >
              &gt;|
            </button>
            <button onClick={() => setAutoplay((value) => !value)} disabled={!selectedGame}>
              {autoplay ? "Stop" : "Autoplay"}
            </button>
            <button onClick={() => void copyFen()} disabled={!selectedGame || !currentFen}>
              Copy FEN
            </button>
          </div>
        </div>

        <p className="muted">{viewerStatus}</p>

        {selectedGame && board ? (
          <div className="viewer-grid">
            <div>
              <div className="board">
                {board.map((rank, rankIndex) => (
                  <div key={`rank-${rankIndex}`} className="board-rank">
                    {rank.map((piece, fileIndex) => {
                      const squareName = `${"abcdefgh"[fileIndex]}${8 - rankIndex}`;
                      const isMarked = highlightedSquares.has(squareName.toLowerCase());
                      return (
                        <div
                          key={`sq-${rankIndex}-${fileIndex}`}
                          className={`square ${(rankIndex + fileIndex) % 2 === 0 ? "light" : "dark"} ${isMarked ? "marked" : ""}`}
                          title={squareName}
                        >
                          {pieceToSymbol(piece)}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
              <p className="muted">
                {selectedGame.white} vs {selectedGame.black} ({selectedGame.result})
              </p>
              <p className="muted">
                Move index: {cursor}/{Math.max(0, fenHistory.length - 1)}
              </p>
              <p className="muted">
                Active line: {notationLines.find((line) => line.id === activeLineId)?.label ?? "Mainline"}
              </p>
              <label>
                Notes
                <textarea
                  rows={4}
                  value={annotationText}
                  onChange={(event) => setAnnotationText(event.target.value)}
                />
              </label>
              <label>
                Highlight Squares (comma-separated, e.g. e4, d5)
                <input
                  value={annotationHighlightsInput}
                  onChange={(event) => setAnnotationHighlightsInput(event.target.value)}
                />
              </label>
              <label>
                Arrows (comma-separated, e.g. e2e4, g1f3)
                <input
                  value={annotationArrowsInput}
                  onChange={(event) => setAnnotationArrowsInput(event.target.value)}
                />
              </label>
              {annotationArrows.length > 0 ? (
                <p className="muted">Arrows: {annotationArrows.join(", ")}</p>
              ) : null}
              <div className="button-row">
                <button onClick={() => void saveAnnotations()} disabled={!selectedGameId}>
                  Save Notes
                </button>
              </div>
              <p className="muted">{annotationStatus}</p>
            </div>

            <div>
              <h3>Lines</h3>
              <div className="line-list">
                {notationLines.map((line) => (
                  <button
                    key={line.id}
                    className={activeLineId === line.id ? "active" : ""}
                    style={{ marginLeft: `${line.depth * 12}px` }}
                    onClick={() => selectNotationLine(line)}
                  >
                    {line.label} ({line.moves.length} ply)
                  </button>
                ))}
              </div>
              <h3>Notation</h3>
              <div className="notation-list">
                {notationSans.map((san, index) => (
                  <button
                    key={`${index}-${san}`}
                    className={cursor === index + 1 ? "active" : ""}
                    onClick={() => setCursor(index + 1)}
                  >
                    {index + 1}. {san}
                  </button>
                ))}
                {notationSans.length === 0 ? <p className="muted">No notation moves parsed</p> : null}
              </div>
              <h3>PGN</h3>
              <pre className="pgn-pre">{pgnText}</pre>
              <div className="button-row">
                {selectedGameId ? (
                  <a
                    href={`${apiBaseUrl()}/api/games/${selectedGameId}/pgn`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open Raw PGN
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Import Jobs</h2>
          <div className="button-row">
            <input
              type="file"
              accept=".pgn,.pgn.zst"
              onChange={(event) => setImportFile(event.target.files?.[0] ?? null)}
              disabled={!user}
            />
            <button onClick={() => void uploadImportFile()} disabled={!user || !importFile}>
              Upload PGN
            </button>
          </div>
        </div>

        <p className="muted">{importStatus}</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Status</th>
                <th>Parsed</th>
                <th>Inserted</th>
                <th>Duplicates</th>
                <th>Parse Errors</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {imports.map((job) => (
                <tr key={job.id}>
                  <td>{job.id}</td>
                  <td>{job.status}</td>
                  <td>{job.totals.parsed}</td>
                  <td>{job.totals.inserted}</td>
                  <td>{job.totals.duplicates}</td>
                  <td>{job.totals.parseErrors}</td>
                  <td>{new Date(job.updatedAt).toLocaleString()}</td>
                </tr>
              ))}
              {imports.length === 0 ? (
                <tr>
                  <td colSpan={7}>No import jobs</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Engine Analysis</h2>
          <div className="button-row">
            <button onClick={() => void createAnalysis()} disabled={!user}>Analyze Position</button>
            <button
              onClick={() => void cancelAnalysis()}
              disabled={!user || !activeAnalysis || activeAnalysis.status !== "running"}
            >
              Cancel
            </button>
          </div>
        </div>
        <div className="analysis-grid">
          <label>
            FEN
            <input
              value={analysisFen}
              onChange={(event) => setAnalysisFen(event.target.value)}
              disabled={!user}
            />
          </label>
          <label>
            Depth
            <input
              type="number"
              min={1}
              max={40}
              value={analysisDepth}
              onChange={(event) => setAnalysisDepth(Number(event.target.value))}
              disabled={!user}
            />
          </label>
        </div>
        <p className="muted">{analysisStatus}</p>
        {activeAnalysis ? (
          <pre>{JSON.stringify(activeAnalysis, null, 2)}</pre>
        ) : null}
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Exports</h2>
          <div className="button-row">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={includeExportAnnotations}
                onChange={(event) => setIncludeExportAnnotations(event.target.checked)}
                disabled={!user}
              />
              Include annotations
            </label>
            <button onClick={() => void createExportByCurrentFilter()} disabled={!user}>
              Export Current Filter
            </button>
          </div>
        </div>
        <p className="muted">{exportStatus}</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Status</th>
                <th>Mode</th>
                <th>Games</th>
                <th>Output Key</th>
                <th>Download</th>
              </tr>
            </thead>
            <tbody>
              {exportJobs.map((job) => (
                <tr key={job.id}>
                  <td>{job.id}</td>
                  <td>{job.status}</td>
                  <td>{job.mode}</td>
                  <td>{job.exportedGames}</td>
                  <td>{job.outputObjectKey ?? "-"}</td>
                  <td>
                    {job.status === "completed" ? (
                      <a
                        href={`${apiBaseUrl()}/api/exports/${job.id}/download`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Download
                      </a>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))}
              {exportJobs.length === 0 ? (
                <tr>
                  <td colSpan={6}>No export jobs</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Saved Filters</h2>
        </div>

        <div className="button-row">
          <input
            placeholder="Filter name"
            value={filterName}
            onChange={(event) => setFilterName(event.target.value)}
            disabled={!user}
          />
          <button onClick={() => void saveCurrentFilter()} disabled={!user || !filterName.trim()}>
            Save Current Filter
          </button>
        </div>

        <p className="muted">{filterMessage}</p>

        <div className="saved-filters">
          {savedFilters.map((savedFilter) => (
            <div key={savedFilter.id} className="saved-filter-item">
              <div>
                <strong>{savedFilter.name}</strong>
              </div>
              <div className="button-row">
                <button onClick={() => applySavedFilter(savedFilter)} disabled={!user}>Apply</button>
                <button onClick={() => void deleteFilter(savedFilter.id)} disabled={!user}>Delete</button>
              </div>
            </div>
          ))}
          {savedFilters.length === 0 ? <p className="muted">No saved filters</p> : null}
        </div>
      </section>
    </main>
  );
}
