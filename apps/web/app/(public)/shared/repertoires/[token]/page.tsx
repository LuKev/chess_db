"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FenPreviewBoard } from "../../../../../components/FenPreviewBoard";
import { useToasts } from "../../../../../components/ToastsProvider";
import { fetchJson } from "../../../../../lib/api";

type PublicRepertoireResponse = {
  repertoire: {
    id: number;
    name: string;
    description: string | null;
    orientation: string;
    color: string | null;
    updatedAt: string;
  };
  items: Array<{
    id: number;
    parentEntryId: number | null;
    positionFen: string;
    moveUci: string;
    moveSan: string | null;
    note: string | null;
    practiceCount: number;
    correctCount: number;
  }>;
};

export default function PublicRepertoirePage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const router = useRouter();
  const toasts = useToasts();
  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(null);

  const repertoire = useQuery({
    queryKey: ["public-repertoire", { token }],
    enabled: Boolean(token),
    queryFn: async (): Promise<PublicRepertoireResponse> => {
      const response = await fetchJson<PublicRepertoireResponse>(`/api/public/repertoires/${token}`, { method: "GET" });
      if (response.status === 200 && "repertoire" in response.data) {
        return response.data;
      }
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to load published repertoire (status ${response.status})`;
      throw new Error(msg);
    },
  });

  const selectedEntry = useMemo(() => {
    const items = repertoire.data?.items ?? [];
    if (items.length === 0) {
      return null;
    }
    return items.find((item) => item.id === selectedEntryId) ?? items[0];
  }, [repertoire.data?.items, selectedEntryId]);

  async function cloneRepertoire(): Promise<void> {
    const response = await fetchJson<{ id: number }>(`/api/public/repertoires/${token}/clone`, { method: "POST" });
    if (response.status === 201 && "id" in response.data) {
      toasts.pushToast({ kind: "success", message: "Repertoire cloned to your account" });
      router.push(`/repertoires`);
      return;
    }
    if (response.status === 401) {
      router.push(`/login?next=${encodeURIComponent(`/shared/repertoires/${token}`)}`);
      return;
    }
    const msg =
      "error" in response.data && response.data.error
        ? response.data.error
        : `Failed to clone repertoire (status ${response.status})`;
    toasts.pushToast({ kind: "error", message: msg });
  }

  return (
    <main>
      <section className="card">
        <div className="section-head">
          <h2>Published Repertoire</h2>
          <div className="button-row">
            <button type="button" onClick={() => void cloneRepertoire()}>
              Clone to my account
            </button>
            <Link href="/login">Log in</Link>
          </div>
        </div>
        {repertoire.isLoading ? <p className="muted">Loading repertoire...</p> : null}
        {repertoire.isError ? <p className="muted">Error: {String(repertoire.error)}</p> : null}
        {repertoire.data ? (
          <>
            <p className="muted">
              {repertoire.data.repertoire.name}
              {repertoire.data.repertoire.description ? ` · ${repertoire.data.repertoire.description}` : ""}
            </p>
            <p className="muted">
              Orientation: {repertoire.data.repertoire.orientation} · Updated {new Date(repertoire.data.repertoire.updatedAt).toLocaleString()}
            </p>
          </>
        ) : null}
      </section>

      {selectedEntry ? (
        <section className="card">
          <FenPreviewBoard fen={selectedEntry.positionFen} title="Selected Position" />
        </section>
      ) : null}

      <section className="card">
        <h2>Lines</h2>
        {repertoire.data ? (
          <div className="table-wrap">
            <table style={{ minWidth: 1000 }}>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Move</th>
                  <th>Position</th>
                  <th>Note</th>
                  <th>Practice</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {repertoire.data.items.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.id}</td>
                    <td>
                      <strong>{entry.moveSan ?? entry.moveUci}</strong>
                      <div className="muted muted-small">{entry.moveUci}</div>
                    </td>
                    <td style={{ maxWidth: 320, wordBreak: "break-word" }}>{entry.positionFen}</td>
                    <td>{entry.note ?? "-"}</td>
                    <td>
                      {entry.correctCount}/{entry.practiceCount}
                    </td>
                    <td>
                      <button type="button" onClick={() => setSelectedEntryId(entry.id)}>
                        Preview
                      </button>
                    </td>
                  </tr>
                ))}
                {repertoire.data.items.length === 0 ? (
                  <tr>
                    <td colSpan={6}>This repertoire has no entries.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No repertoire loaded yet.</p>
        )}
      </section>
    </main>
  );
}
