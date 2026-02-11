type MaterialCounts = {
  K: number;
  Q: number;
  R: number;
  B: number;
  N: number;
  P: number;
  k: number;
  q: number;
  r: number;
  b: number;
  n: number;
  p: number;
};

export type NormalizedFen = {
  fenNorm: string;
  stm: "w" | "b";
  castling: string;
  epSquare: string | null;
  halfmove: number;
  fullmove: number;
  materialKey: string;
};

function emptyMaterialCounts(): MaterialCounts {
  return {
    K: 0,
    Q: 0,
    R: 0,
    B: 0,
    N: 0,
    P: 0,
    k: 0,
    q: 0,
    r: 0,
    b: 0,
    n: 0,
    p: 0,
  };
}

function buildMaterialKey(counts: MaterialCounts): string {
  const white = `K${counts.K}Q${counts.Q}R${counts.R}B${counts.B}N${counts.N}P${counts.P}`;
  const black = `K${counts.k}Q${counts.q}R${counts.r}B${counts.b}N${counts.n}P${counts.p}`;
  return `w:${white}|b:${black}`;
}

export function normalizeFen(fen: string): NormalizedFen {
  const fields = fen.trim().split(/\s+/);
  if (fields.length < 4) {
    throw new Error("Invalid FEN: expected at least 4 fields");
  }

  const board = fields[0];
  const stm = fields[1] === "b" ? "b" : "w";
  const castling = fields[2] && fields[2] !== "-" ? fields[2] : "-";
  const epSquare = fields[3] && fields[3] !== "-" ? fields[3] : null;
  const halfmove = Number.parseInt(fields[4] ?? "0", 10);
  const fullmove = Number.parseInt(fields[5] ?? "1", 10);
  const counts = emptyMaterialCounts();

  for (const char of board) {
    if (char === "/" || /[1-8]/.test(char)) {
      continue;
    }
    if (char in counts) {
      counts[char as keyof MaterialCounts] += 1;
    }
  }

  return {
    fenNorm: `${board} ${stm} ${castling} ${epSquare ?? "-"}`,
    stm,
    castling,
    epSquare,
    halfmove: Number.isInteger(halfmove) && halfmove >= 0 ? halfmove : 0,
    fullmove: Number.isInteger(fullmove) && fullmove >= 1 ? fullmove : 1,
    materialKey: buildMaterialKey(counts),
  };
}

export function buildMaterialLikeQueryFromFen(fen: string): string {
  return normalizeFen(fen).materialKey;
}

