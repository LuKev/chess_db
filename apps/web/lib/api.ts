"use client";

export function apiBaseUrl(): string {
  if (typeof window !== "undefined") {
    const host = window.location.hostname.toLowerCase();
    if (host.endsWith("kezilu.com")) {
      return "https://api.kezilu.com";
    }
    if (host === "localhost" || host === "127.0.0.1") {
      return "http://localhost:4000";
    }
  }

  if (process.env.NEXT_PUBLIC_API_BASE_URL) {
    return process.env.NEXT_PUBLIC_API_BASE_URL;
  }

  return "http://localhost:4000";
}

export async function fetchJson<T>(
  path: string,
  init: RequestInit = {},
  options: { jsonBody?: boolean } = { jsonBody: true }
): Promise<{ status: number; data: T | { error?: string } }> {
  const headers = new Headers(init.headers);
  const hasBody = init.body !== undefined && init.body !== null;

  if (
    options.jsonBody &&
    hasBody &&
    !(init.body instanceof FormData) &&
    !headers.has("content-type")
  ) {
    headers.set("content-type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      ...init,
      credentials: "include",
      headers,
      cache: "no-store",
    });
  } catch (error) {
    return {
      status: 0,
      data: { error: `Network error: ${String(error)}` },
    };
  }

  let data: T | { error?: string };
  try {
    data = (await response.json()) as T | { error?: string };
  } catch {
    data = {};
  }

  return { status: response.status, data };
}

export async function fetchText(
  path: string,
  init: RequestInit = {}
): Promise<{ status: number; text: string }> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      ...init,
      credentials: "include",
      cache: "no-store",
    });
  } catch (error) {
    return {
      status: 0,
      text: `Network error: ${String(error)}`,
    };
  }

  return {
    status: response.status,
    text: await response.text(),
  };
}

