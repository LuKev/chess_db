"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "../../../lib/api";
import { useToasts } from "../../../components/ToastsProvider";

type CollectionItem = {
  id: number;
  name: string;
  description: string | null;
  gameCount: number;
  createdAt: string;
  updatedAt: string;
};

type CollectionListResponse = {
  items: CollectionItem[];
};

export default function CollectionsPage() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const toasts = useToasts();

  const collections = useQuery({
    queryKey: ["collections"],
    queryFn: async (): Promise<CollectionItem[]> => {
      const response = await fetchJson<CollectionListResponse>("/api/collections", { method: "GET" });
      if (response.status === 200 && "items" in response.data) {
        return response.data.items;
      }
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to load collections (status ${response.status})`;
      throw new Error(msg);
    },
  });

  function resetForm(): void {
    setName("");
    setDescription("");
    setEditingId(null);
  }

  async function createCollection(): Promise<void> {
    const response = await fetchJson<CollectionItem>("/api/collections", {
      method: "POST",
      body: JSON.stringify({
        name,
        description: description.trim().length > 0 ? description.trim() : undefined,
      }),
    });
    if (response.status !== 201) {
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to create collection (status ${response.status})`;
      toasts.pushToast({ kind: "error", message: msg });
      return;
    }
    toasts.pushToast({ kind: "success", message: "Collection created" });
    resetForm();
    await queryClient.invalidateQueries({ queryKey: ["collections"] });
  }

  async function saveEdit(): Promise<void> {
    if (!editingId) {
      return;
    }
    const response = await fetchJson<CollectionItem>(`/api/collections/${editingId}`, {
      method: "PATCH",
      body: JSON.stringify({
        name,
        description: description.trim().length > 0 ? description.trim() : null,
      }),
    });
    if (response.status !== 200) {
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to update collection (status ${response.status})`;
      toasts.pushToast({ kind: "error", message: msg });
      return;
    }
    toasts.pushToast({ kind: "success", message: "Collection updated" });
    resetForm();
    await queryClient.invalidateQueries({ queryKey: ["collections"] });
  }

  async function deleteCollection(id: number): Promise<void> {
    const response = await fetchJson<Record<string, never>>(`/api/collections/${id}`, { method: "DELETE" });
    if (response.status !== 204) {
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to delete collection (status ${response.status})`;
      toasts.pushToast({ kind: "error", message: msg });
      return;
    }
    toasts.pushToast({ kind: "success", message: "Collection deleted" });
    await queryClient.invalidateQueries({ queryKey: ["collections"] });
  }

  return (
    <main>
      <section className="card">
        <div className="section-head">
          <h2>Collections</h2>
          <div className="button-row">
            <Link href="/games">Games</Link>
            <Link href="/diagnostics">Diagnostics</Link>
          </div>
        </div>
        <p className="muted">Group games into named collections.</p>
      </section>

      <section className="card">
        <h2>{editingId ? `Edit collection #${editingId}` : "New collection"}</h2>
        <div className="auth-grid">
          <label>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Tournament Prep" />
          </label>
          <label>
            Description
            <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional" />
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
              <button type="button" onClick={() => void createCollection()} disabled={!name.trim()}>
                Create
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>All Collections</h2>
          <div className="button-row">
            <button type="button" onClick={() => void collections.refetch()} disabled={collections.isFetching}>
              Refresh
            </button>
          </div>
        </div>

        {collections.isLoading ? <p className="muted">Loading collections...</p> : null}
        {collections.isError ? <p className="muted">Error: {String(collections.error)}</p> : null}

        {collections.data ? (
          <div className="table-wrap">
            <table style={{ minWidth: 700 }}>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Description</th>
                  <th>Games</th>
                  <th>Updated</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {collections.data.map((collection) => (
                  <tr key={collection.id}>
                    <td>{collection.id}</td>
                    <td>{collection.name}</td>
                    <td>{collection.description ?? "-"}</td>
                    <td>{collection.gameCount}</td>
                    <td>{new Date(collection.updatedAt).toLocaleString()}</td>
                    <td>
                      <div className="button-row">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(collection.id);
                            setName(collection.name);
                            setDescription(collection.description ?? "");
                          }}
                        >
                          Edit
                        </button>
                        <button type="button" onClick={() => void deleteCollection(collection.id)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {collections.data.length === 0 ? (
                  <tr>
                    <td colSpan={6}>No collections yet.</td>
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

