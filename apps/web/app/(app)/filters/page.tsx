"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "../../../lib/api";
import { useToasts } from "../../../components/ToastsProvider";

type SavedFilter = {
  id: number;
  name: string;
  query: Record<string, unknown>;
  shareToken: string;
  createdAt: string;
  updatedAt: string;
};

type FilterPreset = {
  id: string;
  name: string;
  description: string;
  query: Record<string, unknown>;
};

type PresetResponse = { items: FilterPreset[] };
type FiltersResponse = { items: SavedFilter[] };

export default function FiltersPage() {
  const [name, setName] = useState("");
  const [queryJson, setQueryJson] = useState('{\n  "sort": "date_desc"\n}');
  const [sharedToken, setSharedToken] = useState("");
  const [sharedResult, setSharedResult] = useState<SavedFilter | null>(null);
  const queryClient = useQueryClient();
  const toasts = useToasts();

  const presets = useQuery({
    queryKey: ["filter-presets"],
    queryFn: async (): Promise<FilterPreset[]> => {
      const response = await fetchJson<PresetResponse>("/api/filters/presets", { method: "GET" });
      if (response.status === 200 && "items" in response.data) {
        return response.data.items;
      }
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to load presets (status ${response.status})`;
      throw new Error(msg);
    },
  });

  const saved = useQuery({
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

  const parsedQuery = useMemo(() => {
    try {
      const value = JSON.parse(queryJson) as unknown;
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { ok: false as const, error: "Query JSON must be an object" };
      }
      return { ok: true as const, value: value as Record<string, unknown> };
    } catch (error) {
      return { ok: false as const, error: `Invalid JSON: ${String(error)}` };
    }
  }, [queryJson]);

  async function createFilter(): Promise<void> {
    if (!parsedQuery.ok) {
      toasts.pushToast({ kind: "error", message: parsedQuery.error });
      return;
    }
    const response = await fetchJson<SavedFilter>("/api/filters", {
      method: "POST",
      body: JSON.stringify({ name, query: parsedQuery.value }),
    });
    if (response.status !== 201) {
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to create filter (status ${response.status})`;
      toasts.pushToast({ kind: "error", message: msg });
      return;
    }
    toasts.pushToast({ kind: "success", message: "Saved filter created" });
    setName("");
    await queryClient.invalidateQueries({ queryKey: ["saved-filters"] });
  }

  async function deleteFilter(id: number): Promise<void> {
    const response = await fetchJson<Record<string, never>>(`/api/filters/${id}`, { method: "DELETE" });
    if (response.status !== 204) {
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to delete filter (status ${response.status})`;
      toasts.pushToast({ kind: "error", message: msg });
      return;
    }
    toasts.pushToast({ kind: "success", message: "Filter deleted" });
    await queryClient.invalidateQueries({ queryKey: ["saved-filters"] });
  }

  async function loadShared(): Promise<void> {
    setSharedResult(null);
    if (!sharedToken.trim()) {
      toasts.pushToast({ kind: "error", message: "Provide a share token" });
      return;
    }
    const response = await fetchJson<SavedFilter>(`/api/filters/shared/${encodeURIComponent(sharedToken.trim())}`, {
      method: "GET",
    });
    if (response.status !== 200 || !("id" in response.data)) {
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to load shared filter (status ${response.status})`;
      toasts.pushToast({ kind: "error", message: msg });
      return;
    }
    setSharedResult(response.data);
    toasts.pushToast({ kind: "success", message: "Loaded shared filter" });
  }

  return (
    <main>
      <section className="card">
        <div className="section-head">
          <h2>Saved Filters</h2>
          <div className="button-row">
            <Link href="/games">Games</Link>
            <Link href="/diagnostics">Diagnostics</Link>
          </div>
        </div>
        <p className="muted">Manage saved query presets for faster searching.</p>
      </section>

      <section className="card">
        <h2>Built-in Presets</h2>
        {presets.isLoading ? <p className="muted">Loading presets...</p> : null}
        {presets.isError ? <p className="muted">Error: {String(presets.error)}</p> : null}
        {presets.data ? (
          <div className="table-wrap">
            <table style={{ minWidth: 700 }}>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Description</th>
                  <th>Query</th>
                </tr>
              </thead>
              <tbody>
                {presets.data.map((preset) => (
                  <tr key={preset.id}>
                    <td>{preset.id}</td>
                    <td>{preset.name}</td>
                    <td>{preset.description}</td>
                    <td>
                      <pre className="pgn-pre">{JSON.stringify(preset.query, null, 2)}</pre>
                    </td>
                  </tr>
                ))}
                {presets.data.length === 0 ? (
                  <tr>
                    <td colSpan={4}>No presets.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="card">
        <h2>Create Saved Filter</h2>
        <div className="auth-grid">
          <label>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Recent Year" />
          </label>
        </div>
        <label style={{ marginTop: 10 }}>
          Query (JSON)
          <textarea rows={10} value={queryJson} onChange={(event) => setQueryJson(event.target.value)} />
        </label>
        <p className="muted">{parsedQuery.ok ? "Query JSON looks valid." : parsedQuery.error}</p>
        <div className="button-row">
          <button type="button" onClick={() => void createFilter()} disabled={!name.trim() || !parsedQuery.ok}>
            Save filter
          </button>
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Your Saved Filters</h2>
          <div className="button-row">
            <button type="button" onClick={() => void saved.refetch()} disabled={saved.isFetching}>
              Refresh
            </button>
          </div>
        </div>
        {saved.isLoading ? <p className="muted">Loading saved filters...</p> : null}
        {saved.isError ? <p className="muted">Error: {String(saved.error)}</p> : null}
        {saved.data ? (
          <div className="table-wrap">
            <table style={{ minWidth: 900 }}>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Share Token</th>
                  <th>Updated</th>
                  <th>Query</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {saved.data.map((filter) => (
                  <tr key={filter.id}>
                    <td>{filter.id}</td>
                    <td>{filter.name}</td>
                    <td style={{ fontFamily: "monospace" }}>{filter.shareToken}</td>
                    <td>{new Date(filter.updatedAt).toLocaleString()}</td>
                    <td>
                      <pre className="pgn-pre">{JSON.stringify(filter.query, null, 2)}</pre>
                    </td>
                    <td>
                      <button type="button" onClick={() => void deleteFilter(filter.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
                {saved.data.length === 0 ? (
                  <tr>
                    <td colSpan={6}>No saved filters yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="card">
        <h2>Load Shared Filter</h2>
        <div className="auth-grid">
          <label>
            Share Token
            <input value={sharedToken} onChange={(event) => setSharedToken(event.target.value)} />
          </label>
          <div className="button-row" style={{ alignSelf: "end" }}>
            <button type="button" onClick={() => void loadShared()}>
              Load
            </button>
          </div>
        </div>
        {sharedResult ? (
          <pre className="pgn-pre">{JSON.stringify(sharedResult, null, 2)}</pre>
        ) : (
          <p className="muted">No shared filter loaded.</p>
        )}
      </section>
    </main>
  );
}

