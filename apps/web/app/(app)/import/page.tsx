"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "../../../lib/api";
import { useToasts } from "../../../components/ToastsProvider";

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

export default function ImportPage() {
  const [strictDuplicate, setStrictDuplicate] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const queryClient = useQueryClient();
  const toasts = useToasts();

  const imports = useQuery({
    queryKey: ["imports", { page: 1 }],
    queryFn: async (): Promise<ImportListResponse> => {
      const response = await fetchJson<ImportListResponse>("/api/imports?page=1&pageSize=15", {
        method: "GET",
      });
      if (response.status === 200 && "items" in response.data) {
        return response.data;
      }
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to load imports (status ${response.status})`;
      throw new Error(msg);
    },
  });

  const canUpload = useMemo(() => file !== null, [file]);

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
    toasts.pushToast({ kind: "success", message: `Queued sample import #${"id" in response.data ? response.data.id : "?"}` });
    await queryClient.invalidateQueries({ queryKey: ["imports"] });
  }

  async function uploadImport(): Promise<void> {
    if (!file) {
      return;
    }
    const form = new FormData();
    form.append("file", file);

    const response = await fetchJson<{ id: number }>(
      `/api/imports${strictDuplicate ? "?strictDuplicate=true" : ""}`,
      {
        method: "POST",
        body: form,
      }
    );

    if (response.status !== 201) {
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to queue import (status ${response.status})`;
      toasts.pushToast({ kind: "error", message: msg });
      return;
    }

    toasts.pushToast({ kind: "success", message: `Queued import #${"id" in response.data ? response.data.id : "?"}` });
    setFile(null);
    await queryClient.invalidateQueries({ queryKey: ["imports"] });
  }

  return (
    <main>
      <section className="card">
        <div className="section-head">
          <h2>Import PGN</h2>
          <div className="button-row">
            <Link href="/games">Games</Link>
            <Link href="/diagnostics">Diagnostics</Link>
          </div>
        </div>
        <p className="muted">Upload `.pgn` or `.pgn.zst` files to add games to your database.</p>
      </section>

      <section className="card">
        <h2>Queue Import</h2>
        <div className="button-row">
          <button type="button" onClick={() => void queueSampleImport()}>
            Queue sample import
          </button>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={strictDuplicate}
              onChange={(event) => setStrictDuplicate(event.target.checked)}
            />
            Strict duplicate mode
          </label>
        </div>

        <div className="auth-grid" style={{ marginTop: 10 }}>
          <label>
            File
            <input
              type="file"
              accept=".pgn,.zst,.pgn.zst"
              onChange={(event) => setFile(event.target.files?.item(0) ?? null)}
            />
          </label>
          <div className="button-row" style={{ alignSelf: "end" }}>
            <button type="button" onClick={() => void uploadImport()} disabled={!canUpload}>
              Upload and queue
            </button>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Recent Imports</h2>
          <div className="button-row">
            <button type="button" onClick={() => void imports.refetch()} disabled={imports.isFetching}>
              Refresh
            </button>
          </div>
        </div>
        {imports.isLoading ? <p className="muted">Loading imports...</p> : null}
        {imports.isError ? <p className="muted">Error: {String(imports.error)}</p> : null}
        {imports.data ? (
          <div className="table-wrap">
            <table style={{ minWidth: 700 }}>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Status</th>
                  <th>Parsed</th>
                  <th>Inserted</th>
                  <th>Duplicates</th>
                  <th>Errors</th>
                  <th>Strict</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {imports.data.items.map((job) => (
                  <tr key={job.id}>
                    <td>{job.id}</td>
                    <td>{job.status}</td>
                    <td>{job.totals.parsed}</td>
                    <td>{job.totals.inserted}</td>
                    <td>{job.totals.duplicates}</td>
                    <td>{job.totals.parseErrors}</td>
                    <td>{job.strictDuplicateMode ? "yes" : "no"}</td>
                    <td>{new Date(job.updatedAt).toLocaleString()}</td>
                  </tr>
                ))}
                {imports.data.items.length === 0 ? (
                  <tr>
                    <td colSpan={8}>No imports yet.</td>
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

