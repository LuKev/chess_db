import { spawn } from "node:child_process";
import readline from "node:readline";
import type { Pool } from "pg";

type AnalysisLimits = {
  depth: number | null;
  nodes: number | null;
  timeMs: number | null;
};

type AnalysisResult = {
  bestMove: string;
  pv: string | null;
  evalCp: number | null;
  evalMate: number | null;
};

type ProcessAnalysisJobParams = {
  pool: Pool;
  analysisRequestId: number;
  userId: number;
  stockfishBinary: string;
  cancelPollMs: number;
};

function toId(value: number | string): number {
  if (typeof value === "number") {
    return value;
  }
  return Number(value);
}

function parseScoreFromInfo(line: string): {
  evalCp: number | null;
  evalMate: number | null;
  pv: string | null;
} {
  const cpMatch = line.match(/\bscore\s+cp\s+(-?\d+)/);
  const mateMatch = line.match(/\bscore\s+mate\s+(-?\d+)/);
  const pvMatch = line.match(/\bpv\s+(.+)$/);

  return {
    evalCp: cpMatch ? Number(cpMatch[1]) : null,
    evalMate: mateMatch ? Number(mateMatch[1]) : null,
    pv: pvMatch ? pvMatch[1].trim() : null,
  };
}

async function isCancelRequested(pool: Pool, analysisRequestId: number): Promise<boolean> {
  const row = await pool.query<{ cancel_requested: boolean; status: string }>(
    `SELECT cancel_requested, status
     FROM engine_requests
     WHERE id = $1`,
    [analysisRequestId]
  );

  if (!row.rowCount) {
    return true;
  }

  return row.rows[0].cancel_requested || row.rows[0].status === "cancelled";
}

async function runStockfishAnalysis(params: {
  stockfishBinary: string;
  fen: string;
  limits: AnalysisLimits;
  onCancelPoll: () => Promise<boolean>;
  cancelPollMs: number;
}): Promise<AnalysisResult | { cancelled: true }> {
  const child = spawn(params.stockfishBinary, [], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  let lastInfo: { evalCp: number | null; evalMate: number | null; pv: string | null } = {
    evalCp: null,
    evalMate: null,
    pv: null,
  };

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
        const parsed = parseScoreFromInfo(line);
        if (parsed.evalCp !== null || parsed.evalMate !== null || parsed.pv) {
          lastInfo = parsed;
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
          resolved = true;
          closeAll();
          resolve({
            bestMove,
            pv: lastInfo.pv,
            evalCp: lastInfo.evalCp,
            evalMate: lastInfo.evalMate,
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

export async function processAnalysisJob(
  params: ProcessAnalysisJobParams
): Promise<void> {
  const requestRow = await params.pool.query<{
    id: number | string;
    user_id: number | string;
    status: string;
    cancel_requested: boolean;
    fen: string;
    depth: number | null;
    nodes: number | null;
    time_ms: number | null;
  }>(
    `SELECT
      id,
      user_id,
      status,
      cancel_requested,
      fen,
      depth,
      nodes,
      time_ms
    FROM engine_requests
    WHERE id = $1`,
    [params.analysisRequestId]
  );

  if (!requestRow.rowCount) {
    throw new Error(`Analysis request ${params.analysisRequestId} not found`);
  }

  const request = requestRow.rows[0];
  if (toId(request.user_id) !== params.userId) {
    throw new Error(`Analysis request user mismatch for ${params.analysisRequestId}`);
  }

  if (request.cancel_requested || request.status === "cancelled") {
    await params.pool.query(
      `UPDATE engine_requests
       SET status = 'cancelled',
           updated_at = NOW()
       WHERE id = $1`,
      [params.analysisRequestId]
    );
    return;
  }

  await params.pool.query(
    `UPDATE engine_requests
     SET status = 'running', updated_at = NOW()
     WHERE id = $1`,
    [params.analysisRequestId]
  );

  try {
    const result = await runStockfishAnalysis({
      stockfishBinary: params.stockfishBinary,
      fen: request.fen,
      limits: {
        depth: request.depth,
        nodes: request.nodes,
        timeMs: request.time_ms,
      },
      onCancelPoll: async () => isCancelRequested(params.pool, params.analysisRequestId),
      cancelPollMs: params.cancelPollMs,
    });

    if ("cancelled" in result) {
      await params.pool.query(
        `UPDATE engine_requests
         SET status = 'cancelled',
             updated_at = NOW()
         WHERE id = $1`,
        [params.analysisRequestId]
      );
      return;
    }

    await params.pool.query(
      `UPDATE engine_requests
       SET status = 'completed',
           best_move = $2,
           principal_variation = $3,
           eval_cp = $4,
           eval_mate = $5,
           updated_at = NOW()
       WHERE id = $1`,
      [
        params.analysisRequestId,
        result.bestMove,
        result.pv,
        result.evalCp,
        result.evalMate,
      ]
    );
  } catch (error) {
    await params.pool.query(
      `UPDATE engine_requests
       SET status = 'failed',
           error_message = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [params.analysisRequestId, String(error).slice(0, 1000)]
    );

    throw error;
  }
}
