"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "../../../lib/api";
import { useToasts } from "../../../components/ToastsProvider";

type TagItem = {
  id: number;
  name: string;
  color: string | null;
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

export default function GamesPage() {
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();
  const toasts = useToasts();

  const query = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("pageSize", "25");
    return `?${params.toString()}`;
  }, [page]);

  const games = useQuery({
    queryKey: ["games", { page }],
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

  return (
    <main>
      <section className="card">
        <h2>Games</h2>
        <p className="muted">Browse and open games in your database.</p>

        <div className="button-row">
          <button type="button" onClick={() => void createSampleGame()}>
            Insert sample game
          </button>
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
                      <td>{game.id}</td>
                      <td>{game.white}</td>
                      <td>{game.black}</td>
                      <td>{game.result}</td>
                      <td>{game.date ?? "-"}</td>
                      <td>{game.eco ?? "-"}</td>
                      <td>{game.event ?? "-"}</td>
                      <td>{game.avgElo ? Math.round(game.avgElo) : "-"}</td>
                      <td>{game.tags.length > 0 ? game.tags.map((tag) => tag.name).join(", ") : "-"}</td>
                      <td>{game.plyCount ?? "-"}</td>
                      <td>
                        <Link href={`/games/${game.id}`}>Open</Link>
                      </td>
                    </tr>
                  ))}
                  {games.data.items.length === 0 ? (
                    <tr>
                      <td colSpan={11}>No games yet. Use Import or insert a sample game.</td>
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
