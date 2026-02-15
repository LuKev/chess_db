"use client";

type MoveNode = {
  notation?: {
    notation?: string;
  };
};

function isMoveNode(value: unknown): value is MoveNode {
  return Boolean(value) && typeof value === "object";
}

export function extractMainlineSans(moveTree: Record<string, unknown> | null | undefined): string[] {
  if (!moveTree) {
    return [];
  }

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

