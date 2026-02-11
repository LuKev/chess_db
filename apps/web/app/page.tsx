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
  whiteElo: number | null;
  blackElo: number | null;
  avgElo: number | null;
  tags: TagItem[];
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
  whiteElo: number | null;
  blackElo: number | null;
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
    duplicateReasons?: {
      byMoves: number;
      byCanonical: number;
    };
  };
  strictDuplicateMode?: boolean;
  throughputGamesPerMinute?: number | null;
  createdAt: string;
  updatedAt: string;
};

type ImportListResponse = {
  page: number;
  pageSize: number;
  total: number;
  items: ImportJob[];
};

type ImportErrorItem = {
  id: number;
  lineNumber: number | null;
  gameOffset: number | null;
  message: string;
  createdAt: string;
};

type ImportErrorListResponse = {
  importJobId: number;
  page: number;
  pageSize: number;
  total: number;
  items: ImportErrorItem[];
};

type SavedFilter = {
  id: number;
  name: string;
  query: Record<string, unknown>;
  shareToken: string;
  createdAt: string;
  updatedAt: string;
};

type FilterPreset = {
  id: string;
  name: string;
  description: string;
  query: Record<string, unknown>;
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

type TagItem = {
  id: number;
  name: string;
  color: string | null;
  gameCount?: number;
};

type CollectionItem = {
  id: number;
  name: string;
  description: string | null;
  gameCount: number;
};

type RecentlyViewedGame = {
  id: number;
  label: string;
  openedAt: string;
};

type PositionSearchRow = {
  gameId: number;
  ply: number;
  sideToMove: "w" | "b";
  fenNorm?: string;
  white: string;
  black: string;
  result: string;
  event: string | null;
  snippet: {
    before: string[];
    at: string | null;
    after: string[];
  };
};

type PositionSearchResponse = {
  page: number;
  pageSize: number;
  total: number;
  items: PositionSearchRow[];
  fenNorm: string;
};

type OpeningTreeNode = {
  fenNorm: string;
  totalGames: number;
  moves: Array<{
    moveUci: string;
    nextFenNorm: string | null;
    games: number;
    whiteWins: number;
    blackWins: number;
    draws: number;
    scorePct: number | null;
    popularityPct: number | null;
    avgOpponentStrength: number | null;
    performance: number | null;
    transpositions: number;
    children: OpeningTreeNode[];
  }>;
};

type OpeningTreeResponse = {
  fenNorm: string;
  depth: number;
  tree: OpeningTreeNode;
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
  if (process.env.NEXT_PUBLIC_API_BASE_URL) {
    return process.env.NEXT_PUBLIC_API_BASE_URL;
  }
  if (typeof window !== "undefined") {
    const host = window.location.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1") {
      return "http://localhost:4000";
    }
    if (host.endsWith("kezilu.com")) {
      return "https://api.kezilu.com";
    }
  }
  return "http://localhost:4000";
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
  const [openingPrefix, setOpeningPrefix] = useState("");
  const [eventFilter, setEventFilter] = useState("");
  const [siteFilter, setSiteFilter] = useState("");
  const [result, setResult] = useState("");
  const [timeControl, setTimeControl] = useState("");
  const [rated, setRated] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [whiteEloMin, setWhiteEloMin] = useState("");
  const [whiteEloMax, setWhiteEloMax] = useState("");
  const [blackEloMin, setBlackEloMin] = useState("");
  const [blackEloMax, setBlackEloMax] = useState("");
  const [avgEloMin, setAvgEloMin] = useState("");
  const [avgEloMax, setAvgEloMax] = useState("");
  const [collectionFilterId, setCollectionFilterId] = useState("");
  const [tagFilterId, setTagFilterId] = useState("");
  const [sort, setSort] = useState("date_desc");
  const [page, setPage] = useState(1);

  const [games, setGames] = useState<GamesResponse | null>(null);
  const [tableStatus, setTableStatus] = useState("Sign in to load games");
  const [selectedGameIds, setSelectedGameIds] = useState<number[]>([]);

  const [selectedGameId, setSelectedGameId] = useState<number | null>(null);
  const [selectedGame, setSelectedGame] = useState<GameDetail | null>(null);
  const [recentlyViewedGames, setRecentlyViewedGames] = useState<RecentlyViewedGame[]>([]);
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
  const [annotationSchemaVersion, setAnnotationSchemaVersion] = useState(1);
  const [currentMoveNote, setCurrentMoveNote] = useState("");
  const [currentMoveGlyphs, setCurrentMoveGlyphs] = useState("");
  const [moveNotesByPly, setMoveNotesByPly] = useState<Record<string, unknown>>({});
  const [annotationStatus, setAnnotationStatus] = useState("No annotations loaded");
  const [engineLines, setEngineLines] = useState<EngineLine[]>([]);
  const [engineLineStatus, setEngineLineStatus] = useState("No saved engine lines");

  const [importFile, setImportFile] = useState<File | null>(null);
  const [strictDuplicateImport, setStrictDuplicateImport] = useState(false);
  const [importStatus, setImportStatus] = useState("Sign in to import PGN files");
  const [imports, setImports] = useState<ImportJob[]>([]);
  const [selectedImportId, setSelectedImportId] = useState<number | null>(null);
  const [importErrors, setImportErrors] = useState<ImportErrorItem[]>([]);
  const [importErrorsStatus, setImportErrorsStatus] = useState(
    "Select an import job to inspect parse errors"
  );

  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
  const [filterPresets, setFilterPresets] = useState<FilterPreset[]>([]);
  const [filterName, setFilterName] = useState("");
  const [filterMessage, setFilterMessage] = useState("Sign in to manage saved filters");
  const [pendingSharedFilterToken, setPendingSharedFilterToken] = useState<string | null>(
    null
  );
  const [tags, setTags] = useState<TagItem[]>([]);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#4f8f6b");
  const [tagStatus, setTagStatus] = useState("Sign in to manage tags");
  const [collections, setCollections] = useState<CollectionItem[]>([]);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [collectionStatus, setCollectionStatus] = useState("Sign in to manage collections");

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
  const [positionSearchInput, setPositionSearchInput] = useState(
    "rn1qkbnr/pppb1ppp/3p4/4p3/3PP3/2N2N2/PPP2PPP/R1BQKB1R w KQkq - 0 5"
  );
  const [positionSearchMode, setPositionSearchMode] = useState<"exact" | "material">(
    "exact"
  );
  const [positionMaterialKeyInput, setPositionMaterialKeyInput] = useState("");
  const [positionMaterialSideToMove, setPositionMaterialSideToMove] = useState("");
  const [positionSearchStatus, setPositionSearchStatus] = useState("Sign in to search positions");
  const [positionSearchResults, setPositionSearchResults] = useState<PositionSearchRow[]>([]);
  const [openingTree, setOpeningTree] = useState<OpeningTreeNode | null>(null);
  const [openingTreeStatus, setOpeningTreeStatus] = useState("Open a position to load opening tree");

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
  const hasAnyGames = (games?.total ?? 0) > 0;
  const hasOpenedGame = selectedGame !== null;

  function rememberViewedGame(game: GameDetail): void {
    const entry: RecentlyViewedGame = {
      id: game.id,
      label: `${game.white} vs ${game.black}`,
      openedAt: new Date().toISOString(),
    };
    setRecentlyViewedGames((current) => {
      const withoutDuplicate = current.filter((item) => item.id !== game.id);
      const next = [entry, ...withoutDuplicate].slice(0, 12);
      if (typeof window !== "undefined") {
        window.localStorage.setItem("chessdb_recent_games", JSON.stringify(next));
      }
      return next;
    });
  }

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
    setSelectedGameIds([]);
    setImports([]);
    setSelectedImportId(null);
    setImportErrors([]);
    setImportErrorsStatus("Select an import job to inspect parse errors");
    setExportJobs([]);
    setSavedFilters([]);
    setTags([]);
    setCollections([]);
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
    setAnnotationSchemaVersion(1);
    setMoveNotesByPly({});
    setCurrentMoveNote("");
    setCurrentMoveGlyphs("");
    setEngineLines([]);
    setPositionSearchResults([]);
    setPositionSearchMode("exact");
    setPositionMaterialKeyInput("");
    setPositionMaterialSideToMove("");
    setOpeningTree(null);
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
      openingPrefix,
      event: eventFilter,
      site: siteFilter,
      result,
      timeControl,
      rated,
      fromDate,
      toDate,
      whiteEloMin,
      whiteEloMax,
      blackEloMin,
      blackEloMax,
      avgEloMin,
      avgEloMax,
      collectionId: collectionFilterId || undefined,
      tagId: tagFilterId || undefined,
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
    const visibleIds = new Set(response.data.items.map((item) => item.id));
    setSelectedGameIds((current) => current.filter((id) => visibleIds.has(id)));
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
    rememberViewedGame(game);
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

    const annotations = await fetchJson<AnnotationResponse>(
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
      setAnnotationSchemaVersion(annotations.data.schemaVersion ?? 1);
      setMoveNotesByPly(annotations.data.moveNotes ?? {});
      setAnnotationStatus("Annotations loaded");
    } else {
      setAnnotationText("");
      setAnnotationHighlightsInput("");
      setAnnotationArrowsInput("");
      setAnnotationSchemaVersion(1);
      setMoveNotesByPly({});
      setAnnotationStatus("No annotations found");
    }

    await refreshEngineLines(gameId);
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
          schemaVersion: annotationSchemaVersion,
          moveNotes: moveNotesByPly,
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

  async function refreshImportErrors(importJobId: number): Promise<void> {
    if (!user) {
      setImportErrors([]);
      setImportErrorsStatus("Sign in to inspect import diagnostics");
      return;
    }
    setSelectedImportId(importJobId);
    setImportErrorsStatus(`Loading parse errors for import #${importJobId}...`);
    const response = await fetchJson<ImportErrorListResponse>(
      `/api/imports/${importJobId}/errors?page=1&pageSize=25`,
      {
        method: "GET",
      }
    );
    if (response.status !== 200 || !("items" in response.data)) {
      setImportErrors([]);
      setImportErrorsStatus(
        `Failed to load import diagnostics${"error" in response.data && response.data.error ? `: ${response.data.error}` : ""}`
      );
      return;
    }
    setImportErrors(response.data.items);
    setImportErrorsStatus(
      response.data.total > 0
        ? `${response.data.total} parse error(s) for import #${importJobId}`
        : `No parse errors for import #${importJobId}`
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

  async function refreshFilterPresets(): Promise<void> {
    const response = await fetchJson<{ items: FilterPreset[] }>("/api/filters/presets", {
      method: "GET",
    });
    if (response.status !== 200 || !("items" in response.data)) {
      setFilterPresets([]);
      return;
    }
    setFilterPresets(response.data.items);
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

  async function refreshTags(): Promise<void> {
    if (!user) {
      setTags([]);
      setTagStatus("Sign in to manage tags");
      return;
    }
    const response = await fetchJson<{ items: TagItem[] }>("/api/tags", {
      method: "GET",
    });
    if (response.status !== 200 || !("items" in response.data)) {
      setTagStatus(
        `Failed to load tags${"error" in response.data && response.data.error ? `: ${response.data.error}` : ""}`
      );
      return;
    }
    setTags(response.data.items);
    setTagStatus(response.data.items.length > 0 ? `${response.data.items.length} tag(s)` : "No tags");
  }

  async function refreshCollections(): Promise<void> {
    if (!user) {
      setCollections([]);
      setCollectionStatus("Sign in to manage collections");
      return;
    }
    const response = await fetchJson<{ items: CollectionItem[] }>("/api/collections", {
      method: "GET",
    });
    if (response.status !== 200 || !("items" in response.data)) {
      setCollectionStatus(
        `Failed to load collections${"error" in response.data && response.data.error ? `: ${response.data.error}` : ""}`
      );
      return;
    }
    setCollections(response.data.items);
    setCollectionStatus(
      response.data.items.length > 0
        ? `${response.data.items.length} collection(s)`
        : "No collections"
    );
  }

  async function refreshEngineLines(gameId: number, ply?: number): Promise<void> {
    if (!user) {
      setEngineLines([]);
      setEngineLineStatus("Sign in to load saved lines");
      return;
    }
    const query = ply !== undefined ? `?ply=${ply}` : "";
    const response = await fetchJson<{ items: EngineLine[] }>(
      `/api/games/${gameId}/engine-lines${query}`,
      { method: "GET" }
    );
    if (response.status !== 200 || !("items" in response.data)) {
      setEngineLineStatus(
        `Failed to load engine lines${"error" in response.data && response.data.error ? `: ${response.data.error}` : ""}`
      );
      return;
    }
    setEngineLines(response.data.items);
    setEngineLineStatus(
      response.data.items.length > 0
        ? `${response.data.items.length} saved line(s)`
        : "No saved lines for this position"
    );
  }

  async function createTag(): Promise<void> {
    if (!user || !newTagName.trim()) {
      return;
    }
    const response = await fetchJson<{ id: number }>("/api/tags", {
      method: "POST",
      body: JSON.stringify({
        name: newTagName.trim(),
        color: newTagColor,
      }),
    });
    if (response.status !== 201) {
      setTagStatus(
        `Failed to create tag${"error" in response.data && response.data.error ? `: ${response.data.error}` : ""}`
      );
      return;
    }
    setNewTagName("");
    await refreshTags();
  }

  async function createCollection(): Promise<void> {
    if (!user || !newCollectionName.trim()) {
      return;
    }
    const response = await fetchJson<{ id: number }>("/api/collections", {
      method: "POST",
      body: JSON.stringify({
        name: newCollectionName.trim(),
      }),
    });
    if (response.status !== 201) {
      setCollectionStatus(
        `Failed to create collection${"error" in response.data && response.data.error ? `: ${response.data.error}` : ""}`
      );
      return;
    }
    setNewCollectionName("");
    await refreshCollections();
  }

  async function assignSelectedGamesToCollection(collectionId: number): Promise<void> {
    if (!user || selectedGameIds.length === 0) {
      return;
    }
    const response = await fetchJson<{ assignedCount: number }>(
      `/api/collections/${collectionId}/games`,
      {
        method: "POST",
        body: JSON.stringify({ gameIds: selectedGameIds }),
      }
    );
    if (response.status !== 200) {
      setCollectionStatus(
        `Failed to add games to collection${"error" in response.data && response.data.error ? `: ${response.data.error}` : ""}`
      );
      return;
    }
    setCollectionStatus(`Added ${selectedGameIds.length} game(s) to collection`);
    await refreshCollections();
  }

  async function removeSelectedGamesFromCollection(collectionId: number): Promise<void> {
    if (!user || selectedGameIds.length === 0) {
      return;
    }
    const response = await fetchJson<{ removedCount: number }>(
      `/api/collections/${collectionId}/games`,
      {
        method: "DELETE",
        body: JSON.stringify({ gameIds: selectedGameIds }),
      }
    );
    if (response.status !== 200) {
      setCollectionStatus(
        `Failed to remove games from collection${"error" in response.data && response.data.error ? `: ${response.data.error}` : ""}`
      );
      return;
    }
    const removedCount = "removedCount" in response.data ? response.data.removedCount : 0;
    setCollectionStatus(`Removed ${removedCount} game(s) from collection`);
    await refreshCollections();
  }

  async function assignTagToSelectedGames(tagId: number): Promise<void> {
    if (!user || selectedGameIds.length === 0) {
      return;
    }
    const response = await fetchJson<{ assignedCount: number }>(
      `/api/tags/${tagId}/games`,
      {
        method: "POST",
        body: JSON.stringify({ gameIds: selectedGameIds }),
      }
    );
    if (response.status !== 200) {
      setTagStatus(
        `Failed to assign tag${"error" in response.data && response.data.error ? `: ${response.data.error}` : ""}`
      );
      return;
    }
    const assignedCount = "assignedCount" in response.data ? response.data.assignedCount : 0;
    setTagStatus(`Assigned tag to ${assignedCount} game(s)`);
    await Promise.all([refreshTags(), refreshGames(page)]);
  }

  async function removeTagFromSelectedGames(tagId: number): Promise<void> {
    if (!user || selectedGameIds.length === 0) {
      return;
    }
    const response = await fetchJson<{ removedCount: number }>(
      `/api/tags/${tagId}/games`,
      {
        method: "DELETE",
        body: JSON.stringify({ gameIds: selectedGameIds }),
      }
    );
    if (response.status !== 200) {
      setTagStatus(
        `Failed to remove tag${"error" in response.data && response.data.error ? `: ${response.data.error}` : ""}`
      );
      return;
    }
    const removedCount = "removedCount" in response.data ? response.data.removedCount : 0;
    setTagStatus(`Removed tag from ${removedCount} game(s)`);
    await Promise.all([refreshTags(), refreshGames(page)]);
  }

  async function searchPositionExact(fen: string): Promise<void> {
    setPositionSearchStatus("Searching exact position...");
    const response = await fetchJson<PositionSearchResponse>("/api/search/position", {
      method: "POST",
      body: JSON.stringify({
        fen,
        page: 1,
        pageSize: 30,
      }),
    });
    if (response.status !== 200 || !("items" in response.data)) {
      setPositionSearchStatus(
        `Position search failed${"error" in response.data && response.data.error ? `: ${response.data.error}` : ""}`
      );
      return;
    }
    setPositionSearchResults(response.data.items);
    setPositionSearchStatus(
      response.data.total > 0
        ? `${response.data.total} exact position match(es)`
        : "No matching positions"
    );
  }

  async function searchPositionMaterial(fen: string): Promise<void> {
    setPositionSearchStatus("Searching by material...");
    const response = await fetchJson<PositionSearchResponse>("/api/search/position/material", {
      method: "POST",
      body: JSON.stringify({
        fen,
        materialKey: positionMaterialKeyInput.trim() || undefined,
        sideToMove:
          positionMaterialSideToMove === "w" || positionMaterialSideToMove === "b"
            ? positionMaterialSideToMove
            : undefined,
        page: 1,
        pageSize: 30,
      }),
    });
    if (response.status !== 200 || !("items" in response.data)) {
      setPositionSearchStatus(
        `Material search failed${"error" in response.data && response.data.error ? `: ${response.data.error}` : ""}`
      );
      return;
    }
    setPositionSearchResults(response.data.items);
    setPositionSearchStatus(
      response.data.total > 0
        ? `${response.data.total} material match(es)`
        : "No matching material positions"
    );
  }

  async function searchPosition(): Promise<void> {
    if (!user) {
      return;
    }
    if (positionSearchMode === "material") {
      await searchPositionMaterial(positionSearchInput);
      return;
    }
    await searchPositionExact(positionSearchInput);
  }

  function jumpViewerToFen(fen: string): void {
    if (!selectedGame || fenHistory.length === 0) {
      return;
    }
    const normalizedTarget = fen.trim();
    const index = fenHistory.findIndex((value) => value.trim() === normalizedTarget);
    if (index >= 0) {
      setCursor(index);
      setViewerStatus(`Navigated viewer to matching opening position (ply ${index})`);
    }
  }

  async function loadOpeningTree(fen: string): Promise<void> {
    if (!user) {
      return;
    }
    setOpeningTreeStatus("Loading opening tree...");
    const query = toQuery({
      fen,
      depth: 2,
    });
    const response = await fetchJson<OpeningTreeResponse>(`/api/openings/tree${query}`, {
      method: "GET",
    });
    if (response.status !== 200 || !("tree" in response.data)) {
      setOpeningTreeStatus(
        `Failed to load opening tree${"error" in response.data && response.data.error ? `: ${response.data.error}` : ""}`
      );
      return;
    }
    setOpeningTree(response.data.tree);
    setOpeningTreeStatus("Opening tree loaded");
  }

  async function diveOpeningMove(nextFen: string): Promise<void> {
    setPositionSearchInput(nextFen);
    jumpViewerToFen(nextFen);
    await Promise.all([loadOpeningTree(nextFen), searchPositionExact(nextFen)]);
  }

  async function enqueueBackfill(): Promise<void> {
    if (!user) {
      return;
    }
    await fetchJson("/api/backfill/positions", { method: "POST" });
    await fetchJson("/api/backfill/openings", { method: "POST" });
    setImportStatus("Backfill jobs queued");
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
      refreshTags(),
      refreshCollections(),
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
        whiteElo: 2710,
        blackElo: 2700,
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

  async function createSampleImport(): Promise<void> {
    if (!user) {
      return;
    }

    setImportStatus("Queueing sample PGN import...");
    const response = await fetchJson<{ id: number }>("/api/imports/sample", {
      method: "POST",
    });

    if (response.status !== 201) {
      setImportStatus(
        `Failed to queue sample import${"error" in response.data && response.data.error ? `: ${response.data.error}` : ""}`
      );
      return;
    }

    setImportStatus(`Queued sample import job #${"id" in response.data ? response.data.id : "?"}`);
    await refreshImports();
  }

  async function uploadImportFile(): Promise<void> {
    if (!user || !importFile) {
      return;
    }

    const form = new FormData();
    form.append("file", importFile);

    setImportStatus("Uploading and queueing import job...");
    const response = await fetchJson<{ id: number }>(
      `/api/imports${strictDuplicateImport ? "?strictDuplicate=true" : ""}`,
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
          openingPrefix,
          event: eventFilter,
          site: siteFilter,
          result,
          timeControl,
          rated,
          fromDate,
          toDate,
          whiteEloMin,
          whiteEloMax,
          blackEloMin,
          blackEloMax,
          avgEloMin,
          avgEloMax,
          collectionId: collectionFilterId,
          tagId: tagFilterId,
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

  async function copySharedFilterLink(savedFilter: SavedFilter): Promise<void> {
    if (typeof window === "undefined") {
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set("sharedFilter", savedFilter.shareToken);
    try {
      await navigator.clipboard.writeText(url.toString());
      setFilterMessage(`Copied share link for "${savedFilter.name}"`);
    } catch {
      setFilterMessage("Failed to copy share link");
    }
  }

  async function applySharedFilter(token: string): Promise<void> {
    if (!user) {
      return;
    }
    const response = await fetchJson<SavedFilter>(`/api/filters/shared/${token}`, {
      method: "GET",
    });
    if (response.status !== 200 || !("query" in response.data)) {
      setFilterMessage(
        `Failed to load shared filter${"error" in response.data && response.data.error ? `: ${response.data.error}` : ""}`
      );
      return;
    }
    applySavedFilter(response.data);
    setFilterMessage(`Applied shared filter "${response.data.name}"`);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("sharedFilter");
      window.history.replaceState({}, "", url.toString());
    }
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

    const response = await fetchJson<{ id: number; status: string; cached?: boolean }>("/api/analysis", {
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

    setAnalysisStatus(
      response.data.status === "completed"
        ? `Loaded cached analysis #${response.data.id}`
        : `Queued analysis #${response.data.id}`
    );
    await refreshAnalysis(response.data.id);
    if (response.data.status !== "completed") {
      openAnalysisStream(response.data.id);
    }
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
          openingPrefix,
          event: eventFilter,
          site: siteFilter,
          result,
          timeControl,
          rated,
          fromDate,
          toDate,
          whiteEloMin,
          whiteEloMax,
          blackEloMin,
          blackEloMax,
          avgEloMin,
          avgEloMax,
          collectionId: collectionFilterId || undefined,
          tagId: tagFilterId || undefined,
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

  async function createExportBySelectedGames(): Promise<void> {
    if (!user || selectedGameIds.length === 0) {
      return;
    }

    const response = await fetchJson<{ id: number }>("/api/exports", {
      method: "POST",
      body: JSON.stringify({
        mode: "ids",
        gameIds: selectedGameIds,
        includeAnnotations: includeExportAnnotations,
      }),
    });

    if (response.status !== 201 || !("id" in response.data)) {
      setExportStatus(
        `Failed to queue selected export${"error" in response.data && response.data.error ? `: ${response.data.error}` : ""}`
      );
      return;
    }

    setExportStatus(`Queued selected export job #${response.data.id}`);
    await refreshExports();
  }

  function toggleSelectedGame(gameId: number): void {
    setSelectedGameIds((current) =>
      current.includes(gameId)
        ? current.filter((id) => id !== gameId)
        : [...current, gameId]
    );
  }

  function saveCurrentMoveNoteToState(): void {
    const key = String(cursor);
    setMoveNotesByPly((current) => ({
      ...current,
      [key]: {
        comment: currentMoveNote,
        glyphs: currentMoveGlyphs
          .split(",")
          .map((part) => part.trim())
          .filter((part) => part.length > 0)
          .map((part) => Number(part))
          .filter((value) => Number.isInteger(value) && value > 0),
      },
    }));
    setAnnotationStatus(`Staged move note for ply ${cursor}. Save annotations to persist.`);
  }

  async function saveActiveAnalysisLine(): Promise<void> {
    if (!selectedGameId || !currentFen || !activeAnalysis?.result.pv) {
      return;
    }
    const pvUci = activeAnalysis.result.pv
      .split(/\s+/)
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    const response = await fetchJson<{ id: number }>("/api/analysis/store", {
      method: "POST",
      body: JSON.stringify({
        gameId: selectedGameId,
        ply: cursor,
        fen: currentFen,
        depth: activeAnalysis.limits.depth ?? analysisDepth,
        pvUci,
        evalCp: activeAnalysis.result.evalCp ?? undefined,
        evalMate: activeAnalysis.result.evalMate ?? undefined,
        timeMs: activeAnalysis.limits.timeMs ?? undefined,
        source: "live-analysis",
      }),
    });
    if (response.status !== 201) {
      setEngineLineStatus(
        `Failed to save line${"error" in response.data && response.data.error ? `: ${response.data.error}` : ""}`
      );
      return;
    }
    setEngineLineStatus("Saved current analysis line");
    await refreshEngineLines(selectedGameId, cursor);
  }

  async function deleteEngineLine(lineId: number): Promise<void> {
    const response = await fetchJson<{ error?: string }>(`/api/engine-lines/${lineId}`, {
      method: "DELETE",
    });
    if (response.status !== 204) {
      setEngineLineStatus(
        `Failed to delete line${"error" in response.data && response.data.error ? `: ${response.data.error}` : ""}`
      );
      return;
    }
    if (selectedGameId) {
      await refreshEngineLines(selectedGameId, cursor);
    }
  }

  function selectNotationLine(line: NotationLine): void {
    if (!selectedGame) {
      return;
    }
    setAutoplay(false);
    applyNotationLine(selectedGame.startingFen, line, 0);
  }

  function applySavedFilter(filter: { query: Record<string, unknown> }): void {
    const query = filter.query;

    setPlayer(String(query.player ?? ""));
    setEco(String(query.eco ?? ""));
    setOpeningPrefix(String(query.openingPrefix ?? ""));
    setEventFilter(String(query.event ?? ""));
    setSiteFilter(String(query.site ?? ""));
    setResult(String(query.result ?? ""));
    setTimeControl(String(query.timeControl ?? ""));
    setRated(String(query.rated ?? ""));
    setFromDate(String(query.fromDate ?? ""));
    setToDate(String(query.toDate ?? ""));
    setWhiteEloMin(String(query.whiteEloMin ?? ""));
    setWhiteEloMax(String(query.whiteEloMax ?? ""));
    setBlackEloMin(String(query.blackEloMin ?? ""));
    setBlackEloMax(String(query.blackEloMax ?? ""));
    setAvgEloMin(String(query.avgEloMin ?? ""));
    setAvgEloMax(String(query.avgEloMax ?? ""));
    setCollectionFilterId(String(query.collectionId ?? ""));
    setTagFilterId(String(query.tagId ?? ""));
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
    void refreshFilterPresets();
    if (typeof window !== "undefined") {
      const raw = window.localStorage.getItem("chessdb_recent_games");
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as RecentlyViewedGame[];
          if (Array.isArray(parsed)) {
            setRecentlyViewedGames(
              parsed
                .filter((entry) => Number.isInteger(entry.id) && typeof entry.label === "string")
                .slice(0, 12)
            );
          }
        } catch {
          setRecentlyViewedGames([]);
        }
      }
    }
    if (typeof window !== "undefined") {
      const token = new URLSearchParams(window.location.search).get("sharedFilter");
      if (token && token.trim().length > 0) {
        setPendingSharedFilterToken(token.trim());
        setFilterMessage("Sign in to apply shared filter link");
      }
    }
  }, []);

  useEffect(() => {
    if (!user) {
      return;
    }

    void Promise.all([
      refreshGames(1),
      refreshImports(),
      refreshSavedFilters(),
      refreshExports(),
      refreshTags(),
      refreshCollections(),
    ]);
    setPage(1);
  }, [user]);

  useEffect(() => {
    if (!user || !pendingSharedFilterToken) {
      return;
    }
    void applySharedFilter(pendingSharedFilterToken);
    setPendingSharedFilterToken(null);
  }, [user, pendingSharedFilterToken]);

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
    if (!selectedGame) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName.toLowerCase();
      if (
        tagName === "input" ||
        tagName === "textarea" ||
        tagName === "select" ||
        target?.isContentEditable
      ) {
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setCursor((value) => Math.max(0, value - 1));
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setCursor((value) => Math.min(fenHistory.length - 1, value + 1));
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        setCursor(0);
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        setCursor(Math.max(0, fenHistory.length - 1));
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        setAutoplay((value) => !value);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fenHistory.length, selectedGame]);

  useEffect(() => {
    if (!currentFen) {
      return;
    }
    setAnalysisFen(currentFen);
  }, [currentFen]);

  useEffect(() => {
    const note = moveNotesByPly[String(cursor)] as
      | { comment?: unknown; glyphs?: unknown }
      | undefined;
    setCurrentMoveNote(typeof note?.comment === "string" ? note.comment : "");
    setCurrentMoveGlyphs(
      Array.isArray(note?.glyphs)
        ? note!.glyphs
            .map((glyph) => (typeof glyph === "number" ? String(glyph) : ""))
            .filter((glyph) => glyph.length > 0)
            .join(", ")
        : ""
    );
  }, [cursor, moveNotesByPly]);

  useEffect(() => {
    if (!selectedGameId || !user) {
      return;
    }
    void refreshEngineLines(selectedGameId, cursor);
  }, [selectedGameId, cursor, user]);

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
        <h2>Get Started</h2>
        <ol className="muted">
          <li>{user ? "Done" : "Pending"}: Create or login to your account.</li>
          <li>{hasAnyGames ? "Done" : "Pending"}: Import PGN (or insert a sample game) to seed your DB.</li>
          <li>{hasOpenedGame ? "Done" : "Pending"}: Open a game and start analysis/annotation.</li>
        </ol>
        <div className="button-row">
          <button onClick={() => void createSampleImport()} disabled={!user}>
            Import Sample PGN
          </button>
          <button onClick={() => void createSampleGame()} disabled={!user}>
            Insert Sample Game
          </button>
          <button onClick={() => void enqueueBackfill()} disabled={!user}>
            Run Backfill
          </button>
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Database Home</h2>
          <div className="button-row">
            <button onClick={() => void createSampleImport()} disabled={!user}>
              Import Sample PGN
            </button>
            <button onClick={() => void createSampleGame()} disabled={!user}>
              Insert Sample Game
            </button>
          </div>
        </div>

        <form className="filters" onSubmit={onFilterSubmit}>
          <input placeholder="Player" value={player} onChange={(event) => setPlayer(event.target.value)} />
          <input placeholder="ECO" value={eco} onChange={(event) => setEco(event.target.value)} />
          <input
            placeholder="Opening Prefix (e.g. B9)"
            value={openingPrefix}
            onChange={(event) => setOpeningPrefix(event.target.value)}
          />
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
          <input
            type="number"
            placeholder="White Elo min"
            value={whiteEloMin}
            onChange={(event) => setWhiteEloMin(event.target.value)}
          />
          <input
            type="number"
            placeholder="White Elo max"
            value={whiteEloMax}
            onChange={(event) => setWhiteEloMax(event.target.value)}
          />
          <input
            type="number"
            placeholder="Black Elo min"
            value={blackEloMin}
            onChange={(event) => setBlackEloMin(event.target.value)}
          />
          <input
            type="number"
            placeholder="Black Elo max"
            value={blackEloMax}
            onChange={(event) => setBlackEloMax(event.target.value)}
          />
          <input
            type="number"
            placeholder="Avg Elo min"
            value={avgEloMin}
            onChange={(event) => setAvgEloMin(event.target.value)}
          />
          <input
            type="number"
            placeholder="Avg Elo max"
            value={avgEloMax}
            onChange={(event) => setAvgEloMax(event.target.value)}
          />
          <select
            value={collectionFilterId}
            onChange={(event) => setCollectionFilterId(event.target.value)}
          >
            <option value="">Any collection</option>
            {collections.map((collection) => (
              <option key={collection.id} value={collection.id}>
                {collection.name}
              </option>
            ))}
          </select>
          <select value={tagFilterId} onChange={(event) => setTagFilterId(event.target.value)}>
            <option value="">Any tag</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
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
        <div className="button-row">
          <span>{selectedGameIds.length} selected</span>
          {collections.length > 0 ? (
            <select
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isInteger(value) && value > 0) {
                  void assignSelectedGamesToCollection(value);
                  event.currentTarget.value = "";
                }
              }}
              defaultValue=""
              disabled={!user || selectedGameIds.length === 0}
            >
              <option value="">Add selected to collection</option>
              {collections.map((collection) => (
                <option key={collection.id} value={collection.id}>
                  {collection.name}
                </option>
              ))}
            </select>
          ) : null}
          {collections.length > 0 ? (
            <select
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isInteger(value) && value > 0) {
                  void removeSelectedGamesFromCollection(value);
                  event.currentTarget.value = "";
                }
              }}
              defaultValue=""
              disabled={!user || selectedGameIds.length === 0}
            >
              <option value="">Remove selected from collection</option>
              {collections.map((collection) => (
                <option key={collection.id} value={collection.id}>
                  {collection.name}
                </option>
              ))}
            </select>
          ) : null}
          {tags.length > 0 ? (
            <select
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isInteger(value) && value > 0) {
                  void assignTagToSelectedGames(value);
                  event.currentTarget.value = "";
                }
              }}
              defaultValue=""
              disabled={!user || selectedGameIds.length === 0}
            >
              <option value="">Tag selected games</option>
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </select>
          ) : null}
          {tags.length > 0 ? (
            <select
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isInteger(value) && value > 0) {
                  void removeTagFromSelectedGames(value);
                  event.currentTarget.value = "";
                }
              }}
              defaultValue=""
              disabled={!user || selectedGameIds.length === 0}
            >
              <option value="">Untag selected games</option>
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </select>
          ) : null}
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Select</th>
                <th>ID</th>
                <th>White</th>
                <th>Black</th>
                <th>Result</th>
                <th>Date</th>
                <th>ECO</th>
                <th>Event</th>
                <th>Avg Elo</th>
                <th>Tags</th>
                <th>Ply</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {games?.items.map((game) => (
                <tr key={game.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedGameIds.includes(game.id)}
                      onChange={() => toggleSelectedGame(game.id)}
                    />
                  </td>
                  <td>{game.id}</td>
                  <td>{game.white}</td>
                  <td>{game.black}</td>
                  <td>{game.result}</td>
                  <td>{game.date ?? "-"}</td>
                  <td>{game.eco ?? "-"}</td>
                  <td>{game.event ?? "-"}</td>
                  <td>{game.avgElo ? Math.round(game.avgElo) : "-"}</td>
                  <td>
                    {game.tags.length > 0
                      ? game.tags.map((tag) => tag.name).join(", ")
                      : "-"}
                  </td>
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
                  <td colSpan={12}>No rows</td>
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
        {recentlyViewedGames.length > 0 ? (
          <div className="saved-filters">
            {recentlyViewedGames.map((entry) => (
              <div key={entry.id} className="saved-filter-item">
                <div>
                  <strong>{entry.label}</strong>
                  <p className="muted">{new Date(entry.openedAt).toLocaleString()}</p>
                </div>
                <button onClick={() => void openGameViewer(entry.id)} disabled={!user}>
                  Reopen #{entry.id}
                </button>
              </div>
            ))}
          </div>
        ) : null}

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
              {selectedGame.whiteElo || selectedGame.blackElo ? (
                <p className="muted">
                  Elo: {selectedGame.whiteElo ?? "-"} / {selectedGame.blackElo ?? "-"}
                </p>
              ) : null}
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
              <label>
                Move Note (current ply)
                <input
                  value={currentMoveNote}
                  onChange={(event) => setCurrentMoveNote(event.target.value)}
                />
              </label>
              <label>
                Move Glyphs (NAG numbers, comma-separated)
                <input
                  value={currentMoveGlyphs}
                  onChange={(event) => setCurrentMoveGlyphs(event.target.value)}
                />
              </label>
              {annotationArrows.length > 0 ? (
                <p className="muted">Arrows: {annotationArrows.join(", ")}</p>
              ) : null}
              <div className="button-row">
                <button onClick={() => saveCurrentMoveNoteToState()} disabled={!selectedGameId}>
                  Stage Move Note
                </button>
                <button onClick={() => void saveAnnotations()} disabled={!selectedGameId}>
                  Save Notes
                </button>
                <button onClick={() => void loadOpeningTree(currentFen ?? analysisFen)} disabled={!currentFen}>
                  Opening Tree
                </button>
              </div>
              <p className="muted">{annotationStatus}</p>
              <p className="muted">{engineLineStatus}</p>
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
              <h3>Saved Engine Lines</h3>
              <div className="line-list">
                {engineLines.map((line) => (
                  <div key={line.id} className="saved-filter-item">
                    <div>
                      <strong>ply {line.ply}</strong> | depth {line.depth ?? "-"} | eval{" "}
                      {line.evalMate !== null ? `#${line.evalMate}` : line.evalCp}
                      <div className="muted">{line.pvUci.join(" ") || "-"}</div>
                    </div>
                    <button onClick={() => void deleteEngineLine(line.id)}>Delete</button>
                  </div>
                ))}
                {engineLines.length === 0 ? (
                  <p className="muted">No saved lines at this ply</p>
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
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={strictDuplicateImport}
                onChange={(event) => setStrictDuplicateImport(event.target.checked)}
                disabled={!user}
              />
              Strict duplicate mode
            </label>
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
                <th>Dup:Move</th>
                <th>Dup:Canonical</th>
                <th>Parse Errors</th>
                <th>Mode</th>
                <th>Updated</th>
                <th>Diagnostics</th>
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
                  <td>{job.totals.duplicateReasons?.byMoves ?? 0}</td>
                  <td>{job.totals.duplicateReasons?.byCanonical ?? 0}</td>
                  <td>{job.totals.parseErrors}</td>
                  <td>{job.strictDuplicateMode ? "strict" : "default"}</td>
                  <td>{new Date(job.updatedAt).toLocaleString()}</td>
                  <td>
                    <button
                      onClick={() => void refreshImportErrors(job.id)}
                      disabled={!user}
                    >
                      Inspect
                    </button>
                  </td>
                </tr>
              ))}
              {imports.length === 0 ? (
                <tr>
                  <td colSpan={11}>No import jobs</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="muted">{importErrorsStatus}</p>
        {selectedImportId ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Error ID</th>
                  <th>Line</th>
                  <th>Game Offset</th>
                  <th>Message</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {importErrors.map((error) => (
                  <tr key={error.id}>
                    <td>{error.id}</td>
                    <td>{error.lineNumber ?? "-"}</td>
                    <td>{error.gameOffset ?? "-"}</td>
                    <td>{error.message}</td>
                    <td>{new Date(error.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
                {importErrors.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No parse errors for this import job</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Engine Analysis</h2>
          <div className="button-row">
            <button onClick={() => void createAnalysis()} disabled={!user}>Analyze Position</button>
            <button
              onClick={() => void saveActiveAnalysisLine()}
              disabled={!user || !selectedGameId || !activeAnalysis || !activeAnalysis.result.pv}
            >
              Save Line
            </button>
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
            <button
              onClick={() => void createExportBySelectedGames()}
              disabled={!user || selectedGameIds.length === 0}
            >
              Export Selected ({selectedGameIds.length})
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
          <h2>Position Search</h2>
          <div className="button-row">
            <button onClick={() => void searchPosition()} disabled={!user}>
              {positionSearchMode === "material" ? "Search Material" : "Search FEN"}
            </button>
            <button
              onClick={() => {
                if (currentFen) {
                  setPositionSearchInput(currentFen);
                }
              }}
              disabled={!user || !currentFen}
            >
              Use Viewer FEN
            </button>
          </div>
        </div>
        <div className="analysis-grid">
          <label>
            Mode
            <select
              value={positionSearchMode}
              onChange={(event) =>
                setPositionSearchMode(event.target.value === "material" ? "material" : "exact")
              }
              disabled={!user}
            >
              <option value="exact">Exact FEN</option>
              <option value="material">Material Profile</option>
            </select>
          </label>
          <label>
            FEN
            <input
              value={positionSearchInput}
              onChange={(event) => setPositionSearchInput(event.target.value)}
              disabled={!user}
            />
          </label>
          {positionSearchMode === "material" ? (
            <label>
              Material Key (optional override)
              <input
                value={positionMaterialKeyInput}
                onChange={(event) => setPositionMaterialKeyInput(event.target.value)}
                placeholder="e.g. b:b1k1n2p7q1r2:w:b1k1n2p7q1r2"
                disabled={!user}
              />
            </label>
          ) : null}
          {positionSearchMode === "material" ? (
            <label>
              Side to Move
              <select
                value={positionMaterialSideToMove}
                onChange={(event) => setPositionMaterialSideToMove(event.target.value)}
                disabled={!user}
              >
                <option value="">Either</option>
                <option value="w">White</option>
                <option value="b">Black</option>
              </select>
            </label>
          ) : null}
        </div>
        <p className="muted">{positionSearchStatus}</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Game</th>
                <th>Ply</th>
                <th>Players</th>
                <th>FEN</th>
                <th>Snippet</th>
                <th>Open</th>
              </tr>
            </thead>
            <tbody>
              {positionSearchResults.map((row) => (
                <tr key={`${row.gameId}-${row.ply}`}>
                  <td>{row.gameId}</td>
                  <td>{row.ply}</td>
                  <td>
                    {row.white} vs {row.black} ({row.result})
                  </td>
                  <td>{row.fenNorm ?? "-"}</td>
                  <td>
                    {row.snippet.before.join(" ")}{" "}
                    <strong>{row.snippet.at ?? ""}</strong>{" "}
                    {row.snippet.after.join(" ")}
                  </td>
                  <td>
                    <button
                      onClick={() => {
                        void (async () => {
                          await openGameViewer(row.gameId);
                          setCursor(row.ply);
                        })();
                      }}
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
              {positionSearchResults.length === 0 ? (
                <tr>
                  <td colSpan={6}>No position results</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Opening Explorer</h2>
          <div className="button-row">
            <button onClick={() => void loadOpeningTree(currentFen ?? positionSearchInput)} disabled={!user}>
              Refresh Tree
            </button>
          </div>
        </div>
        <p className="muted">{openingTreeStatus}</p>
        {openingTree ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Move (UCI)</th>
                  <th>Games</th>
                  <th>Popularity %</th>
                  <th>Score %</th>
                  <th>Avg Elo</th>
                  <th>Transpositions</th>
                  <th>Next</th>
                </tr>
              </thead>
              <tbody>
                {openingTree.moves.map((move) => (
                  <tr key={move.moveUci}>
                    <td>{move.moveUci}</td>
                    <td>{move.games}</td>
                    <td>{move.popularityPct?.toFixed(1) ?? "-"}</td>
                    <td>{move.scorePct?.toFixed(1) ?? "-"}</td>
                    <td>{move.avgOpponentStrength?.toFixed(0) ?? "-"}</td>
                    <td>{move.transpositions}</td>
                    <td>
                      {move.nextFenNorm ? (
                        <button
                          onClick={() => {
                            void diveOpeningMove(move.nextFenNorm ?? "");
                          }}
                        >
                          Dive
                        </button>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Collections</h2>
        </div>
        <div className="button-row">
          <input
            placeholder="Collection name"
            value={newCollectionName}
            onChange={(event) => setNewCollectionName(event.target.value)}
            disabled={!user}
          />
          <button onClick={() => void createCollection()} disabled={!user || !newCollectionName.trim()}>
            Create Collection
          </button>
        </div>
        <p className="muted">{collectionStatus}</p>
        <div className="saved-filters">
          {collections.map((collection) => (
            <div key={collection.id} className="saved-filter-item">
              <div>
                <strong>{collection.name}</strong> ({collection.gameCount})
              </div>
              <button onClick={() => setCollectionFilterId(String(collection.id))}>Filter</button>
            </div>
          ))}
          {collections.length === 0 ? <p className="muted">No collections yet</p> : null}
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Tags</h2>
        </div>
        <div className="button-row">
          <input
            placeholder="Tag name"
            value={newTagName}
            onChange={(event) => setNewTagName(event.target.value)}
            disabled={!user}
          />
          <input
            type="color"
            value={newTagColor}
            onChange={(event) => setNewTagColor(event.target.value)}
            disabled={!user}
          />
          <button onClick={() => void createTag()} disabled={!user || !newTagName.trim()}>
            Create Tag
          </button>
        </div>
        <p className="muted">{tagStatus}</p>
        <div className="saved-filters">
          {tags.map((tag) => (
            <div key={tag.id} className="saved-filter-item">
              <div>
                <strong style={{ color: tag.color ?? undefined }}>{tag.name}</strong> ({tag.gameCount ?? 0})
              </div>
              <button onClick={() => setTagFilterId(String(tag.id))}>Filter</button>
            </div>
          ))}
          {tags.length === 0 ? <p className="muted">No tags yet</p> : null}
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
          {filterPresets.map((preset) => (
            <div key={preset.id} className="saved-filter-item">
              <div>
                <strong>{preset.name}</strong>
                <p className="muted">{preset.description}</p>
              </div>
              <div className="button-row">
                <button onClick={() => applySavedFilter(preset)} disabled={!user}>
                  Apply Preset
                </button>
              </div>
            </div>
          ))}
          {filterPresets.length === 0 ? <p className="muted">No presets available</p> : null}
        </div>

        <div className="saved-filters">
          {savedFilters.map((savedFilter) => (
            <div key={savedFilter.id} className="saved-filter-item">
              <div>
                <strong>{savedFilter.name}</strong>
              </div>
              <div className="button-row">
                <button onClick={() => applySavedFilter(savedFilter)} disabled={!user}>Apply</button>
                <button onClick={() => void copySharedFilterLink(savedFilter)} disabled={!user}>
                  Share
                </button>
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
