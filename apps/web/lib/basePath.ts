export const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function stripBasePath(path: string): string {
  if (!basePath) {
    return path || "/";
  }
  if (path === basePath) {
    return "/";
  }
  if (path.startsWith(`${basePath}/`)) {
    return path.slice(basePath.length) || "/";
  }
  return path || "/";
}

const FALLBACK_BASE_PATH = "/chess_db";

function stripFallbackBasePath(path: string): string {
  if (!path) {
    return "/";
  }
  if (path === FALLBACK_BASE_PATH) {
    return "/";
  }
  if (path.startsWith(`${FALLBACK_BASE_PATH}/`)) {
    return path.slice(FALLBACK_BASE_PATH.length) || "/";
  }
  return path;
}

export function stripAppBasePath(path: string): string {
  // Defensive: production can be served under /chess_db (Cloudflare) even if the app is also
  // reachable at /. Keep next redirects basePath-relative to avoid /chess_db/chess_db/... 404s.
  return stripBasePath(stripFallbackBasePath(path));
}
