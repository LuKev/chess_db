"use client";

import Link from "next/link";
import { type CSSProperties, type ReactNode, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "../../../lib/api";
import { useToasts } from "../../../components/ToastsProvider";
import { GameViewerPanel } from "../../../components/GameViewerPanel";

type TagItem = {
  id: number;
  name: string;
  color: string | null;
  gameCount?: number;
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
  whiteElo: number | null;
  blackElo: number | null;
  tags: TagItem[];
};

type GamesResponse = {
  page: number;
  pageSize: number;
  total: number;
  items: GameRow[];
};

type CollectionItem = {
  id: number;
  name: string;
  description: string | null;
  gameCount: number;
};

type GameColumnId =
  | "id"
  | "white"
  | "black"
  | "result"
  | "date"
  | "eco"
  | "event"
  | "whiteElo"
  | "blackElo"
  | "tags"
  | "plyCount";

type GameColumn = {
  id: GameColumnId;
  label: string;
  compact?: boolean;
  defaultVisible?: boolean;
};

const GAMES_DISPLAY_STORAGE_KEY = "chessdb.games.display.v1";
const PAGE_SIZE_OPTIONS = [25, 50, 100, 150] as const;
const DEFAULT_FONT_SIZE = 13;
const DEFAULT_COLUMN_WIDTH = 170;

const GAME_COLUMNS: GameColumn[] = [
  { id: "id", label: "ID", compact: true },
  { id: "white", label: "White" },
  { id: "black", label: "Black" },
  { id: "result", label: "Result", compact: true },
  { id: "date", label: "Date", compact: true },
  { id: "eco", label: "ECO", compact: true },
  { id: "event", label: "Event", defaultVisible: false },
  { id: "whiteElo", label: "White Elo", compact: true },
  { id: "blackElo", label: "Black Elo", compact: true },
  { id: "tags", label: "Tags", defaultVisible: false },
  { id: "plyCount", label: "Ply", compact: true },
];

const DEFAULT_VISIBLE_COLUMNS = GAME_COLUMNS.filter((column) => column.defaultVisible !== false).map((column) => column.id);

function isPageSizeOption(value: number): value is (typeof PAGE_SIZE_OPTIONS)[number] {
  return PAGE_SIZE_OPTIONS.includes(value as (typeof PAGE_SIZE_OPTIONS)[number]);
}

function normalizeVisibleColumns(raw: unknown): GameColumnId[] {
  if (!Array.isArray(raw)) {
    return DEFAULT_VISIBLE_COLUMNS;
  }

  const known = new Set(GAME_COLUMNS.map((column) => column.id));
  const values = raw.filter((value): value is GameColumnId => typeof value === "string" && known.has(value as GameColumnId));
  return values.length > 0 ? GAME_COLUMNS.filter((column) => values.includes(column.id)).map((column) => column.id) : DEFAULT_VISIBLE_COLUMNS;
}

function columnCellStyle(column: GameColumn): CSSProperties {
  return {
    minWidth: column.compact ? "84px" : "var(--games-column-width)",
  };
}

function renderGameCell(game: GameRow, columnId: GameColumnId): { content: ReactNode; title?: string } {
  switch (columnId) {
    case "id":
      return { content: game.id, title: String(game.id) };
    case "white":
      return { content: game.white, title: game.white };
    case "black":
      return { content: game.black, title: game.black };
    case "result":
      return { content: game.result, title: game.result };
    case "date":
      return { content: game.date ?? "-", title: game.date ?? undefined };
    case "eco":
      return { content: game.eco ?? "-", title: game.eco ?? undefined };
    case "event":
      return { content: game.event ?? "-", title: game.event ?? undefined };
    case "whiteElo":
      return { content: game.whiteElo ?? "-", title: typeof game.whiteElo === "number" ? String(game.whiteElo) : undefined };
    case "blackElo":
      return { content: game.blackElo ?? "-", title: typeof game.blackElo === "number" ? String(game.blackElo) : undefined };
    case "tags": {
      const tags = game.tags.length > 0 ? game.tags.map((tag) => tag.name).join(", ") : "-";
      return { content: tags, title: tags !== "-" ? tags : undefined };
    }
    case "plyCount":
      return { content: game.plyCount ?? "-", title: typeof game.plyCount === "number" ? String(game.plyCount) : undefined };
  }
}

export default function GamesPage() {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<"date_desc" | "date_asc" | "white" | "black" | "eco">("date_desc");
  const [player, setPlayer] = useState("");
  const [eco, setEco] = useState("");
  const [openingPrefix, setOpeningPrefix] = useState("");
  const [eventFilter, setEventFilter] = useState("");
  const [result, setResult] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [whiteEloMin, setWhiteEloMin] = useState("");
  const [whiteEloMax, setWhiteEloMax] = useState("");
  const [blackEloMin, setBlackEloMin] = useState("");
  const [blackEloMax, setBlackEloMax] = useState("");
  const [collectionId, setCollectionId] = useState<number | "">("");
  const [tagId, setTagId] = useState<number | "">("");
  const [positionFen, setPositionFen] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [viewerGameId, setViewerGameId] = useState<number | null>(null);
  const [pageSize, setPageSize] = useState<number>(50);
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const [columnWidth, setColumnWidth] = useState(DEFAULT_COLUMN_WIDTH);
  const [visibleColumns, setVisibleColumns] = useState<GameColumnId[]>(DEFAULT_VISIBLE_COLUMNS);

  const queryClient = useQueryClient();
  const toasts = useToasts();

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const parsed = new URLSearchParams(window.location.search);
    const pos = parsed.get("positionFen");
    if (pos && pos.trim()) {
      setPositionFen(pos.trim());
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const raw = window.localStorage.getItem(GAMES_DISPLAY_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (typeof parsed.pageSize === "number" && isPageSizeOption(parsed.pageSize)) {
        setPageSize(parsed.pageSize);
      }
      if (typeof parsed.fontSize === "number" && parsed.fontSize >= 12 && parsed.fontSize <= 16) {
        setFontSize(parsed.fontSize);
      }
      if (typeof parsed.columnWidth === "number" && parsed.columnWidth >= 120 && parsed.columnWidth <= 260) {
        setColumnWidth(parsed.columnWidth);
      }
      setVisibleColumns(normalizeVisibleColumns(parsed.visibleColumns));
    } catch {
      // Ignore malformed local preferences and fall back to defaults.
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      GAMES_DISPLAY_STORAGE_KEY,
      JSON.stringify({
        pageSize,
        fontSize,
        columnWidth,
        visibleColumns,
      })
    );
  }, [pageSize, fontSize, columnWidth, visibleColumns]);

  const filtersQuery = useMemo(() => {
    const params = new URLSearchParams();
    params.set("pageSize", String(pageSize));
    params.set("sort", sort);
    if (player.trim()) params.set("player", player.trim());
    if (eco.trim()) params.set("eco", eco.trim());
    if (openingPrefix.trim()) params.set("openingPrefix", openingPrefix.trim());
    if (eventFilter.trim()) params.set("event", eventFilter.trim());
    if (result.trim()) params.set("result", result.trim());
    if (fromDate.trim()) params.set("fromDate", fromDate.trim());
    if (toDate.trim()) params.set("toDate", toDate.trim());
    if (whiteEloMin.trim()) params.set("whiteEloMin", whiteEloMin.trim());
    if (whiteEloMax.trim()) params.set("whiteEloMax", whiteEloMax.trim());
    if (blackEloMin.trim()) params.set("blackEloMin", blackEloMin.trim());
    if (blackEloMax.trim()) params.set("blackEloMax", blackEloMax.trim());
    if (collectionId !== "") params.set("collectionId", String(collectionId));
    if (tagId !== "") params.set("tagId", String(tagId));
    if (positionFen.trim()) params.set("positionFen", positionFen.trim());
    return params.toString();
  }, [
    pageSize,
    sort,
    player,
    eco,
    openingPrefix,
    eventFilter,
    result,
    fromDate,
    toDate,
    whiteEloMin,
    whiteEloMax,
    blackEloMin,
    blackEloMax,
    collectionId,
    tagId,
    positionFen,
  ]);

  useEffect(() => {
    setPage(1);
    clearSelection();
  }, [filtersQuery]);

  const query = useMemo(() => {
    const params = new URLSearchParams(filtersQuery);
    params.set("page", String(page));
    return `?${params.toString()}`;
  }, [filtersQuery, page]);

  const games = useQuery({
    queryKey: [
      "games",
      {
        page,
        pageSize,
        sort,
        player,
        eco,
        openingPrefix,
        eventFilter,
        result,
        fromDate,
        toDate,
        whiteEloMin,
        whiteEloMax,
        blackEloMin,
        blackEloMax,
        collectionId,
        tagId,
        positionFen,
      },
    ],
    queryFn: async (): Promise<GamesResponse> => {
      const response = await fetchJson<GamesResponse>(`/api/games${query}`, { method: "GET" });
      if (response.status === 200 && "items" in response.data) {
        return response.data;
      }
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to load games (status ${response.status})`;
      throw new Error(msg);
    },
  });

  const tags = useQuery({
    queryKey: ["tags"],
    queryFn: async (): Promise<TagItem[]> => {
      const response = await fetchJson<{ items: TagItem[] }>("/api/tags", { method: "GET" });
      if (response.status === 200 && "items" in response.data) {
        return response.data.items;
      }
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to load tags (status ${response.status})`;
      throw new Error(msg);
    },
  });

  const collections = useQuery({
    queryKey: ["collections"],
    queryFn: async (): Promise<CollectionItem[]> => {
      const response = await fetchJson<{ items: CollectionItem[] }>("/api/collections", { method: "GET" });
      if (response.status === 200 && "items" in response.data) {
        return response.data.items;
      }
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to load collections (status ${response.status})`;
      throw new Error(msg);
    },
  });

  async function queueSampleImport(): Promise<void> {
    const response = await fetchJson<{ id: number }>("/api/imports/sample", { method: "POST" });
    if (response.status !== 201) {
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to queue sample import (status ${response.status})`;
      toasts.pushToast({ kind: "error", message: msg });
      return;
    }
    toasts.pushToast({
      kind: "success",
      message: `Queued sample import (#${"id" in response.data ? response.data.id : "?"}). See Import page for status.`,
    });
  }

  async function queueStarterImport(): Promise<void> {
    const response = await fetchJson<{ id: number }>("/api/imports/starter", {
      method: "POST",
      body: JSON.stringify({ maxGames: 1000 }),
    });
    if (response.status !== 201) {
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to queue starter import (status ${response.status})`;
      toasts.pushToast({ kind: "error", message: msg });
      return;
    }
    toasts.pushToast({
      kind: "success",
      message: `Queued starter import (#${"id" in response.data ? response.data.id : "?"}). See Import page for status.`,
    });
  }

  async function createSampleGame(): Promise<void> {
    const sampleHash = `sample-${Date.now()}`;
    const pgnText = [
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
    const mainline = [
      "e4",
      "c5",
      "Nf3",
      "e6",
      "d4",
      "cxd4",
      "Nxd4",
      "Nc6",
      "Nb5",
      "d6",
      "c4",
      "Nf6",
      "N1c3",
      "a6",
      "Na3",
      "d5",
      "cxd5",
      "exd5",
      "exd5",
      "Nb4",
      "Be2",
      "Bc5",
      "O-O",
      "O-O",
      "Bf3",
      "Bf5",
      "Bg5",
      "Re8",
      "Qd2",
      "b5",
      "Rad1",
      "Nd3",
      "Nab1",
      "h6",
      "Bh4",
      "b4",
      "Na4",
      "Bd6",
      "Bg3",
      "Rc8",
      "b3",
      "g5",
      "Bxd6",
      "Qxd6",
      "g3",
      "Nd7",
      "Bg2",
      "Qf6",
      "a3",
      "a5",
      "axb4",
      "axb4",
      "Qa2",
      "Bg6",
      "d6",
      "g4",
      "Qd2",
      "Kg7",
      "f3",
      "Qxd6",
      "fxg4",
      "Qd4+",
      "Kh1",
      "Nf6",
      "Rf4",
      "Ne4",
      "Qxd3",
      "Nf2+",
      "Rxf2",
      "Bxd3",
      "Rfd2",
      "Qe3",
      "Rxd3",
      "Rc1",
      "Nb2",
      "Qf2",
      "Nd2",
      "Rxd1+",
      "Nxd1",
      "Re1+",
    ];
    const response = await fetchJson<{ id: number }>("/api/games", {
      method: "POST",
      body: JSON.stringify({
        white: "Karpov, Anatoly",
        black: "Kasparov, Garry",
        result: "0-1",
        eco: "B44",
        event: "World Chess Championship 1985",
        site: "Moscow URS",
        date: "1985-10-15",
        whiteElo: 2700,
        blackElo: 2710,
        plyCount: mainline.length,
        startingFen: "startpos",
        movesHash: sampleHash,
        pgn: pgnText,
        moveTree: {
          mainline,
        },
      }),
    });

    if (response.status >= 400) {
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : "Failed to insert sample game";
      toasts.pushToast({ kind: "error", message: msg });
      return;
    }

    toasts.pushToast({ kind: "success", message: "Inserted sample game" });
    await queryClient.invalidateQueries({ queryKey: ["games"] });
    setPage(1);
  }

  function toggleSelected(gameId: number): void {
    setSelected((current) => (current.includes(gameId) ? current.filter((id) => id !== gameId) : [...current, gameId]));
  }

  function clearSelection(): void {
    setSelected([]);
  }

  function toggleVisibleColumn(columnId: GameColumnId): void {
    setVisibleColumns((current) => {
      if (current.includes(columnId)) {
        return current.length > 1 ? current.filter((value) => value !== columnId) : current;
      }
      return GAME_COLUMNS.filter((column) => current.includes(column.id) || column.id === columnId).map((column) => column.id);
    });
  }

  function resetDisplaySettings(): void {
    setPageSize(50);
    setFontSize(DEFAULT_FONT_SIZE);
    setColumnWidth(DEFAULT_COLUMN_WIDTH);
    setVisibleColumns(DEFAULT_VISIBLE_COLUMNS);
  }

  async function bulkAddToCollection(targetCollectionId: number): Promise<void> {
    if (selected.length === 0) {
      return;
    }
    const response = await fetchJson<{ ok: boolean }>(`/api/collections/${targetCollectionId}/games`, {
      method: "POST",
      body: JSON.stringify({ gameIds: selected }),
    });
    if (response.status !== 200) {
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to add to collection (status ${response.status})`;
      toasts.pushToast({ kind: "error", message: msg });
      return;
    }
    toasts.pushToast({ kind: "success", message: "Added games to collection" });
    await queryClient.invalidateQueries({ queryKey: ["games"] });
    clearSelection();
  }

  async function bulkRemoveFromCollection(targetCollectionId: number): Promise<void> {
    if (selected.length === 0) {
      return;
    }
    const response = await fetchJson<{ ok: boolean }>(`/api/collections/${targetCollectionId}/games`, {
      method: "DELETE",
      body: JSON.stringify({ gameIds: selected }),
    });
    if (response.status !== 200) {
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to remove from collection (status ${response.status})`;
      toasts.pushToast({ kind: "error", message: msg });
      return;
    }
    toasts.pushToast({ kind: "success", message: "Removed games from collection" });
    await queryClient.invalidateQueries({ queryKey: ["games"] });
    clearSelection();
  }

  async function bulkTag(targetTagId: number): Promise<void> {
    if (selected.length === 0) {
      return;
    }
    const response = await fetchJson<{ ok: boolean }>(`/api/tags/${targetTagId}/games`, {
      method: "POST",
      body: JSON.stringify({ gameIds: selected }),
    });
    if (response.status !== 200) {
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to tag games (status ${response.status})`;
      toasts.pushToast({ kind: "error", message: msg });
      return;
    }
    toasts.pushToast({ kind: "success", message: "Tagged games" });
    await queryClient.invalidateQueries({ queryKey: ["games"] });
    clearSelection();
  }

  async function bulkUntag(targetTagId: number): Promise<void> {
    if (selected.length === 0) {
      return;
    }
    const response = await fetchJson<{ ok: boolean }>(`/api/tags/${targetTagId}/games`, {
      method: "DELETE",
      body: JSON.stringify({ gameIds: selected }),
    });
    if (response.status !== 200) {
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to untag games (status ${response.status})`;
      toasts.pushToast({ kind: "error", message: msg });
      return;
    }
    toasts.pushToast({ kind: "success", message: "Untagged games" });
    await queryClient.invalidateQueries({ queryKey: ["games"] });
    clearSelection();
  }

  async function exportSelected(): Promise<void> {
    if (selected.length === 0) {
      return;
    }
    const response = await fetchJson<{ id: number; status: string }>("/api/exports", {
      method: "POST",
      body: JSON.stringify({ mode: "ids", gameIds: selected, includeAnnotations: true }),
    });
    if (response.status !== 201 && response.status !== 200) {
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to queue export (status ${response.status})`;
      toasts.pushToast({ kind: "error", message: msg });
      return;
    }
    toasts.pushToast({ kind: "success", message: "Export queued (see Exports page)" });
    clearSelection();
  }

  function clearFilters(): void {
    setSort("date_desc");
    setPlayer("");
    setEco("");
    setOpeningPrefix("");
    setEventFilter("");
    setResult("");
    setFromDate("");
    setToDate("");
    setWhiteEloMin("");
    setWhiteEloMax("");
    setBlackEloMin("");
    setBlackEloMax("");
    setCollectionId("");
    setTagId("");
    setPositionFen("");
    setPage(1);
    clearSelection();
  }

  const visibleTableColumns = GAME_COLUMNS.filter((column) => visibleColumns.includes(column.id));
  const tableStyle = {
    "--games-font-size": `${fontSize}px`,
    "--games-column-width": `${columnWidth}px`,
  } as CSSProperties;
  const pageCount = games.data ? Math.max(1, Math.ceil(games.data.total / games.data.pageSize)) : 1;

  return (
    <main>
      <section className="card">
        <h2>Games</h2>
        <p className="muted">Browse and open games in your database.</p>

        <div className="button-row">
          <button type="button" onClick={() => void createSampleGame()}>
            Insert sample game
          </button>
          <Link href="/import">Import PGN</Link>
        </div>
      </section>

      <div className={`games-layout ${viewerGameId ? "with-viewer" : ""}`}>
        <section className="card">
          <div className="section-head">
            <div>
              <h2>Game List</h2>
              <p className="muted">Filters update immediately, and display settings stay on this browser.</p>
            </div>
            <div className="button-row">
              <button type="button" onClick={() => void games.refetch()} disabled={games.isFetching}>
                Refresh
              </button>
              {viewerGameId ? (
                <button type="button" onClick={() => setViewerGameId(null)}>
                  Close viewer
                </button>
              ) : null}
            </div>
          </div>

          <div className="games-controls">
            <div className="games-control-stack">
              <section className="games-control-panel">
                <div className="games-control-head">
                  <div>
                    <h3>Filters</h3>
                    <p className="muted">Use search, metadata, and position filters without collapsing the table.</p>
                  </div>
                  <button type="button" onClick={() => clearFilters()}>
                    Clear filters
                  </button>
                </div>

                <div className="games-filter-grid">
                  <label>
                    Sort
                    <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
                      <option value="date_desc">Date desc</option>
                      <option value="date_asc">Date asc</option>
                      <option value="white">White</option>
                      <option value="black">Black</option>
                      <option value="eco">ECO</option>
                    </select>
                  </label>
                  <label>
                    Player
                    <input value={player} onChange={(event) => setPlayer(event.target.value)} placeholder="Kasparov" />
                  </label>
                  <label>
                    Event
                    <input value={eventFilter} onChange={(event) => setEventFilter(event.target.value)} placeholder="World Championship" />
                  </label>
                  <label>
                    ECO (exact)
                    <input value={eco} onChange={(event) => setEco(event.target.value)} placeholder="B44" />
                  </label>
                  <label>
                    Opening prefix
                    <input value={openingPrefix} onChange={(event) => setOpeningPrefix(event.target.value)} placeholder="B" />
                  </label>
                  <label>
                    Result
                    <input value={result} onChange={(event) => setResult(event.target.value)} placeholder="1-0" />
                  </label>
                  <label>
                    From date
                    <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
                  </label>
                  <label>
                    To date
                    <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
                  </label>
                  <label>
                    Collection
                    <select
                      value={collectionId}
                      onChange={(event) => {
                        const raw = event.target.value;
                        setCollectionId(raw ? Number(raw) : "");
                      }}
                    >
                      <option value="">All</option>
                      {collections.data?.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.gameCount})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Tag
                    <select
                      value={tagId}
                      onChange={(event) => {
                        const raw = event.target.value;
                        setTagId(raw ? Number(raw) : "");
                      }}
                    >
                      <option value="">All</option>
                      {tags.data?.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                          {typeof t.gameCount === "number" ? ` (${t.gameCount})` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="games-filter-span-2">
                    Position FEN
                    <input
                      value={positionFen}
                      onChange={(event) => setPositionFen(event.target.value)}
                      placeholder="startpos or FEN"
                    />
                  </label>
                </div>
              </section>

              <section className="games-control-panel">
                <div className="games-control-head">
                  <div>
                    <h3>Ratings</h3>
                    <p className="muted">Filter specific white and black rating ranges separately.</p>
                  </div>
                </div>

                <div className="games-filter-grid games-filter-grid-compact">
                  <label>
                    White Elo min
                    <input
                      type="number"
                      min="1"
                      max="4000"
                      value={whiteEloMin}
                      onChange={(event) => setWhiteEloMin(event.target.value)}
                      placeholder="1800"
                    />
                  </label>
                  <label>
                    White Elo max
                    <input
                      type="number"
                      min="1"
                      max="4000"
                      value={whiteEloMax}
                      onChange={(event) => setWhiteEloMax(event.target.value)}
                      placeholder="2800"
                    />
                  </label>
                  <label>
                    Black Elo min
                    <input
                      type="number"
                      min="1"
                      max="4000"
                      value={blackEloMin}
                      onChange={(event) => setBlackEloMin(event.target.value)}
                      placeholder="1800"
                    />
                  </label>
                  <label>
                    Black Elo max
                    <input
                      type="number"
                      min="1"
                      max="4000"
                      value={blackEloMax}
                      onChange={(event) => setBlackEloMax(event.target.value)}
                      placeholder="2800"
                    />
                  </label>
                </div>
              </section>
            </div>

            <aside className="games-control-panel games-display-panel">
              <div className="games-control-head">
                <div>
                  <h3>Display</h3>
                  <p className="muted">Make the table denser without losing the columns you care about.</p>
                </div>
                <button type="button" onClick={() => resetDisplaySettings()}>
                  Reset display
                </button>
              </div>

              <label>
                Games per page
                <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
                  {PAGE_SIZE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="games-slider-label">
                  <span>Font size</span>
                  <span className="games-slider-value">{fontSize}px</span>
                </span>
                <input
                  type="range"
                  min="12"
                  max="16"
                  step="1"
                  value={fontSize}
                  onChange={(event) => setFontSize(Number(event.target.value))}
                />
              </label>
              <label>
                <span className="games-slider-label">
                  <span>Column width</span>
                  <span className="games-slider-value">{columnWidth}px</span>
                </span>
                <input
                  type="range"
                  min="120"
                  max="260"
                  step="10"
                  value={columnWidth}
                  onChange={(event) => setColumnWidth(Number(event.target.value))}
                />
              </label>

              <div className="subsection">
                <div className="section-head">
                  <strong>Columns</strong>
                  <span className="muted-small">{visibleTableColumns.length} visible</span>
                </div>
                <div className="games-column-picker">
                  {GAME_COLUMNS.map((column) => (
                    <label key={column.id} className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={visibleColumns.includes(column.id)}
                        onChange={() => toggleVisibleColumn(column.id)}
                      />
                      <span>{column.label}</span>
                    </label>
                  ))}
                </div>
                <p className="muted-small">Selection and action columns stay visible.</p>
              </div>
            </aside>
          </div>

          <div className="button-row button-row-spaced">
            <span className="muted">Selected: {selected.length}</span>
            <button type="button" onClick={() => void exportSelected()} disabled={selected.length === 0}>
              Export selected
            </button>
            <select
              defaultValue=""
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isInteger(value) && value > 0) {
                  void bulkAddToCollection(value);
                  event.currentTarget.value = "";
                }
              }}
              disabled={selected.length === 0 || (collections.data?.length ?? 0) === 0}
            >
              <option value="">Add selected to collection</option>
              {collections.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              defaultValue=""
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isInteger(value) && value > 0) {
                  void bulkRemoveFromCollection(value);
                  event.currentTarget.value = "";
                }
              }}
              disabled={selected.length === 0 || (collections.data?.length ?? 0) === 0}
            >
              <option value="">Remove selected from collection</option>
              {collections.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              defaultValue=""
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isInteger(value) && value > 0) {
                  void bulkTag(value);
                  event.currentTarget.value = "";
                }
              }}
              disabled={selected.length === 0 || (tags.data?.length ?? 0) === 0}
            >
              <option value="">Tag selected</option>
              {tags.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <select
              defaultValue=""
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isInteger(value) && value > 0) {
                  void bulkUntag(value);
                  event.currentTarget.value = "";
                }
              }}
              disabled={selected.length === 0 || (tags.data?.length ?? 0) === 0}
            >
              <option value="">Untag selected</option>
              {tags.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => clearSelection()} disabled={selected.length === 0}>
              Clear
            </button>
          </div>

          {games.isLoading ? <p className="muted">Loading games...</p> : null}
          {games.isError ? <p className="muted">Error: {String(games.error)}</p> : null}

          {games.data ? (
            <>
              <p className="muted">
                Showing {games.data.items.length} of {games.data.total} games, page {games.data.page} of {pageCount}
              </p>

              {games.data.total === 0 ? (
                <section className="card card-dashed">
                  <h3>No games yet</h3>
                  <p className="muted">
                    Your account starts empty. Games are populated by importing PGNs (recommended) or by inserting a
                    sample game.
                  </p>
                  <div className="button-row">
                    <button type="button" onClick={() => void queueStarterImport()}>
                      Seed 1000 starter games
                    </button>
                    <button type="button" onClick={() => void queueSampleImport()}>
                      Queue small sample import
                    </button>
                    <Link href="/import">Import PGN</Link>
                    <button type="button" onClick={() => void createSampleGame()}>
                      Insert sample game
                    </button>
                    <button type="button" onClick={() => clearFilters()}>
                      Clear filters
                    </button>
                  </div>
                  <p className="muted-small">After an import completes, refresh this page to see the games.</p>
                </section>
              ) : null}

              <div className="table-wrap games-table-wrap" style={tableStyle}>
                <table className="games-table">
                  <thead>
                    <tr>
                      <th className="games-col-fixed" style={{ minWidth: "68px" }}>
                        Select
                      </th>
                      {visibleTableColumns.map((column) => (
                        <th key={column.id} className={column.compact ? "games-col-compact" : undefined} style={columnCellStyle(column)}>
                          {column.label}
                        </th>
                      ))}
                      <th className="games-col-actions" style={{ minWidth: "118px" }}>
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {games.data.items.map((game) => (
                      <tr key={game.id}>
                        <td className="games-col-fixed">
                          <input
                            type="checkbox"
                            checked={selected.includes(game.id)}
                            onChange={() => toggleSelected(game.id)}
                          />
                        </td>
                        {visibleTableColumns.map((column) => {
                          const cell = renderGameCell(game, column.id);
                          return (
                            <td
                              key={column.id}
                              title={cell.title}
                              className={column.compact ? "games-col-compact" : undefined}
                              style={columnCellStyle(column)}
                            >
                              {cell.content}
                            </td>
                          );
                        })}
                        <td className="games-col-actions">
                          <div className="button-row">
                            <button type="button" onClick={() => setViewerGameId(game.id)}>
                              View
                            </button>
                            <Link href={`/games/${game.id}`}>Page</Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {games.data.items.length === 0 ? (
                      <tr>
                        <td colSpan={visibleTableColumns.length + 2}>No games yet. Use Import or insert a sample game.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <div className="button-row button-row-top">
                <button type="button" onClick={() => setPage((v) => Math.max(1, v - 1))} disabled={page <= 1}>
                  Previous
                </button>
                <span>
                  Page {page} / {pageCount}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((v) => Math.min(pageCount, v + 1))}
                  disabled={page >= pageCount}
                >
                  Next
                </button>
              </div>
            </>
          ) : null}
        </section>

        {viewerGameId ? <GameViewerPanel gameId={viewerGameId} onClose={() => setViewerGameId(null)} /> : null}
      </div>
    </main>
  );
}
