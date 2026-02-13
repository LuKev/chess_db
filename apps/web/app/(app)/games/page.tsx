"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "../../../lib/api";
import { useToasts } from "../../../components/ToastsProvider";

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
  avgElo: number | null;
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

export default function GamesPage() {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<"date_desc" | "date_asc" | "white" | "black" | "eco">("date_desc");
  const [player, setPlayer] = useState("");
  const [eco, setEco] = useState("");
  const [openingPrefix, setOpeningPrefix] = useState("");
  const [result, setResult] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [collectionId, setCollectionId] = useState<number | "">("");
  const [tagId, setTagId] = useState<number | "">("");
  const [positionFen, setPositionFen] = useState("");
  const [selected, setSelected] = useState<number[]>([]);

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

  const query = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("pageSize", "25");
    params.set("sort", sort);
    if (player.trim()) params.set("player", player.trim());
    if (eco.trim()) params.set("eco", eco.trim());
    if (openingPrefix.trim()) params.set("openingPrefix", openingPrefix.trim());
    if (result.trim()) params.set("result", result.trim());
    if (fromDate.trim()) params.set("fromDate", fromDate.trim());
    if (toDate.trim()) params.set("toDate", toDate.trim());
    if (collectionId !== "") params.set("collectionId", String(collectionId));
    if (tagId !== "") params.set("tagId", String(tagId));
    if (positionFen.trim()) params.set("positionFen", positionFen.trim());
    return `?${params.toString()}`;
  }, [page, sort, player, eco, openingPrefix, result, fromDate, toDate, collectionId, tagId, positionFen]);

  const games = useQuery({
    queryKey: [
      "games",
      { page, sort, player, eco, openingPrefix, result, fromDate, toDate, collectionId, tagId, positionFen },
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

  async function createSampleGame(): Promise<void> {
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
          <Link href="/diagnostics">Diagnostics (legacy)</Link>
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Game List</h2>
          <div className="button-row">
            <button type="button" onClick={() => void games.refetch()} disabled={games.isFetching}>
              Refresh
            </button>
          </div>
        </div>

        <div className="filters">
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
            <input value={fromDate} onChange={(event) => setFromDate(event.target.value)} placeholder="YYYY-MM-DD" />
          </label>
          <label>
            To date
            <input value={toDate} onChange={(event) => setToDate(event.target.value)} placeholder="YYYY-MM-DD" />
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
                  {t.name}{typeof t.gameCount === "number" ? ` (${t.gameCount})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Position FEN
            <input value={positionFen} onChange={(event) => setPositionFen(event.target.value)} placeholder="startpos or FEN" />
          </label>
          <div className="button-row" style={{ alignSelf: "end" }}>
            <button
              type="button"
              onClick={() => {
                setPage(1);
                clearSelection();
              }}
            >
              Apply
            </button>
          </div>
        </div>

        <div className="button-row" style={{ marginBottom: 10 }}>
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
              {games.data.total} total, page {games.data.page}
            </p>
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
                  {games.data.items.map((game) => (
                    <tr key={game.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.includes(game.id)}
                          onChange={() => toggleSelected(game.id)}
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
                        <Link href={`/games/${game.id}`}>Open</Link>
                      </td>
                    </tr>
                  ))}
                  {games.data.items.length === 0 ? (
                    <tr>
                      <td colSpan={12}>No games yet. Use Import or insert a sample game.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="button-row" style={{ marginTop: 10 }}>
              <button type="button" onClick={() => setPage((v) => Math.max(1, v - 1))} disabled={page <= 1}>
                Previous
              </button>
              <span>
                Page {page} / {Math.max(1, Math.ceil(games.data.total / games.data.pageSize))}
              </span>
              <button
                type="button"
                onClick={() =>
                  setPage((v) =>
                    Math.min(Math.max(1, Math.ceil(games.data.total / games.data.pageSize)), v + 1)
                  )
                }
                disabled={page >= Math.max(1, Math.ceil(games.data.total / games.data.pageSize))}
              >
                Next
              </button>
            </div>
          </>
        ) : null}
      </section>
    </main>
  );
}
