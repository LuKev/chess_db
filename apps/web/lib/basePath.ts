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

