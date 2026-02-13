"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "../../../lib/api";
import { useToasts } from "../../../components/ToastsProvider";

type TagItem = {
  id: number;
  name: string;
  color: string | null;
  gameCount: number;
  createdAt: string;
};

type TagListResponse = {
  items: TagItem[];
};

export default function TagsPage() {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#4f8f6b");
  const [editingId, setEditingId] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const toasts = useToasts();

  const tags = useQuery({
    queryKey: ["tags"],
    queryFn: async (): Promise<TagItem[]> => {
      const response = await fetchJson<TagListResponse>("/api/tags", { method: "GET" });
      if (response.status === 200 && "items" in response.data) {
        return response.data.items;
      }
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to load tags (status ${response.status})`;
      throw new Error(msg);
    },
  });

  function resetForm(): void {
    setName("");
    setColor("#4f8f6b");
    setEditingId(null);
  }

  async function createTag(): Promise<void> {
    const response = await fetchJson<TagItem>("/api/tags", {
      method: "POST",
      body: JSON.stringify({ name, color }),
    });
    if (response.status !== 201) {
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to create tag (status ${response.status})`;
      toasts.pushToast({ kind: "error", message: msg });
      return;
    }
    toasts.pushToast({ kind: "success", message: "Tag created" });
    resetForm();
    await queryClient.invalidateQueries({ queryKey: ["tags"] });
  }

  async function saveEdit(): Promise<void> {
    if (!editingId) {
      return;
    }
    const response = await fetchJson<TagItem>(`/api/tags/${editingId}`, {
      method: "PATCH",
      body: JSON.stringify({ name, color }),
    });
    if (response.status !== 200) {
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to update tag (status ${response.status})`;
      toasts.pushToast({ kind: "error", message: msg });
      return;
    }
    toasts.pushToast({ kind: "success", message: "Tag updated" });
    resetForm();
    await queryClient.invalidateQueries({ queryKey: ["tags"] });
  }

  async function deleteTag(id: number): Promise<void> {
    const response = await fetchJson<Record<string, never>>(`/api/tags/${id}`, { method: "DELETE" });
    if (response.status !== 204) {
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to delete tag (status ${response.status})`;
      toasts.pushToast({ kind: "error", message: msg });
      return;
    }
    toasts.pushToast({ kind: "success", message: "Tag deleted" });
    await queryClient.invalidateQueries({ queryKey: ["tags"] });
  }

  return (
    <main>
      <section className="card">
        <div className="section-head">
          <h2>Tags</h2>
          <div className="button-row">
            <Link href="/games">Games</Link>
            <Link href="/diagnostics">Diagnostics</Link>
          </div>
        </div>
        <p className="muted">Create and manage tag labels for games.</p>
      </section>

      <section className="card">
        <h2>{editingId ? `Edit tag #${editingId}` : "New tag"}</h2>
        <div className="auth-grid">
          <label>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Tactics" />
          </label>
          <label>
            Color
            <input value={color} onChange={(event) => setColor(event.target.value)} placeholder="#4f8f6b" />
          </label>
          <div className="button-row" style={{ alignSelf: "end" }}>
            {editingId ? (
              <>
                <button type="button" onClick={() => void saveEdit()} disabled={!name.trim()}>
                  Save
                </button>
                <button type="button" onClick={() => resetForm()}>
                  Cancel
                </button>
              </>
            ) : (
              <button type="button" onClick={() => void createTag()} disabled={!name.trim()}>
                Create
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>All Tags</h2>
          <div className="button-row">
            <button type="button" onClick={() => void tags.refetch()} disabled={tags.isFetching}>
              Refresh
            </button>
          </div>
        </div>

        {tags.isLoading ? <p className="muted">Loading tags...</p> : null}
        {tags.isError ? <p className="muted">Error: {String(tags.error)}</p> : null}

        {tags.data ? (
          <div className="table-wrap">
            <table style={{ minWidth: 650 }}>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Color</th>
                  <th>Games</th>
                  <th>Created</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {tags.data.map((tag) => (
                  <tr key={tag.id}>
                    <td>{tag.id}</td>
                    <td>{tag.name}</td>
                    <td>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <span
                          style={{
                            width: 12,
                            height: 12,
                            borderRadius: 999,
                            background: tag.color ?? "#aaa",
                            border: "1px solid var(--line)",
                          }}
                        />
                        {tag.color ?? "-"}
                      </span>
                    </td>
                    <td>{tag.gameCount}</td>
                    <td>{new Date(tag.createdAt).toLocaleString()}</td>
                    <td>
                      <div className="button-row">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(tag.id);
                            setName(tag.name);
                            setColor(tag.color ?? "#4f8f6b");
                          }}
                        >
                          Edit
                        </button>
                        <button type="button" onClick={() => void deleteTag(tag.id)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {tags.data.length === 0 ? (
                  <tr>
                    <td colSpan={6}>No tags yet.</td>
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

