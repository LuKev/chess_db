"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FenPreviewBoard } from "../../../../components/FenPreviewBoard";
import { IndexStatusPanel } from "../../../../components/IndexStatusPanel";
import { fetchJson } from "../../../../lib/api";
import { useToasts } from "../../../../components/ToastsProvider";
import { useIndexStatusQuery } from "../../../../features/indexing/useIndexStatusQuery";

type PositionSearchRow = {
  gameId: number;
  ply: number;
  sideToMove: "w" | "b";
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

type MaterialSearchResponse = {
  page: number;
  pageSize: number;
  total: number;
  items: PositionSearchRow[];
  materialKey: string;
};

export default function PositionSearchPage() {
  const [mode, setMode] = useState<"exact" | "material">("exact");
  const [fen, setFen] = useState("startpos");
  const [sideToMove, setSideToMove] = useState<"" | "w" | "b">("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Enter a FEN and search.");
  const [results, setResults] = useState<Array<PositionSearchRow> | null>(null);
  const toasts = useToasts();
  const indexStatus = useIndexStatusQuery();
  const positionIndexReady = indexStatus.data?.position.status === "indexed";

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const parsed = new URLSearchParams(window.location.search);
    const fenParam = parsed.get("fen");
    if (fenParam && fenParam.trim()) {
      setFen(fenParam.trim());
    }
  }, []);

  async function searchExact(): Promise<void> {
    if (!positionIndexReady) {
      setStatus("Position search is unavailable until the position index finishes.");
      return;
    }
    setBusy(true);
    setStatus(mode === "exact" ? "Searching exact positions..." : "Searching by material...");
    const response =
      mode === "exact"
        ? await fetchJson<PositionSearchResponse>("/api/search/position", {
            method: "POST",
            body: JSON.stringify({ fen }),
          })
        : await fetchJson<MaterialSearchResponse>("/api/search/position/material", {
            method: "POST",
            body: JSON.stringify({
              fen,
              sideToMove: sideToMove || undefined,
            }),
          });
    setBusy(false);

    if (response.status !== 200 || !("items" in response.data)) {
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Position search failed (status ${response.status})`;
      setStatus(msg);
      toasts.pushToast({ kind: "error", message: msg });
      setResults(null);
      return;
    }

    setResults(response.data.items);
    if ("fenNorm" in response.data) {
      setStatus(`${response.data.total} hit(s) for normalized FEN: ${response.data.fenNorm}`);
    } else {
      setStatus(`${response.data.total} hit(s) for material key: ${response.data.materialKey}`);
    }
  }

  return (
    <main>
      <section className="card">
        <div className="section-head">
          <h2>Position Search</h2>
          <div className="button-row">
            <Link href="/games">Games</Link>
            <Link href="/reports">Prep reports</Link>
            <Link href="/diagnostics">Diagnostics</Link>
          </div>
        </div>
        <p className="muted">Find games and plies by exact position or by material shape.</p>
      </section>

      <IndexStatusPanel compact />

      <section className="card">
        <h2>Search</h2>
        <div className="auth-grid">
          <label>
            Mode
            <select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>
              <option value="exact">Exact FEN</option>
              <option value="material">Material match</option>
            </select>
          </label>
          <label>
            FEN (or `startpos`)
            <input value={fen} onChange={(event) => setFen(event.target.value)} disabled={!positionIndexReady} />
          </label>
          {mode === "material" ? (
            <label>
              Side to move
              <select value={sideToMove} onChange={(event) => setSideToMove(event.target.value as typeof sideToMove)}>
                <option value="">Either</option>
                <option value="w">White</option>
                <option value="b">Black</option>
              </select>
            </label>
          ) : null}
          <div className="button-row" style={{ alignSelf: "end" }}>
            <button type="button" onClick={() => void searchExact()} disabled={busy || !positionIndexReady}>
              Search
            </button>
          </div>
        </div>
        <p className="muted">{status}</p>
        {!positionIndexReady ? (
          <p className="muted">Run or wait for position indexing before searching by FEN.</p>
        ) : null}
      </section>

      <section className="card">
        <FenPreviewBoard fen={fen} title="Preview" />
      </section>

      <section className="card">
        <h2>Results</h2>
        {results ? (
          <div className="table-wrap">
            <table style={{ minWidth: 900 }}>
              <thead>
                <tr>
                  <th>Game</th>
                  <th>Ply</th>
                  <th>Side</th>
                  <th>Players</th>
                  <th>Event</th>
                  <th>Snippet</th>
                  <th>Open</th>
                </tr>
              </thead>
              <tbody>
                {results.map((row) => (
                  <tr key={`${row.gameId}-${row.ply}`}>
                    <td>{row.gameId}</td>
                    <td>{row.ply}</td>
                    <td>{row.sideToMove}</td>
                    <td>
                      {row.white} vs {row.black} ({row.result})
                    </td>
                    <td>{row.event ?? "-"}</td>
                    <td style={{ maxWidth: 420 }}>
                      {[...row.snippet.before, row.snippet.at, ...row.snippet.after]
                        .filter(Boolean)
                        .join(" ")}
                    </td>
                    <td>
                      <Link href={`/games/${row.gameId}?ply=${row.ply}`}>Open</Link>
                    </td>
                  </tr>
                ))}
                {results.length === 0 ? (
                  <tr>
                    <td colSpan={7}>No matches.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No results yet.</p>
        )}
      </section>
    </main>
  );
}
