"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiBaseUrl, fetchJson } from "../../../lib/api";
import { useToasts } from "../../../components/ToastsProvider";

type SavedFilter = {
  id: number;
  name: string;
  query: Record<string, unknown>;
};

type CollectionItem = {
  id: number;
  name: string;
  description: string | null;
  gameCount: number;
  updatedAt: string;
};

type PrepReport = {
  scope: {
    kind: "saved-filter" | "collection";
    id: number;
    name: string;
    title: string;
  };
  generatedAt: string;
  summary: {
    totalGames: number;
    whiteWins: number;
    blackWins: number;
    draws: number;
    avgWhiteElo: number | null;
    avgBlackElo: number | null;
    earliestDate: string | null;
    latestDate: string | null;
  };
  openings: Array<{
    eco: string | null;
    games: number;
    whiteWins: number;
    blackWins: number;
    draws: number;
  }>;
  resultsBySide: Array<{
    side: string;
    games: number;
    wins: number;
    losses: number;
    draws: number;
  }>;
  modelGames: Array<{
    id: number;
    white: string;
    black: string;
    result: string;
    eco: string | null;
    date: string | null;
    avgElo: number | null;
  }>;
  criticalPositions: Array<{
    fen: string;
    appearances: number;
    gameCount: number;
    nextMoves: string[];
  }>;
  engineLines: Array<{
    id: number;
    gameId: number;
    ply: number;
    players: string;
    engine: string;
    depth: number | null;
    multipv: number | null;
    evalCp: number | null;
    evalMate: number | null;
    pv: string;
    source: string;
    createdAt: string;
  }>;
  query: Record<string, unknown>;
};

type FiltersResponse = { items: SavedFilter[] };
type CollectionsResponse = { items: CollectionItem[] };
type ExportResponse = { id: number; status: string };

function formatEval(evalCp: number | null, evalMate: number | null): string {
  if (evalMate !== null) {
    return `#${evalMate}`;
  }
  if (evalCp !== null) {
    return (evalCp / 100).toFixed(2);
  }
  return "-";
}

