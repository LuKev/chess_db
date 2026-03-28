"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "../../../lib/api";
import { useToasts } from "../../../components/ToastsProvider";

type RepertoireItem = {
  id: number;
  name: string;
  description: string | null;
  orientation: "white" | "black" | "either";
  color: string | null;
  shareToken: string;
  isPublic: boolean;
  entryCount: number;
  practicedCount: number;
  createdAt: string;
  updatedAt: string;
};

type RepertoireEntry = {
  id: number;
  parentEntryId: number | null;
  positionFen: string;
  fenNorm: string;
  moveUci: string;
  moveSan: string | null;
  nextFen: string | null;
  nextFenNorm: string | null;
  note: string | null;
  practiceCount: number;
  correctCount: number;
  lastDrilledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type RepertoireListResponse = {
  items: RepertoireItem[];
};

type RepertoireEntriesResponse = {
  repertoireId: number;
  items: RepertoireEntry[];
};

export default function RepertoiresPage() {
  const queryClient = useQueryClient();
  const toasts = useToasts();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [orientation, setOrientation] = useState<"white" | "black" | "either">("either");
  const [color, setColor] = useState("#2f6bff");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [selectedRepertoireId, setSelectedRepertoireId] = useState<number | null>(null);
  const [entryPositionFen, setEntryPositionFen] = useState("startpos");
  const [entryMoveUci, setEntryMoveUci] = useState("");
  const [entryNote, setEntryNote] = useState("");
  const [editingEntryId, setEditingEntryId] = useState<number | null>(null);
  const [editingEntryNote, setEditingEntryNote] = useState("");

  const repertoires = useQuery({
    queryKey: ["repertoires"],
    queryFn: async (): Promise<RepertoireItem[]> => {
      const response = await fetchJson<RepertoireListResponse>("/api/repertoires", { method: "GET" });
      if (response.status === 200 && "items" in response.data) {
        return response.data.items;
      }
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to load repertoires (status ${response.status})`;
      throw new Error(msg);
    },
  });

  const entries = useQuery({
    queryKey: ["repertoire-entries", { selectedRepertoireId }],
    enabled: selectedRepertoireId !== null,
    queryFn: async (): Promise<RepertoireEntry[]> => {
      const response = await fetchJson<RepertoireEntriesResponse>(`/api/repertoires/${selectedRepertoireId}/entries`, { method: "GET" });
      if (response.status === 200 && "items" in response.data) {
        return response.data.items;
      }
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to load repertoire entries (status ${response.status})`;
      throw new Error(msg);
    },
  });

  useEffect(() => {
    if (!repertoires.data || repertoires.data.length === 0) {
      setSelectedRepertoireId(null);
      return;
    }
    if (selectedRepertoireId && repertoires.data.some((item) => item.id === selectedRepertoireId)) {
      return;
    }
    setSelectedRepertoireId(repertoires.data[0].id);
  }, [repertoires.data, selectedRepertoireId]);

  function resetForm(): void {
    setName("");
    setDescription("");
    setOrientation("either");
    setColor("#2f6bff");
    setEditingId(null);
  }

  function shareLink(token: string): string {
    if (typeof window === "undefined") {
      return `/shared/repertoires/${token}`;
    }
    return `${window.location.origin}/shared/repertoires/${token}`;
  }

  async function copyShareLink(token: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(shareLink(token));
      toasts.pushToast({ kind: "success", message: "Share link copied" });
    } catch {
      toasts.pushToast({ kind: "error", message: "Failed to copy share link" });
    }
  }

  async function createRepertoire(): Promise<void> {
    const response = await fetchJson<RepertoireItem>("/api/repertoires", {
      method: "POST",
      body: JSON.stringify({
        name,
        description: description.trim() || undefined,
        orientation,
        color: color.trim() || undefined,
      }),
    });
    if (response.status !== 201) {
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to create repertoire (status ${response.status})`;
      toasts.pushToast({ kind: "error", message: msg });
      return;
    }
    resetForm();
    toasts.pushToast({ kind: "success", message: "Repertoire created" });
    await queryClient.invalidateQueries({ queryKey: ["repertoires"] });
  }

  async function saveRepertoire(): Promise<void> {
    if (!editingId) {
      return;
    }
    const response = await fetchJson<RepertoireItem>(`/api/repertoires/${editingId}`, {
      method: "PATCH",
      body: JSON.stringify({
        name,
        description: description.trim() || null,
        orientation,
        color: color.trim() || null,
      }),
    });
    if (response.status !== 200) {
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to update repertoire (status ${response.status})`;
      toasts.pushToast({ kind: "error", message: msg });
      return;
    }
    resetForm();
    toasts.pushToast({ kind: "success", message: "Repertoire updated" });
    await queryClient.invalidateQueries({ queryKey: ["repertoires"] });
  }

  async function deleteRepertoire(id: number): Promise<void> {
    const response = await fetchJson<Record<string, never>>(`/api/repertoires/${id}`, { method: "DELETE" });
    if (response.status !== 204) {
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to delete repertoire (status ${response.status})`;
      toasts.pushToast({ kind: "error", message: msg });
      return;
    }
    if (selectedRepertoireId === id) {
      setSelectedRepertoireId(null);
    }
    toasts.pushToast({ kind: "success", message: "Repertoire deleted" });
    await queryClient.invalidateQueries({ queryKey: ["repertoires"] });
  }

  async function togglePublic(repertoire: RepertoireItem): Promise<void> {
    const response = await fetchJson<RepertoireItem>(`/api/repertoires/${repertoire.id}`, {
      method: "PATCH",
      body: JSON.stringify({ isPublic: !repertoire.isPublic }),
    });
    if (response.status !== 200 || !("isPublic" in response.data)) {
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to update publishing (status ${response.status})`;
      toasts.pushToast({ kind: "error", message: msg });
      return;
    }
    toasts.pushToast({
      kind: "success",
      message: response.data.isPublic ? "Repertoire published" : "Repertoire unpublished",
    });
    await queryClient.invalidateQueries({ queryKey: ["repertoires"] });
  }

  async function addEntry(): Promise<void> {
    if (!selectedRepertoireId) {
      toasts.pushToast({ kind: "error", message: "Choose a repertoire first" });
      return;
    }
    const response = await fetchJson<{ id: number }>(`/api/repertoires/${selectedRepertoireId}/entries`, {
      method: "POST",
      body: JSON.stringify({
        positionFen: entryPositionFen,
        moveUci: entryMoveUci,
        note: entryNote.trim() || undefined,
      }),
    });
    if (response.status !== 201) {
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to add entry (status ${response.status})`;
      toasts.pushToast({ kind: "error", message: msg });
      return;
    }
    setEntryMoveUci("");
    setEntryNote("");
    toasts.pushToast({ kind: "success", message: "Repertoire entry added" });
    await queryClient.invalidateQueries({ queryKey: ["repertoires"] });
    await queryClient.invalidateQueries({ queryKey: ["repertoire-entries", { selectedRepertoireId }] });
  }

  async function saveEntryNote(): Promise<void> {
    if (!editingEntryId) {
      return;
    }
    const response = await fetchJson<{ ok: true }>(`/api/repertoire-entries/${editingEntryId}`, {
      method: "PATCH",
      body: JSON.stringify({
        note: editingEntryNote.trim() || null,
      }),
    });
    if (response.status !== 200) {
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to update repertoire entry (status ${response.status})`;
      toasts.pushToast({ kind: "error", message: msg });
      return;
    }
    setEditingEntryId(null);
    setEditingEntryNote("");
    toasts.pushToast({ kind: "success", message: "Entry updated" });
    await queryClient.invalidateQueries({ queryKey: ["repertoire-entries", { selectedRepertoireId }] });
  }

  async function deleteEntry(entryId: number): Promise<void> {
    const response = await fetchJson<Record<string, never>>(`/api/repertoire-entries/${entryId}`, { method: "DELETE" });
    if (response.status !== 204) {
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to delete repertoire entry (status ${response.status})`;
      toasts.pushToast({ kind: "error", message: msg });
      return;
    }
    toasts.pushToast({ kind: "success", message: "Entry deleted" });
    await queryClient.invalidateQueries({ queryKey: ["repertoires"] });
    await queryClient.invalidateQueries({ queryKey: ["repertoire-entries", { selectedRepertoireId }] });
  }

  const selectedRepertoire = repertoires.data?.find((item) => item.id === selectedRepertoireId) ?? null;

  return (
    <main>
      <section className="card">
        <div className="section-head">
          <h2>Repertoires</h2>
          <div className="button-row">
            <Link href="/drill">Drill mode</Link>
            <Link href="/games">Games</Link>
            <Link href="/diagnostics">Diagnostics</Link>
          </div>
        </div>
        <p className="muted">Build opening repertoires, drill them, and publish lines for others to study.</p>
      </section>

      <section className="card">
        <h2>{editingId ? `Edit repertoire #${editingId}` : "New repertoire"}</h2>
        <div className="auth-grid">
          <label>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. White vs Sicilian" />
          </label>
          <label>
            Description
            <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional" />
          </label>
          <label>
            Orientation
            <select value={orientation} onChange={(event) => setOrientation(event.target.value as typeof orientation)}>
              <option value="either">Either</option>
              <option value="white">White</option>
              <option value="black">Black</option>
            </select>
          </label>
          <label>
            Accent color
            <input value={color} onChange={(event) => setColor(event.target.value)} placeholder="#2f6bff" />
          </label>
          <div className="button-row" style={{ alignSelf: "end" }}>
            {editingId ? (
              <>
                <button type="button" onClick={() => void saveRepertoire()} disabled={!name.trim()}>
                  Save
                </button>
                <button type="button" onClick={() => resetForm()}>
                  Cancel
                </button>
              </>
            ) : (
              <button type="button" onClick={() => void createRepertoire()} disabled={!name.trim()}>
                Create
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Your Repertoires</h2>
          <div className="button-row">
            <button type="button" onClick={() => void repertoires.refetch()} disabled={repertoires.isFetching}>
              Refresh
            </button>
          </div>
        </div>

        {repertoires.isLoading ? <p className="muted">Loading repertoires...</p> : null}
        {repertoires.isError ? <p className="muted">Error: {String(repertoires.error)}</p> : null}

        {repertoires.data ? (
          <div className="table-wrap">
            <table style={{ minWidth: 1000 }}>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Orientation</th>
                  <th>Entries</th>
                  <th>Practiced</th>
                  <th>Published</th>
                  <th>Updated</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {repertoires.data.map((repertoire) => (
                  <tr key={repertoire.id} style={selectedRepertoireId === repertoire.id ? { background: "rgba(47, 107, 255, 0.08)" } : undefined}>
                    <td>{repertoire.id}</td>
                    <td>
                      <strong>{repertoire.name}</strong>
                      <div className="muted muted-small">{repertoire.description ?? "No description"}</div>
                    </td>
                    <td>{repertoire.orientation}</td>
                    <td>{repertoire.entryCount}</td>
                    <td>{repertoire.practicedCount}</td>
                    <td>{repertoire.isPublic ? "Yes" : "No"}</td>
                    <td>{new Date(repertoire.updatedAt).toLocaleString()}</td>
                    <td>
                      <div className="button-row">
                        <button type="button" onClick={() => setSelectedRepertoireId(repertoire.id)}>
                          Open
                        </button>
                        <Link href={`/drill?repertoireId=${repertoire.id}`}>Drill</Link>
                        {repertoire.isPublic ? (
                          <>
                            <Link href={`/shared/repertoires/${repertoire.shareToken}`}>Public view</Link>
                            <button type="button" onClick={() => void copyShareLink(repertoire.shareToken)}>
                              Copy link
                            </button>
                          </>
                        ) : null}
                        <button type="button" onClick={() => void togglePublic(repertoire)}>
                          {repertoire.isPublic ? "Unpublish" : "Publish"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(repertoire.id);
                            setName(repertoire.name);
                            setDescription(repertoire.description ?? "");
                            setOrientation(repertoire.orientation);
                            setColor(repertoire.color ?? "#2f6bff");
                          }}
                        >
                          Edit
                        </button>
                        <button type="button" onClick={() => void deleteRepertoire(repertoire.id)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {repertoires.data.length === 0 ? (
                  <tr>
                    <td colSpan={8}>No repertoires yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="card">
        <div className="section-head">
          <h2>{selectedRepertoire ? `Entries: ${selectedRepertoire.name}` : "Entries"}</h2>
          {selectedRepertoire ? (
            <div className="button-row">
              <Link href={`/drill?repertoireId=${selectedRepertoire.id}`}>Open drill</Link>
              {selectedRepertoire.isPublic ? <Link href={`/shared/repertoires/${selectedRepertoire.shareToken}`}>Public page</Link> : null}
            </div>
          ) : null}
        </div>

        {selectedRepertoire ? (
          <>
            <div className="auth-grid">
              <label>
                Position FEN
                <input value={entryPositionFen} onChange={(event) => setEntryPositionFen(event.target.value)} placeholder="startpos" />
              </label>
              <label>
                Move UCI
                <input value={entryMoveUci} onChange={(event) => setEntryMoveUci(event.target.value)} placeholder="e2e4" />
              </label>
              <label>
                Note
                <input value={entryNote} onChange={(event) => setEntryNote(event.target.value)} placeholder="Optional prep note" />
              </label>
              <div className="button-row" style={{ alignSelf: "end" }}>
                <button type="button" onClick={() => void addEntry()} disabled={!entryPositionFen.trim() || !entryMoveUci.trim()}>
                  Add entry
                </button>
              </div>
            </div>

            {entries.isLoading ? <p className="muted">Loading entries...</p> : null}
            {entries.isError ? <p className="muted">Error: {String(entries.error)}</p> : null}
            {entries.data ? (
              <div className="table-wrap" style={{ marginTop: 16 }}>
                <table style={{ minWidth: 1100 }}>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Position</th>
                      <th>Move</th>
                      <th>Note</th>
                      <th>Drill</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.data.map((entry) => (
                      <tr key={entry.id}>
                        <td>{entry.id}</td>
                        <td style={{ maxWidth: 320, wordBreak: "break-word" }}>
                          <div>{entry.positionFen}</div>
                          <div className="muted muted-small">Parent: {entry.parentEntryId ?? "-"}</div>
                        </td>
                        <td>
                          <strong>{entry.moveSan ?? entry.moveUci}</strong>
                          <div className="muted muted-small">{entry.moveUci}</div>
                        </td>
                        <td style={{ maxWidth: 320 }}>
                          {editingEntryId === entry.id ? (
                            <div className="button-stack">
                              <textarea rows={3} value={editingEntryNote} onChange={(event) => setEditingEntryNote(event.target.value)} />
                              <div className="button-row">
                                <button type="button" onClick={() => void saveEntryNote()}>
                                  Save
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingEntryId(null);
                                    setEditingEntryNote("");
                                  }}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            entry.note ?? "-"
                          )}
                        </td>
                        <td>
                          {entry.correctCount}/{entry.practiceCount}
                          <div className="muted muted-small">
                            {entry.lastDrilledAt ? new Date(entry.lastDrilledAt).toLocaleString() : "Not drilled"}
                          </div>
                        </td>
                        <td>
                          <div className="button-row">
                            <Link href={`/search/position?fen=${encodeURIComponent(entry.positionFen)}`}>Search</Link>
                            {entry.nextFen ? <Link href={`/openings?fen=${encodeURIComponent(entry.nextFen)}`}>Openings</Link> : null}
                            <button
                              type="button"
                              onClick={() => {
                                setEditingEntryId(entry.id);
                                setEditingEntryNote(entry.note ?? "");
                              }}
                            >
                              Edit note
                            </button>
                            <button type="button" onClick={() => void deleteEntry(entry.id)}>
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {entries.data.length === 0 ? (
                      <tr>
                        <td colSpan={6}>No entries yet.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        ) : (
          <p className="muted">Create a repertoire or select one to manage its entries.</p>
        )}
      </section>
    </main>
  );
}
