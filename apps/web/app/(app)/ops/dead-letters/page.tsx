"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "../../../../lib/api";

type DeadLetterItem = {
  id: number;
  queueName: string;
  jobName: string;
  jobId: string | null;
  attemptsMade: number;
  maxAttempts: number;
  failedReason: string | null;
  createdAt: string;
};

type DeadLetterResponse = {
  page: number;
  pageSize: number;
  total: number;
  items: DeadLetterItem[];
};

export default function DeadLettersPage() {
  const [page, setPage] = useState(1);

  const deadLetters = useQuery({
    queryKey: ["dead-letters", { page }],
    queryFn: async (): Promise<DeadLetterResponse> => {
      const response = await fetchJson<DeadLetterResponse>(`/api/ops/dead-letters?page=${page}&pageSize=20`, {
        method: "GET",
      });
      if (response.status === 200 && "items" in response.data) {
        return response.data;
      }
      const msg =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to load dead letters (status ${response.status})`;
      throw new Error(msg);
    },
  });

  const pageCount =
    deadLetters.data ? Math.max(1, Math.ceil(deadLetters.data.total / deadLetters.data.pageSize)) : 1;

  return (
    <main>
      <section className="card">
        <div className="section-head">
          <h2>Dead Letters</h2>
          <div className="button-row">
            <Link href="/games">Games</Link>
            <Link href="/diagnostics">Diagnostics</Link>
          </div>
        </div>
        <p className="muted">Inspect jobs that exceeded retry limits.</p>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Queue Dead Letters</h2>
          <div className="button-row">
            <button type="button" onClick={() => void deadLetters.refetch()} disabled={deadLetters.isFetching}>
              Refresh
            </button>
          </div>
        </div>

        {deadLetters.isLoading ? <p className="muted">Loading...</p> : null}
        {deadLetters.isError ? <p className="muted">Error: {String(deadLetters.error)}</p> : null}

        {deadLetters.data ? (
          <>
            <p className="muted">{deadLetters.data.total} total</p>
            <div className="table-wrap">
              <table style={{ minWidth: 1000 }}>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Queue</th>
                    <th>Job</th>
                    <th>Job ID</th>
                    <th>Attempts</th>
                    <th>Reason</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {deadLetters.data.items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.id}</td>
                      <td>{item.queueName}</td>
                      <td>{item.jobName}</td>
                      <td style={{ fontFamily: "monospace" }}>{item.jobId ?? "-"}</td>
                      <td>
                        {item.attemptsMade}/{item.maxAttempts}
                      </td>
                      <td style={{ maxWidth: 420 }}>{item.failedReason ?? "-"}</td>
                      <td>{new Date(item.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                  {deadLetters.data.items.length === 0 ? (
                    <tr>
                      <td colSpan={7}>No dead letters.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="button-row" style={{ marginTop: 10 }}>
              <button type="button" onClick={() => setPage((v) => Math.max(1, v - 1))} disabled={page <= 1}>
                Previous
              </button>
              <span>
                Page {page} / {pageCount}
              </span>
              <button type="button" onClick={() => setPage((v) => Math.min(pageCount, v + 1))} disabled={page >= pageCount}>
                Next
              </button>
            </div>
          </>
        ) : null}
      </section>
    </main>
  );
}

