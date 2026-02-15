export const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const FALLBACK_BASE_PATH =
  process.env.NEXT_PUBLIC_FALLBACK_BASE_PATH ?? "/chess_db";

function stripKnownBasePath(path: string, knownBasePath: string): string {
  const resolved = path || "/";
  if (!knownBasePath) {
    return resolved;
  }
  if (resolved === knownBasePath) {
    return "/";
  }
  if (resolved.startsWith(`${knownBasePath}/`)) {
    return resolved.slice(knownBasePath.length) || "/";
  }
  return resolved;
}

export function stripBasePath(path: string): string {
  return stripKnownBasePath(path, basePath);
}

export function stripAppBasePath(path: string): string {
  // Defensive: production can be served under /chess_db (Cloudflare) even if the app is also
  // reachable at /. Keep next redirects basePath-relative to avoid /chess_db/chess_db/... 404s.
  return stripBasePath(stripKnownBasePath(path, FALLBACK_BASE_PATH));
}
