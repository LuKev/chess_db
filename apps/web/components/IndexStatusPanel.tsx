"use client";

import { useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "../lib/api";
import { useToasts } from "./ToastsProvider";
import { useIndexStatusQuery } from "../features/indexing/useIndexStatusQuery";

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString();
}

export function IndexStatusPanel(props: { compact?: boolean }) {
  const { compact = false } = props;
  const status = useIndexStatusQuery();
  const queryClient = useQueryClient();
  const toasts = useToasts();

  async function queue(kind: "positions" | "openings"): Promise<void> {
    const response = await fetchJson<{ status: string }>(`/api/backfill/${kind}`, {
      method: "POST",
    });
    if (response.status !== 202) {
      const message =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to queue ${kind} rebuild (status ${response.status})`;
      toasts.pushToast({ kind: "error", message });
      return;
    }
    toasts.pushToast({
      kind: "success",
      message: kind === "positions" ? "Queued position index rebuild" : "Queued opening index rebuild",
    });
    await queryClient.invalidateQueries({ queryKey: ["index-status"] });
    await queryClient.invalidateQueries({ queryKey: ["imports"] });
  }

  return (
    <section className="card">
      <div className="section-head">
        <div>
          <h2>{compact ? "Index Status" : "Database Index Status"}</h2>
          <p className="muted">
            Position search and opening explorer depend on background indexing.
          </p>
        </div>
        <div className="button-row">
          <button type="button" onClick={() => void status.refetch()} disabled={status.isFetching}>
            Refresh
          </button>
        </div>
      </div>

      {status.isLoading ? <p className="muted">Loading index status...</p> : null}
      {status.isError ? <p className="muted">Error: {String(status.error)}</p> : null}

      {status.data ? (
        <>
          {!compact ? <p className="muted">Tracked games: {status.data.totalGames}</p> : null}
          <div className="table-wrap">
            <table style={{ minWidth: compact ? 720 : 860 }}>
              <thead>
                <tr>
                  <th>Index</th>
                  <th>Status</th>
                  <th>Pending games</th>
                  <th>Indexed games</th>
                  <th>Last requested</th>
                  <th>Last completed</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Positions</td>
                  <td>{status.data.position.status}</td>
                  <td>{status.data.position.pendingGames}</td>
                  <td>{status.data.position.indexedGames}</td>
                  <td>{formatTimestamp(status.data.position.lastRequestedAt)}</td>
                  <td>{formatTimestamp(status.data.position.lastCompletedAt)}</td>
                  <td style={{ maxWidth: 280 }}>{status.data.position.lastError ?? "-"}</td>
                </tr>
                <tr>
                  <td>Openings</td>
                  <td>{status.data.opening.status}</td>
                  <td>{status.data.opening.pendingGames}</td>
                  <td>{status.data.opening.indexedGames}</td>
                  <td>{formatTimestamp(status.data.opening.lastRequestedAt)}</td>
                  <td>{formatTimestamp(status.data.opening.lastCompletedAt)}</td>
                  <td style={{ maxWidth: 280 }}>{status.data.opening.lastError ?? "-"}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="button-row" style={{ marginTop: 10 }}>
            <button type="button" onClick={() => void queue("positions")}>
              Rebuild positions
            </button>
            <button type="button" onClick={() => void queue("openings")}>
              Rebuild openings
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