export default function ReportsPage() {
  const searchParams = useSearchParams();
  const [scopeKind, setScopeKind] = useState<"saved-filter" | "collection">("saved-filter");
  const [savedFilterId, setSavedFilterId] = useState("");
  const [collectionId, setCollectionId] = useState("");
  const [title, setTitle] = useState("");
  const [report, setReport] = useState<PrepReport | null>(null);
  const [status, setStatus] = useState("Select a saved filter or collection to build a prep report.");
  const toasts = useToasts();
  const queryClient = useQueryClient();

  const savedFilters = useQuery({
    queryKey: ["saved-filters"],
    queryFn: async (): Promise<SavedFilter[]> => {
      const response = await fetchJson<FiltersResponse>("/api/filters", { method: "GET" });
      if (response.status === 200 && "items" in response.data) {
        return response.data.items;
      }
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to load saved filters (status ${response.status})`;
      throw new Error(msg);
    },
  });

  const collections = useQuery({
    queryKey: ["collections"],
    queryFn: async (): Promise<CollectionItem[]> => {
      const response = await fetchJson<CollectionsResponse>("/api/collections", { method: "GET" });
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

  const selectedSavedFilter = useMemo(
    () => savedFilters.data?.find((item) => item.id === Number(savedFilterId)) ?? null,
    [savedFilterId, savedFilters.data]
  );
  const selectedCollection = useMemo(
    () => collections.data?.find((item) => item.id === Number(collectionId)) ?? null,
    [collectionId, collections.data]
  );

  useEffect(() => {
    const savedFilterParam = searchParams.get("savedFilterId");
    const collectionParam = searchParams.get("collectionId");
    const titleParam = searchParams.get("title");
    if (savedFilterParam) {
      setScopeKind("saved-filter");
      setSavedFilterId(savedFilterParam);
    } else if (collectionParam) {
      setScopeKind("collection");
      setCollectionId(collectionParam);
    }
    if (titleParam) {
      setTitle(titleParam);
    }
  }, [searchParams]);

  function currentScopePayload(): { savedFilterId?: number; collectionId?: number; title?: string } | null {
    if (scopeKind === "saved-filter") {
      if (!selectedSavedFilter) {
        return null;
      }
      return {
        savedFilterId: selectedSavedFilter.id,
        title: title.trim() || undefined,
      };
    }
    if (!selectedCollection) {
      return null;
    }
    return {
      collectionId: selectedCollection.id,
      title: title.trim() || undefined,
    };
  }

  async function buildReport(): Promise<void> {
    const payload = currentScopePayload();
    if (!payload) {
      toasts.pushToast({ kind: "error", message: "Choose a saved filter or collection first" });
      return;
    }
    setStatus("Building prep report...");
    const response = await fetchJson<PrepReport>("/api/reports/prep", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (response.status !== 200 || !("scope" in response.data)) {
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to build prep report (status ${response.status})`;
      setStatus(msg);
      toasts.pushToast({ kind: "error", message: msg });
      return;
    }
    setReport(response.data);
    setStatus(`Built report for ${response.data.scope.title}.`);
    toasts.pushToast({ kind: "success", message: "Prep report ready" });
  }

  async function downloadHtml(): Promise<void> {
    const payload = currentScopePayload();
    if (!payload) {
      toasts.pushToast({ kind: "error", message: "Choose a saved filter or collection first" });
      return;
    }

    const response = await fetch(`${apiBaseUrl()}/api/reports/prep/html`, {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    if (!response.ok) {
      const text = await response.text();
      const message = text || `Failed to export HTML report (status ${response.status})`;
      setStatus(message);
      toasts.pushToast({ kind: "error", message });
      return;
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `${(title.trim() || report?.scope.title || "prep-report").replace(/[^a-z0-9-_]+/gi, "-").toLowerCase()}.html`;
    anchor.click();
    URL.revokeObjectURL(objectUrl);
    toasts.pushToast({ kind: "success", message: "HTML report downloaded" });
  }

  async function downloadPdf(): Promise<void> {
    const payload = currentScopePayload();
    if (!payload) {
      toasts.pushToast({ kind: "error", message: "Choose a saved filter or collection first" });
      return;
    }

    const response = await fetch(`${apiBaseUrl()}/api/reports/prep/pdf`, {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    if (!response.ok) {
      const text = await response.text();
      const message = text || `Failed to export PDF report (status ${response.status})`;
      setStatus(message);
      toasts.pushToast({ kind: "error", message });
      return;
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `${(title.trim() || report?.scope.title || "prep-report").replace(/[^a-z0-9-_]+/gi, "-").toLowerCase()}.pdf`;
    anchor.click();
    URL.revokeObjectURL(objectUrl);
    toasts.pushToast({ kind: "success", message: "PDF report downloaded" });
  }

  async function queuePgnExport(): Promise<void> {
    let exportQuery: Record<string, unknown> | null = null;
    if (scopeKind === "saved-filter") {
      exportQuery = selectedSavedFilter?.query ?? null;
    } else if (selectedCollection) {
      exportQuery = { collectionId: selectedCollection.id };
    }

    if (!exportQuery) {
      toasts.pushToast({ kind: "error", message: "Choose a saved filter or collection first" });
      return;
    }

    const response = await fetchJson<ExportResponse>("/api/exports", {
      method: "POST",
      body: JSON.stringify({
        mode: "query",
        query: exportQuery,
        includeAnnotations: true,
      }),
    });
    if (response.status !== 201 || !("id" in response.data)) {
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to queue PGN export (status ${response.status})`;
      setStatus(msg);
      toasts.pushToast({ kind: "error", message: msg });
      return;
    }

    await queryClient.invalidateQueries({ queryKey: ["exports"] });
    toasts.pushToast({ kind: "success", message: `Queued PGN export #${response.data.id}` });
    setStatus(`Queued PGN export #${response.data.id}.`);
  }

  return (
    <main>
      <section className="card">
        <div className="section-head">
          <h2>Prep Reports</h2>
          <div className="button-row">
            <Link href="/games">Games</Link>
            <Link href="/exports">Exports</Link>
          </div>
        </div>
        <p className="muted">
          Generate opponent/opening prep summaries from saved filters or collections, then export HTML or queue a PGN package.
        </p>
      </section>

      <section className="card">
        <div className="button-row">
          <label className="checkbox-label">
            <input
              type="radio"
              checked={scopeKind === "saved-filter"}
              onChange={() => setScopeKind("saved-filter")}
            />
            Saved filter
          </label>
          <label className="checkbox-label">
            <input
              type="radio"
              checked={scopeKind === "collection"}
              onChange={() => setScopeKind("collection")}
            />
            Collection
          </label>
        </div>

        <div className="auth-grid" style={{ marginTop: 12 }}>
          {scopeKind === "saved-filter" ? (
            <label>
              Saved filter
              <select value={savedFilterId} onChange={(event) => setSavedFilterId(event.target.value)}>
                <option value="">Choose a saved filter</option>
                {savedFilters.data?.map((filter) => (
                  <option key={filter.id} value={filter.id}>
                    {filter.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label>
              Collection
              <select value={collectionId} onChange={(event) => setCollectionId(event.target.value)}>
                <option value="">Choose a collection</option>
                {collections.data?.map((collection) => (
                  <option key={collection.id} value={collection.id}>
                    {collection.name} ({collection.gameCount})
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Report title
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Optional custom title" />
          </label>
        </div>

        <div className="button-row" style={{ marginTop: 12 }}>
          <button type="button" onClick={() => void buildReport()}>
            Build report
          </button>
          <button type="button" onClick={() => void downloadHtml()}>
            Export HTML
          </button>
          <button type="button" onClick={() => void downloadPdf()}>
            Export PDF
          </button>
          <button type="button" onClick={() => void queuePgnExport()}>
            Queue PGN Export
          </button>
        </div>

        <p className="muted">{status}</p>
        {savedFilters.isLoading || collections.isLoading ? <p className="muted">Loading scopes...</p> : null}
        {savedFilters.isError ? <p className="muted">Saved filters error: {String(savedFilters.error)}</p> : null}
        {collections.isError ? <p className="muted">Collections error: {String(collections.error)}</p> : null}
      </section>

      {report ? (
        <>
          <section className="card">
            <h2>{report.scope.title}</h2>
            <div className="auth-grid">
              <div>
                <strong>Games</strong>
                <div>{report.summary.totalGames}</div>
              </div>
              <div>
                <strong>White Wins</strong>
                <div>{report.summary.whiteWins}</div>
              </div>
              <div>
                <strong>Black Wins</strong>
                <div>{report.summary.blackWins}</div>
              </div>
              <div>
                <strong>Draws</strong>
                <div>{report.summary.draws}</div>
              </div>
              <div>
                <strong>Avg White Elo</strong>
                <div>{report.summary.avgWhiteElo ?? "-"}</div>
              </div>
              <div>
                <strong>Avg Black Elo</strong>
                <div>{report.summary.avgBlackElo ?? "-"}</div>
              </div>
            </div>
            <p className="muted">
              Date span: {report.summary.earliestDate ?? "-"} to {report.summary.latestDate ?? "-"}.
            </p>
          </section>

          <section className="card">
            <h2>Common Openings</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>ECO</th>
                    <th>Games</th>
                    <th>White Wins</th>
                    <th>Black Wins</th>
                    <th>Draws</th>
                  </tr>
                </thead>
                <tbody>
                  {report.openings.map((row) => (
                    <tr key={`${row.eco ?? "none"}-${row.games}`}>
                      <td>{row.eco ?? "-"}</td>
                      <td>{row.games}</td>
                      <td>{row.whiteWins}</td>
                      <td>{row.blackWins}</td>
                      <td>{row.draws}</td>
                    </tr>
                  ))}
                  {report.openings.length === 0 ? (
                    <tr>
                      <td colSpan={5}>No openings matched.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <h2>Results By Side</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Side</th>
                    <th>Games</th>
                    <th>Wins</th>
                    <th>Losses</th>
                    <th>Draws</th>
                  </tr>
                </thead>
                <tbody>
                  {report.resultsBySide.map((row) => (
                    <tr key={row.side}>
                      <td>{row.side}</td>
                      <td>{row.games}</td>
                      <td>{row.wins}</td>
                      <td>{row.losses}</td>
                      <td>{row.draws}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <h2>Model Games</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Players</th>
                    <th>Result</th>
                    <th>ECO</th>
                    <th>Date</th>
                    <th>Avg Elo</th>
                  </tr>
                </thead>
                <tbody>
                  {report.modelGames.map((game) => (
                    <tr key={game.id}>
                      <td>
                        <Link href={`/games/${game.id}`}>{game.id}</Link>
                      </td>
                      <td>{game.white} vs {game.black}</td>
                      <td>{game.result}</td>
                      <td>{game.eco ?? "-"}</td>
                      <td>{game.date ?? "-"}</td>
                      <td>{game.avgElo ?? "-"}</td>
                    </tr>
                  ))}
                  {report.modelGames.length === 0 ? (
                    <tr>
                      <td colSpan={6}>No model games matched.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <h2>Critical Positions</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>FEN</th>
                    <th>Appearances</th>
                    <th>Games</th>
                    <th>Next Moves</th>
                  </tr>
                </thead>
                <tbody>
                  {report.criticalPositions.map((position) => (
                    <tr key={position.fen}>
                      <td style={{ maxWidth: 440, wordBreak: "break-word" }}>{position.fen}</td>
                      <td>{position.appearances}</td>
                      <td>{position.gameCount}</td>
                      <td>{position.nextMoves.join(", ") || "-"}</td>
                    </tr>
                  ))}
                  {report.criticalPositions.length === 0 ? (
                    <tr>
                      <td colSpan={4}>No repeated positions matched.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <h2>Stored Engine Lines</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Game</th>
                    <th>Players</th>
                    <th>Ply</th>
                    <th>Engine</th>
                    <th>Depth</th>
                    <th>MultiPV</th>
                    <th>Eval</th>
                    <th>PV</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {report.engineLines.map((line) => (
                    <tr key={line.id}>
                      <td>
                        <Link href={`/games/${line.gameId}?ply=${line.ply}`}>{line.gameId}</Link>
                      </td>
                      <td>{line.players}</td>
                      <td>{line.ply}</td>
                      <td>{line.engine}</td>
                      <td>{line.depth ?? "-"}</td>
                      <td>{line.multipv ?? "-"}</td>
                      <td>{formatEval(line.evalCp, line.evalMate)}</td>
                      <td style={{ maxWidth: 420 }}>{line.pv || "-"}</td>
                      <td>{line.source}</td>
                    </tr>
                  ))}
                  {report.engineLines.length === 0 ? (
                    <tr>
                      <td colSpan={9}>No stored engine lines matched.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}
