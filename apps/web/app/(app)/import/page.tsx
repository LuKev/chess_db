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

type ImportErrorItem = {
  id: number;
  lineNumber: number | null;
  gameOffset: number | null;
  message: string;
  createdAt: string;
};

type ImportErrorListResponse = {
  importJobId: number;
  page: number;
  pageSize: number;
  total: number;
  items: ImportErrorItem[];
};

export default function ImportPage() {
  const [strictDuplicate, setStrictDuplicate] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [selectedImportId, setSelectedImportId] = useState<number | null>(null);
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

  const importErrors = useQuery({
    queryKey: ["import-errors", { importJobId: selectedImportId }],
    enabled: selectedImportId !== null,
    queryFn: async (): Promise<ImportErrorListResponse> => {
      const response = await fetchJson<ImportErrorListResponse>(
        `/api/imports/${selectedImportId}/errors?page=1&pageSize=25`,
        {
          method: "GET",
        }
      );
      if (response.status === 200 && "items" in response.data) {
        return response.data;
      }
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to load import errors (status ${response.status})`;
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

  async function queueStarterSeed(): Promise<void> {
    const response = await fetchJson<{ id: number; maxGames: number }>("/api/imports/starter", {
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
      message: `Queued starter import (#${"id" in response.data ? response.data.id : "?"})`,
    });
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
          <button type="button" onClick={() => void queueStarterSeed()}>
            Seed 1000 starter games
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
            <table style={{ minWidth: 900 }}>
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
                  <th>Action</th>
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
                    <td>
                      <button
                        type="button"
                        onClick={() => setSelectedImportId(job.id)}
                        disabled={job.totals.parseErrors === 0}
                      >
                        View errors
                      </button>
                    </td>
                  </tr>
                ))}
                {imports.data.items.length === 0 ? (
                  <tr>
                    <td colSpan={9}>No imports yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Import Errors</h2>
          <div className="button-row">
            <button
              type="button"
              onClick={() => setSelectedImportId(null)}
              disabled={selectedImportId === null}
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => void importErrors.refetch()}
              disabled={selectedImportId === null || importErrors.isFetching}
            >
              Refresh
            </button>
          </div>
        </div>

        {selectedImportId === null ? (
          <p className="muted">Select an import job with parse errors.</p>
        ) : null}
        {importErrors.isLoading ? <p className="muted">Loading errors...</p> : null}
        {importErrors.isError ? <p className="muted">Error: {String(importErrors.error)}</p> : null}
        {importErrors.data ? (
          <>
            <p className="muted">
              Import #{importErrors.data.importJobId}: showing {importErrors.data.items.length} of{" "}
              {importErrors.data.total}
            </p>
            <div className="table-wrap">
              <table style={{ minWidth: 900 }}>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Line</th>
                    <th>Game offset</th>
                    <th>Message</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {importErrors.data.items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.id}</td>
                      <td>{item.lineNumber ?? "-"}</td>
                      <td>{item.gameOffset ?? "-"}</td>
                      <td style={{ maxWidth: 540 }}>{item.message}</td>
                      <td>{new Date(item.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                  {importErrors.data.items.length === 0 ? (
                    <tr>
                      <td colSpan={5}>No errors for this import.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </section>
    </main>
  );
}
