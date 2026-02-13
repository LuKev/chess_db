"use client";

import Link from "next/link";
import { useState } from "react";
import { fetchJson } from "../../../../lib/api";
import { useToasts } from "../../../../components/ToastsProvider";

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

export default function PositionSearchPage() {
  const [fen, setFen] = useState("startpos");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Enter a FEN and search.");
  const [results, setResults] = useState<PositionSearchResponse | null>(null);
  const toasts = useToasts();

  async function searchExact(): Promise<void> {
    setBusy(true);
    setStatus("Searching...");
    const response = await fetchJson<PositionSearchResponse>("/api/search/position", {
      method: "POST",
      body: JSON.stringify({ fen }),
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

    setResults(response.data);
    setStatus(`${response.data.total} hit(s) for normalized FEN: ${response.data.fenNorm}`);
  }

  return (
    <main>
      <section className="card">
        <div className="section-head">
          <h2>Position Search</h2>
          <div className="button-row">
            <Link href="/games">Games</Link>
            <Link href="/diagnostics">Diagnostics</Link>
          </div>
        </div>
        <p className="muted">Find games and plies matching a position (exact FEN match).</p>
      </section>

      <section className="card">
        <h2>Search</h2>
        <div className="auth-grid">
          <label>
            FEN (or `startpos`)
            <input value={fen} onChange={(event) => setFen(event.target.value)} />
          </label>
          <div className="button-row" style={{ alignSelf: "end" }}>
            <button type="button" onClick={() => void searchExact()} disabled={busy}>
              Search
            </button>
          </div>
        </div>
        <p className="muted">{status}</p>
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
                {results.items.map((row) => (
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
                      <Link href={`/games/${row.gameId}`}>Open</Link>
                    </td>
                  </tr>
                ))}
                {results.items.length === 0 ? (
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

