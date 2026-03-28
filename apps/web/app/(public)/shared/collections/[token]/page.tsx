"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "../../../../../lib/api";

type PublicCollectionResponse = {
  collection: {
    id: number;
    name: string;
    description: string | null;
    updatedAt: string;
  };
  items: Array<{
    id: number;
    white: string;
    black: string;
    result: string;
    event: string | null;
    eco: string | null;
    date: string | null;
  }>;
};

export default function PublicCollectionPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const collection = useQuery({
    queryKey: ["public-collection", { token }],
    enabled: Boolean(token),
    queryFn: async (): Promise<PublicCollectionResponse> => {
      const response = await fetchJson<PublicCollectionResponse>(`/api/public/collections/${token}`, { method: "GET" });
      if (response.status === 200 && "collection" in response.data) {
        return response.data;
      }
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to load published collection (status ${response.status})`;
      throw new Error(msg);
    },
  });

  return (
    <main>
      <section className="card">
        <div className="section-head">
          <h2>Published Collection</h2>
          <div className="button-row">
            <Link href="/login">Log in</Link>
            <Link href="/viewer-demo">Viewer demo</Link>
          </div>
        </div>
        {collection.isLoading ? <p className="muted">Loading collection...</p> : null}
        {collection.isError ? <p className="muted">Error: {String(collection.error)}</p> : null}
        {collection.data ? (
          <>
            <p className="muted">
              {collection.data.collection.name}
              {collection.data.collection.description ? ` · ${collection.data.collection.description}` : ""}
            </p>
            <p className="muted">Updated {new Date(collection.data.collection.updatedAt).toLocaleString()}</p>
          </>
        ) : null}
      </section>

      <section className="card">
        <h2>Games</h2>
        {collection.data ? (
          <div className="table-wrap">
            <table style={{ minWidth: 900 }}>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Players</th>
                  <th>Result</th>
                  <th>Event</th>
                  <th>ECO</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {collection.data.items.map((game) => (
                  <tr key={game.id}>
                    <td>{game.id}</td>
                    <td>
                      {game.white} vs {game.black}
                    </td>
                    <td>{game.result}</td>
                    <td>{game.event ?? "-"}</td>
                    <td>{game.eco ?? "-"}</td>
                    <td>{game.date ?? "-"}</td>
                  </tr>
                ))}
                {collection.data.items.length === 0 ? (
                  <tr>
                    <td colSpan={6}>This collection has no games.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No collection loaded yet.</p>
        )}
      </section>
    </main>
  );
}
