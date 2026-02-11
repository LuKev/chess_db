type MoveNode = {
  notation?: {
    notation?: string;
  };
};

function isMoveNode(value: unknown): value is MoveNode {
  return Boolean(value) && typeof value === "object";
}

export function extractMainlineSans(moveTree: Record<string, unknown>): string[] {
  const direct = moveTree.mainline;
  if (Array.isArray(direct) && direct.every((value) => typeof value === "string")) {
    return direct as string[];
  }

  const maybeMoves = moveTree.moves;
  if (!Array.isArray(maybeMoves)) {
    return [];
  }

  const sans: string[] = [];
  for (const move of maybeMoves) {
    if (!isMoveNode(move)) {
      continue;
    }
    const san = move.notation?.notation;
    if (typeof san === "string" && san.trim().length > 0) {
      sans.push(san.trim());
    }
  }

  return sans;
}

export function buildMoveSnippet(
  sans: string[],
  ply: number,
  radius: number = 4
): { before: string[]; at: string | null; after: string[] } {
  const clampedPly = Math.max(0, Math.min(sans.length, ply));
  const before = sans.slice(Math.max(0, clampedPly - radius), clampedPly);
  const at = clampedPly > 0 ? sans[clampedPly - 1] ?? null : null;
  const after = sans.slice(clampedPly, Math.min(sans.length, clampedPly + radius));
  return { before, at, after };
}

