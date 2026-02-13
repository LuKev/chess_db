"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { fetchJson } from "../../../lib/api";
import { useToasts } from "../../../components/ToastsProvider";

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

export default function OpeningsPage() {
  const [fen, setFen] = useState("startpos");
  const [depth, setDepth] = useState(2);
  const [tree, setTree] = useState<OpeningTreeNode | null>(null);
  const [activeFenNorm, setActiveFenNorm] = useState<string | null>(null);
  const [status, setStatus] = useState("Load an opening tree from your database.");
  const [path, setPath] = useState<Array<{ fen: string; label: string }>>([]);
  const toasts = useToasts();

  const query = useMemo(() => {
    const params = new URLSearchParams();
    params.set("fen", fen);
    params.set("depth", String(depth));
    return `?${params.toString()}`;
  }, [fen, depth]);

  async function loadOpeningTree(targetFen: string, label: string, nextPath?: Array<{ fen: string; label: string }>) {
    setStatus("Loading opening tree...");
    const params = new URLSearchParams();
    params.set("fen", targetFen);
    params.set("depth", String(depth));
    const response = await fetchJson<OpeningTreeResponse>(`/api/openings/tree?${params.toString()}`, {
      method: "GET",
    });
    if (response.status !== 200 || !("tree" in response.data)) {
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to load opening tree (status ${response.status})`;
      setStatus(msg);
      toasts.pushToast({ kind: "error", message: msg });
      return;
    }
    setTree(response.data.tree);
    setFen(response.data.fenNorm);
    setActiveFenNorm(response.data.fenNorm);
    setPath(nextPath ?? [{ fen: response.data.fenNorm, label }]);
    setStatus(
      `Loaded ${response.data.tree.moves.length} move(s) at depth ${response.data.depth} (total games: ${response.data.tree.totalGames})`
    );
  }

  async function loadRoot(): Promise<void> {
    await loadOpeningTree(fen, "Root");
  }

  async function diveMove(moveUci: string, nextFenNorm: string | null): Promise<void> {
    if (!nextFenNorm) {
      return;
    }
    const nextPath = [...path, { fen: nextFenNorm, label: moveUci }];
    await loadOpeningTree(nextFenNorm, moveUci, nextPath);
  }

  async function jumpTo(index: number): Promise<void> {
    const entry = path[index];
    if (!entry) {
      return;
    }
    const truncated = path.slice(0, index + 1);
    await loadOpeningTree(entry.fen, entry.label, truncated);
  }

  return (
    <main>
      <section className="card">
        <div className="section-head">
          <h2>Opening Explorer</h2>
          <div className="button-row">
            <Link href="/games">Games</Link>
            <Link href="/diagnostics">Diagnostics</Link>
          </div>
        </div>
        <p className="muted">Explore move popularity and results from your own game database.</p>
      </section>

      <section className="card">
        <h2>Load</h2>
        <div className="auth-grid">
          <label>
            FEN (or `startpos`)
            <input value={fen} onChange={(event) => setFen(event.target.value)} />
          </label>
          <label>
            Depth
            <select value={depth} onChange={(event) => setDepth(Number(event.target.value))}>
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
              <option value={4}>4</option>
            </select>
          </label>
          <div className="button-row" style={{ alignSelf: "end" }}>
            <button type="button" onClick={() => void loadRoot()}>
              Load tree
            </button>
          </div>
        </div>
        <p className="muted">{status}</p>
        <p className="muted" style={{ fontSize: 12 }}>
          Query: {query}
        </p>
      </section>

      <section className="card">
        <h2>Path</h2>
        {path.length > 0 ? (
          <div className="button-row">
            {path.map((entry, idx) => (
              <button key={`${entry.fen}-${idx}`} type="button" onClick={() => void jumpTo(idx)}>
                {entry.label}
              </button>
            ))}
            {activeFenNorm ? (
              <>
                <Link href={`/games?positionFen=${encodeURIComponent(activeFenNorm)}`}>Filter games</Link>
                <Link href={`/search/position?fen=${encodeURIComponent(activeFenNorm)}`}>Position search</Link>
              </>
            ) : null}
          </div>
        ) : (
          <p className="muted">No path yet.</p>
        )}
      </section>

      <section className="card">
        <h2>Moves</h2>
        {tree ? (
          <div className="table-wrap">
            <table style={{ minWidth: 900 }}>
              <thead>
                <tr>
                  <th>Move</th>
                  <th>Games</th>
                  <th>Popularity</th>
                  <th>Score %</th>
                  <th>W/D/L</th>
                  <th>Transpositions</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {tree.moves.map((move) => (
                  <tr key={move.moveUci}>
                    <td>{move.moveUci}</td>
                    <td>{move.games}</td>
                    <td>{move.popularityPct !== null ? `${Math.round(move.popularityPct)}%` : "-"}</td>
                    <td>{move.scorePct !== null ? `${Math.round(move.scorePct)}%` : "-"}</td>
                    <td>
                      {move.whiteWins}/{move.draws}/{move.blackWins}
                    </td>
                    <td>{move.transpositions}</td>
                    <td>
                      <button type="button" onClick={() => void diveMove(move.moveUci, move.nextFenNorm)} disabled={!move.nextFenNorm}>
                        Dive
                      </button>
                    </td>
                  </tr>
                ))}
                {tree.moves.length === 0 ? (
                  <tr>
                    <td colSpan={7}>No moves found.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No tree loaded yet.</p>
        )}
      </section>
    </main>
  );
}
