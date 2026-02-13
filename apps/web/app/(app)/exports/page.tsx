"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiBaseUrl, fetchJson } from "../../../lib/api";
import { useToasts } from "../../../components/ToastsProvider";

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

type ExportListResponse = { items: ExportJob[] };

export default function ExportsPage() {
  const [mode, setMode] = useState<"ids" | "query">("query");
  const [idsText, setIdsText] = useState("");
  const [queryJson, setQueryJson] = useState('{\n  "sort": "date_desc"\n}');
  const [includeAnnotations, setIncludeAnnotations] = useState(true);
  const queryClient = useQueryClient();
  const toasts = useToasts();

  const exportsList = useQuery({
    queryKey: ["exports"],
    queryFn: async (): Promise<ExportJob[]> => {
      const response = await fetchJson<ExportListResponse>("/api/exports", { method: "GET" });
      if (response.status === 200 && "items" in response.data) {
        return response.data.items;
      }
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to load exports (status ${response.status})`;
      throw new Error(msg);
    },
  });

  const parsed = useMemo(() => {
    if (mode === "ids") {
      const ids = idsText
        .split(/[,\s]+/g)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => Number(s))
        .filter((n) => Number.isInteger(n) && n > 0);
      if (ids.length === 0) {
        return { ok: false as const, error: "Provide one or more numeric game IDs" };
      }
      return { ok: true as const, value: { mode: "ids" as const, gameIds: ids, includeAnnotations } };
    }
    try {
      const value = JSON.parse(queryJson) as unknown;
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { ok: false as const, error: "Query JSON must be an object" };
      }
      return { ok: true as const, value: { mode: "query" as const, query: value as Record<string, unknown>, includeAnnotations } };
    } catch (error) {
      return { ok: false as const, error: `Invalid JSON: ${String(error)}` };
    }
  }, [mode, idsText, queryJson, includeAnnotations]);

  async function queueExport(): Promise<void> {
    if (!parsed.ok) {
      toasts.pushToast({ kind: "error", message: parsed.error });
      return;
    }
    const response = await fetchJson<{ id: number; status: string }>("/api/exports", {
      method: "POST",
      body: JSON.stringify(parsed.value),
    });
    if (response.status !== 201 && response.status !== 200) {
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to queue export (status ${response.status})`;
      toasts.pushToast({ kind: "error", message: msg });
      return;
    }
    toasts.pushToast({ kind: "success", message: `Export queued (#${"id" in response.data ? response.data.id : "?"})` });
    await queryClient.invalidateQueries({ queryKey: ["exports"] });
  }

  function downloadUrl(jobId: number): string {
    return `${apiBaseUrl()}/api/exports/${jobId}/download`;
  }

  return (
    <main>
      <section className="card">
        <div className="section-head">
          <h2>Exports</h2>
          <div className="button-row">
            <Link href="/games">Games</Link>
            <Link href="/diagnostics">Diagnostics</Link>
          </div>
        </div>
        <p className="muted">Queue PGN exports from selected game IDs or from a query.</p>
      </section>

      <section className="card">
        <h2>Queue Export</h2>
        <div className="button-row">
          <label className="checkbox-label">
            <input type="radio" checked={mode === "query"} onChange={() => setMode("query")} />
            By query
          </label>
          <label className="checkbox-label">
            <input type="radio" checked={mode === "ids"} onChange={() => setMode("ids")} />
            By IDs
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={includeAnnotations}
              onChange={(event) => setIncludeAnnotations(event.target.checked)}
            />
            Include annotations
          </label>
        </div>

        {mode === "ids" ? (
          <label style={{ marginTop: 10 }}>
            Game IDs (comma or whitespace separated)
            <textarea rows={3} value={idsText} onChange={(event) => setIdsText(event.target.value)} />
          </label>
        ) : (
          <label style={{ marginTop: 10 }}>
            Query (JSON)
            <textarea rows={10} value={queryJson} onChange={(event) => setQueryJson(event.target.value)} />
          </label>
        )}

        <p className="muted">{parsed.ok ? "Request looks valid." : parsed.error}</p>
        <div className="button-row">
          <button type="button" onClick={() => void queueExport()} disabled={!parsed.ok}>
            Queue export
          </button>
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Recent Exports</h2>
          <div className="button-row">
            <button type="button" onClick={() => void exportsList.refetch()} disabled={exportsList.isFetching}>
              Refresh
            </button>
          </div>
        </div>

        {exportsList.isLoading ? <p className="muted">Loading exports...</p> : null}
        {exportsList.isError ? <p className="muted">Error: {String(exportsList.error)}</p> : null}

        {exportsList.data ? (
          <div className="table-wrap">
            <table style={{ minWidth: 900 }}>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Status</th>
                  <th>Mode</th>
                  <th>Exported</th>
                  <th>Updated</th>
                  <th>Error</th>
                  <th>Download</th>
                </tr>
              </thead>
              <tbody>
                {exportsList.data.map((job) => (
                  <tr key={job.id}>
                    <td>{job.id}</td>
                    <td>{job.status}</td>
                    <td>{job.mode}</td>
                    <td>{job.exportedGames}</td>
                    <td>{new Date(job.updatedAt).toLocaleString()}</td>
                    <td>{job.error ?? "-"}</td>
                    <td>
                      {job.status === "completed" ? (
                        <a href={downloadUrl(job.id)} target="_blank" rel="noreferrer">
                          Download
                        </a>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                ))}
                {exportsList.data.length === 0 ? (
                  <tr>
                    <td colSpan={7}>No exports yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </main>
  );
}

