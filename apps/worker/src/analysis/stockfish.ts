import { spawn } from "node:child_process";
import readline from "node:readline";

export type AnalysisLimits = {
  depth: number | null;
  nodes: number | null;
  timeMs: number | null;
};

export type AnalysisLineResult = {
  multipv: number;
  bestMove: string | null;
  pv: string | null;
  evalCp: number | null;
  evalMate: number | null;
};

export type AnalysisRunResult = {
  bestMove: string;
  lines: AnalysisLineResult[];
};

type ParsedInfoLine = {
  multipv: number;
  evalCp: number | null;
  evalMate: number | null;
  pv: string | null;
};

function parseInfoLine(line: string): ParsedInfoLine {
  const cpMatch = line.match(/\bscore\s+cp\s+(-?\d+)/);
  const mateMatch = line.match(/\bscore\s+mate\s+(-?\d+)/);
  const pvMatch = line.match(/\bpv\s+(.+)$/);
  const multipvMatch = line.match(/\bmultipv\s+(\d+)/);

  return {
    multipv: multipvMatch ? Math.max(1, Number(multipvMatch[1])) : 1,
    evalCp: cpMatch ? Number(cpMatch[1]) : null,
    evalMate: mateMatch ? Number(mateMatch[1]) : null,
    pv: pvMatch ? pvMatch[1].trim() : null,
  };
}

function sortedLines(linesByMultiPv: Map<number, ParsedInfoLine>): AnalysisLineResult[] {
  return [...linesByMultiPv.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([multipv, line]) => ({
      multipv,
      bestMove: line.pv ? line.pv.split(/\s+/)[0] ?? null : null,
      pv: line.pv,
      evalCp: line.evalCp,
      evalMate: line.evalMate,
    }));
}

export async function runStockfishAnalysis(params: {
  stockfishBinary: string;
  fen: string;
  engine: string;
  multipv: number;
  limits: AnalysisLimits;
  onCancelPoll: () => Promise<boolean>;
  onInfo: (lines: AnalysisLineResult[]) => Promise<void>;
  cancelPollMs: number;
}): Promise<AnalysisRunResult | { cancelled: true }> {
  const child = spawn(params.stockfishBinary, [], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  const linesByMultiPv = new Map<number, ParsedInfoLine>();
  let resolved = false;

  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });

    const closeAll = (): void => {
      rl.close();
      if (!child.killed) {
        child.kill();
      }
      if (cancelInterval) {
        clearInterval(cancelInterval);
      }
      if (analysisTimeout) {
        clearTimeout(analysisTimeout);
      }
    };

    const writeLine = (command: string): void => {
      child.stdin.write(`${command}\n`);
    };

    const analysisTimeout = setTimeout(() => {
      if (resolved) {
        return;
      }
      resolved = true;
      closeAll();
      reject(new Error("Stockfish analysis timed out"));
    }, 45_000);

    const cancelInterval = setInterval(() => {
      void (async () => {
        const shouldCancel = await params.onCancelPoll();
        if (shouldCancel && !resolved) {
          writeLine("stop");
        }
      })();
    }, params.cancelPollMs);

    rl.on("line", (line) => {
      if (line.startsWith("info ")) {
        const parsed = parseInfoLine(line);
        if (parsed.evalCp !== null || parsed.evalMate !== null || parsed.pv) {
          linesByMultiPv.set(parsed.multipv, parsed);
          void params.onInfo(sortedLines(linesByMultiPv));
        }
      }

      if (line.startsWith("bestmove ")) {
        const bestMove = line.split(/\s+/)[1];

        if (!bestMove || bestMove === "(none)") {
          if (!resolved) {
            resolved = true;
            closeAll();
            resolve({ cancelled: true });
          }
          return;
        }

        if (!resolved) {
          const currentLines = sortedLines(linesByMultiPv);
          const lines =
            currentLines.length > 0
              ? currentLines.map((entry) =>
                  entry.multipv === 1 ? { ...entry, bestMove } : entry
                )
              : [
                  {
                    multipv: 1,
                    bestMove,
                    pv: bestMove,
                    evalCp: null,
                    evalMate: null,
                  },
                ];
          resolved = true;
          closeAll();
          resolve({
            bestMove,
            lines,
          });
        }
      }
    });

    child.stderr.on("data", (chunk) => {
      const value = String(chunk);
      if (value.trim().length > 0 && !resolved) {
        resolved = true;
        closeAll();
        reject(new Error(`Stockfish stderr: ${value.trim()}`));
      }
    });

    child.on("error", (error) => {
      if (!resolved) {
        resolved = true;
        closeAll();
        reject(error);
      }
    });

    child.on("exit", (code) => {
      if (!resolved && code !== 0) {
        resolved = true;
        closeAll();
        reject(new Error(`Stockfish exited with code ${code}`));
      }
    });

    writeLine("uci");
    writeLine(`setoption name MultiPV value ${Math.max(1, params.multipv)}`);
    writeLine("isready");
    writeLine("ucinewgame");
    writeLine(`position fen ${params.fen}`);

    const goParts: string[] = ["go"];
    if (params.limits.depth) {
      goParts.push("depth", String(params.limits.depth));
    }
    if (params.limits.nodes) {
      goParts.push("nodes", String(params.limits.nodes));
    }
    if (params.limits.timeMs) {
      goParts.push("movetime", String(params.limits.timeMs));
    }
    if (goParts.length === 1) {
      goParts.push("depth", "18");
    }

    writeLine(goParts.join(" "));
  });
}
