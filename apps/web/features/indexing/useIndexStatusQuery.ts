"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "../../lib/api";

export type IndexLifecycle = {
  rawStatus: string;
  status: "not_indexed" | "indexing" | "indexed" | "failed";
  pendingGames: number;
  indexedGames: number;
  stale: boolean;
  lastRequestedAt: string | null;
  lastCompletedAt: string | null;
  lastError: string | null;
};

export type IndexStatusResponse = {
  totalGames: number;
  position: IndexLifecycle;
  opening: IndexLifecycle;
};

export function useIndexStatusQuery() {
  return useQuery({
    queryKey: ["index-status"],
    queryFn: async (): Promise<IndexStatusResponse> => {
      const response = await fetchJson<IndexStatusResponse>("/api/backfill/status", {
        method: "GET",
      });
      if (response.status === 200 && "position" in response.data) {
        return response.data;
      }
      const message =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to load index status (status ${response.status})`;
      throw new Error(message);
    },
  });
}
