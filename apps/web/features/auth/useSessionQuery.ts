"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "../../lib/api";

export type SessionUser = {
  id: number;
  email: string;
  createdAt: string;
};

export function useSessionQuery() {
  return useQuery({
    queryKey: ["session"],
    queryFn: async (): Promise<{ user: SessionUser | null }> => {
      const response = await fetchJson<{ user: SessionUser }>("/api/auth/me", {
        method: "GET",
      });
      if (response.status === 200 && "user" in response.data) {
        return { user: response.data.user };
      }
      if (response.status === 401) {
        return { user: null };
      }
      const errorMessage =
        "error" in response.data && response.data.error
          ? response.data.error
          : `Failed to load session (status ${response.status})`;
      throw new Error(errorMessage);
    },
  });
}

