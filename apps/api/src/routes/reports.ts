import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import PDFDocument from "pdfkit";
import { requireUser } from "../auth.js";
import { normalizeFen } from "../chess/fen.js";

const ScopeSchema = z
  .object({
    savedFilterId: z.number().int().positive().optional(),
    collectionId: z.number().int().positive().optional(),
    title: z.string().trim().min(1).max(255).optional(),
  })
  .refine(
    (value) =>
      (value.savedFilterId !== undefined ? 1 : 0) + (value.collectionId !== undefined ? 1 : 0) === 1,
    { message: "Exactly one of savedFilterId or collectionId is required" }
  );

const ReportFilterSchema = z.object({
  player: z.string().trim().optional(),
  eco: z.string().trim().optional(),
  openingPrefix: z.string().trim().optional(),
  result: z.string().trim().optional(),
  timeControl: z.string().trim().optional(),
  event: z.string().trim().optional(),
  site: z.string().trim().optional(),
  rated: z.enum(["true", "false"]).optional(),
  fromDate: z.string().date().optional(),
  toDate: z.string().date().optional(),
  whiteEloMin: z.coerce.number().int().min(1).max(4000).optional(),
  whiteEloMax: z.coerce.number().int().min(1).max(4000).optional(),
  blackEloMin: z.coerce.number().int().min(1).max(4000).optional(),
  blackEloMax: z.coerce.number().int().min(1).max(4000).optional(),
  avgEloMin: z.coerce.number().int().min(1).max(4000).optional(),
  avgEloMax: z.coerce.number().int().min(1).max(4000).optional(),
  collectionId: z.coerce.number().int().positive().optional(),
  tagId: z.coerce.number().int().positive().optional(),
  positionFen: z.string().trim().optional(),
});

type ReportFilter = z.infer<typeof ReportFilterSchema>;

function toId(value: number | string): number {
  if (typeof value === "number") {
    return value;
  }
  return Number(value);
}

function normalizeValue(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildWhereFromFilter(userId: number, query: ReportFilter): { whereSql: string; params: unknown[] } {
  let normalizedPositionFen: string | null = null;
  if (query.positionFen && query.positionFen.length > 0) {
    normalizedPositionFen = normalizeFen(query.positionFen).fenNorm;
  }

  const whereClauses = ["g.user_id = $1"];
  const params: unknown[] = [userId];

  const addCondition = (clause: string, value: unknown): void => {
    params.push(value);
    whereClauses.push(clause.replace("?", `$${params.length}`));
  };

  if (query.player) {
    const normalized = `%${normalizeValue(query.player)}%`;
    params.push(normalized);
    const placeholder = `$${params.length}`;
    whereClauses.push(`(g.white_norm LIKE ${placeholder} OR g.black_norm LIKE ${placeholder})`);
  }
  if (query.eco) {
    addCondition("g.eco = ?", query.eco);
  }
  if (query.openingPrefix) {
    addCondition("g.eco ILIKE ?", `${query.openingPrefix}%`);
  }
  if (query.result) {
    addCondition("g.result = ?", query.result);
  }
  if (query.timeControl) {
    addCondition("g.time_control = ?", query.timeControl);
  }
  if (query.event) {
    addCondition("g.event_norm LIKE ?", `%${normalizeValue(query.event)}%`);
  }
  if (query.site) {
    addCondition("g.site ILIKE ?", `%${query.site}%`);
  }
  if (query.rated === "true" || query.rated === "false") {
    addCondition("g.rated = ?", query.rated === "true");
  }
  if (query.fromDate) {
    addCondition("g.played_on >= ?", query.fromDate);
  }
  if (query.toDate) {
    addCondition("g.played_on <= ?", query.toDate);
  }
  if (query.whiteEloMin !== undefined) {
    addCondition("g.white_elo >= ?", query.whiteEloMin);
  }
  if (query.whiteEloMax !== undefined) {
    addCondition("g.white_elo <= ?", query.whiteEloMax);
  }
  if (query.blackEloMin !== undefined) {
    addCondition("g.black_elo >= ?", query.blackEloMin);
  }
  if (query.blackEloMax !== undefined) {
    addCondition("g.black_elo <= ?", query.blackEloMax);
  }
  if (query.avgEloMin !== undefined) {
    addCondition("((g.white_elo + g.black_elo) / 2.0) >= ?", query.avgEloMin);
  }
  if (query.avgEloMax !== undefined) {
    addCondition("((g.white_elo + g.black_elo) / 2.0) <= ?", query.avgEloMax);
  }
  if (query.collectionId !== undefined) {
    addCondition(
      `EXISTS (
        SELECT 1
        FROM collection_games cg
        WHERE cg.user_id = $1
          AND cg.collection_id = ?
          AND cg.game_id = g.id
      )`,
      query.collectionId
    );
  }
  if (query.tagId !== undefined) {
    addCondition(
      `EXISTS (
        SELECT 1
        FROM game_tags gt
        WHERE gt.user_id = $1
          AND gt.tag_id = ?
          AND gt.game_id = g.id
      )`,
      query.tagId
    );
  }
  if (normalizedPositionFen) {
    addCondition(
      `EXISTS (
        SELECT 1
        FROM game_positions gp
        WHERE gp.user_id = $1
          AND gp.game_id = g.id
          AND gp.fen_norm = ?
      )`,
      normalizedPositionFen
    );
  }

  return {
    whereSql: whereClauses.join(" AND "),
    params,
  };
}

async function resolveScope(pool: Pool, userId: number, scope: z.infer<typeof ScopeSchema>) {
  if (scope.savedFilterId !== undefined) {
    const result = await pool.query<{
      id: number | string;
      name: string;
      filter_query: Record<string, unknown>;
    }>(
      `SELECT id, name, filter_query
       FROM saved_filters
       WHERE id = $1 AND user_id = $2`,
      [scope.savedFilterId, userId]
    );
    if (!result.rowCount) {
      throw new Error("Saved filter not found");
    }

    return {
      kind: "saved-filter" as const,
      id: toId(result.rows[0].id),
      name: result.rows[0].name,
      title: scope.title ?? result.rows[0].name,
      query: ReportFilterSchema.parse(result.rows[0].filter_query ?? {}),
    };
  }

  const result = await pool.query<{
    id: number | string;
    name: string;
    description: string | null;
  }>(
    `SELECT id, name, description
     FROM collections
     WHERE id = $1 AND user_id = $2`,
    [scope.collectionId, userId]
  );
  if (!result.rowCount) {
    throw new Error("Collection not found");
  }

  return {
    kind: "collection" as const,
    id: toId(result.rows[0].id),
    name: result.rows[0].name,
    title: scope.title ?? result.rows[0].name,
    description: result.rows[0].description,
    query: ReportFilterSchema.parse({ collectionId: scope.collectionId }),
  };
}

async function buildPrepReport(pool: Pool, userId: number, scope: z.infer<typeof ScopeSchema>) {
  const resolved = await resolveScope(pool, userId, scope);
  const { whereSql, params } = buildWhereFromFilter(userId, resolved.query);

  const summary = await pool.query<{
    total_games: string;
    white_wins: string;
    black_wins: string;
    draws: string;
    avg_white_elo: string | null;
    avg_black_elo: string | null;
    earliest_date: string | null;
    latest_date: string | null;
  }>(
    `SELECT
      COUNT(*)::text AS total_games,
      COUNT(*) FILTER (WHERE g.result = '1-0')::text AS white_wins,
      COUNT(*) FILTER (WHERE g.result = '0-1')::text AS black_wins,
      COUNT(*) FILTER (WHERE g.result = '1/2-1/2')::text AS draws,
      ROUND(AVG(g.white_elo)::numeric, 0)::text AS avg_white_elo,
      ROUND(AVG(g.black_elo)::numeric, 0)::text AS avg_black_elo,
      MIN(g.played_on)::text AS earliest_date,
      MAX(g.played_on)::text AS latest_date
     FROM games g
     WHERE ${whereSql}`,
    params
  );

  const openings = await pool.query<{
    eco: string | null;
    games: string;
    white_wins: string;
    black_wins: string;
    draws: string;
  }>(
    `SELECT
      g.eco,
      COUNT(*)::text AS games,
      COUNT(*) FILTER (WHERE g.result = '1-0')::text AS white_wins,
      COUNT(*) FILTER (WHERE g.result = '0-1')::text AS black_wins,
      COUNT(*) FILTER (WHERE g.result = '1/2-1/2')::text AS draws
     FROM games g
     WHERE ${whereSql}
     GROUP BY g.eco
     ORDER BY COUNT(*) DESC, g.eco ASC NULLS LAST
     LIMIT 12`,
    params
  );

  const sideResults = await pool.query<{
    side: string;
    games: string;
    wins: string;
    losses: string;
    draws: string;
  }>(
    `SELECT
      side,
      COUNT(*)::text AS games,
      COUNT(*) FILTER (WHERE result = win_result)::text AS wins,
      COUNT(*) FILTER (WHERE result = loss_result)::text AS losses,
      COUNT(*) FILTER (WHERE result = '1/2-1/2')::text AS draws
     FROM (
       SELECT g.result, 'white'::text AS side, '1-0'::text AS win_result, '0-1'::text AS loss_result
       FROM games g
       WHERE ${whereSql}
       UNION ALL
       SELECT g.result, 'black'::text AS side, '0-1'::text AS win_result, '1-0'::text AS loss_result
       FROM games g
       WHERE ${whereSql}
     ) sides
     GROUP BY side
     ORDER BY side ASC`,
    params
  );

  const modelGames = await pool.query<{
    id: number | string;
    white: string;
    black: string;
    result: string;
    eco: string | null;
    played_on: string | null;
    avg_elo: string | null;
  }>(
    `SELECT
      g.id,
      g.white,
      g.black,
      g.result,
      g.eco,
      g.played_on::text,
      ROUND(((COALESCE(g.white_elo, 0) + COALESCE(g.black_elo, 0)) / NULLIF((CASE WHEN g.white_elo IS NOT NULL THEN 1 ELSE 0 END + CASE WHEN g.black_elo IS NOT NULL THEN 1 ELSE 0 END), 0))::numeric, 0)::text AS avg_elo
     FROM games g
     WHERE ${whereSql}
     ORDER BY avg_elo DESC NULLS LAST, g.played_on DESC NULLS LAST, g.id DESC
     LIMIT 10`,
    params
  );

  const criticalPositions = await pool.query<{
    fen_norm: string;
    appearances: string;
    game_count: string;
    next_moves: string[] | null;
  }>(
    `SELECT
      gp.fen_norm,
      COUNT(*)::text AS appearances,
      COUNT(DISTINCT gp.game_id)::text AS game_count,
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT gp.next_move_uci ORDER BY gp.next_move_uci), NULL)[1:4] AS next_moves
     FROM game_positions gp
     JOIN games g ON g.id = gp.game_id
     WHERE ${whereSql}
     GROUP BY gp.fen_norm
     HAVING COUNT(*) >= 2
     ORDER BY COUNT(*) DESC, COUNT(DISTINCT gp.game_id) DESC
     LIMIT 10`,
    params
  );

  const engineLines = await pool.query<{
    id: number | string;
    game_id: number | string;
    ply: number;
    white: string;
    black: string;
    engine: string;
    depth: number | null;
    multipv: number | null;
    eval_cp: number | null;
    eval_mate: number | null;
    pv_san: string[] | null;
    pv_uci: string[] | null;
    source: string;
    created_at: Date;
  }>(
    `SELECT
      el.id,
      el.game_id,
      el.ply,
      g.white,
      g.black,
      el.engine,
      el.depth,
      el.multipv,
      el.eval_cp,
      el.eval_mate,
      el.pv_san,
      el.pv_uci,
      el.source,
      el.created_at
     FROM engine_lines el
     JOIN games g ON g.id = el.game_id
     WHERE ${whereSql}
     ORDER BY el.depth DESC NULLS LAST, el.created_at DESC
     LIMIT 12`,
    params
  );

  const summaryRow = summary.rows[0];
  return {
    scope: {
      kind: resolved.kind,
      id: resolved.id,
      name: resolved.name,
      title: resolved.title,
    },
    generatedAt: new Date().toISOString(),
    summary: {
      totalGames: Number(summaryRow.total_games),
      whiteWins: Number(summaryRow.white_wins),
      blackWins: Number(summaryRow.black_wins),
      draws: Number(summaryRow.draws),
      avgWhiteElo: summaryRow.avg_white_elo ? Number(summaryRow.avg_white_elo) : null,
      avgBlackElo: summaryRow.avg_black_elo ? Number(summaryRow.avg_black_elo) : null,
      earliestDate: summaryRow.earliest_date,
      latestDate: summaryRow.latest_date,
    },
    openings: openings.rows.map((row) => ({
      eco: row.eco,
      games: Number(row.games),
      whiteWins: Number(row.white_wins),
      blackWins: Number(row.black_wins),
      draws: Number(row.draws),
    })),
    resultsBySide: sideResults.rows.map((row) => ({
      side: row.side,
      games: Number(row.games),
      wins: Number(row.wins),
      losses: Number(row.losses),
      draws: Number(row.draws),
    })),
    modelGames: modelGames.rows.map((row) => ({
      id: toId(row.id),
      white: row.white,
      black: row.black,
      result: row.result,
      eco: row.eco,
      date: row.played_on,
      avgElo: row.avg_elo ? Number(row.avg_elo) : null,
    })),
    criticalPositions: criticalPositions.rows.map((row) => ({
      fen: row.fen_norm,
      appearances: Number(row.appearances),
      gameCount: Number(row.game_count),
      nextMoves: row.next_moves ?? [],
    })),
    engineLines: engineLines.rows.map((row) => ({
      id: toId(row.id),
      gameId: toId(row.game_id),
      ply: row.ply,
      players: `${row.white} vs ${row.black}`,
      engine: row.engine,
      depth: row.depth,
      multipv: row.multipv,
      evalCp: row.eval_cp,
      evalMate: row.eval_mate,
      pv: row.pv_san?.length ? row.pv_san.join(" ") : (row.pv_uci ?? []).join(" "),
      source: row.source,
      createdAt: row.created_at.toISOString(),
    })),
    query: resolved.query,
  };
}

function renderHtml(report: Awaited<ReturnType<typeof buildPrepReport>>): string {
  const openingsRows = report.openings
    .map(
      (row) =>
        `<tr><td>${escapeHtml(row.eco ?? "-")}</td><td>${row.games}</td><td>${row.whiteWins}</td><td>${row.blackWins}</td><td>${row.draws}</td></tr>`
    )
    .join("");
  const resultsRows = report.resultsBySide
    .map(
      (row) =>
        `<tr><td>${escapeHtml(row.side)}</td><td>${row.games}</td><td>${row.wins}</td><td>${row.losses}</td><td>${row.draws}</td></tr>`
    )
    .join("");
  const modelGameRows = report.modelGames
    .map(
      (row) =>
        `<tr><td>${row.id}</td><td>${escapeHtml(row.white)} vs ${escapeHtml(row.black)}</td><td>${escapeHtml(row.result)}</td><td>${escapeHtml(row.eco ?? "-")}</td><td>${escapeHtml(row.date ?? "-")}</td><td>${row.avgElo ?? "-"}</td></tr>`
    )
    .join("");
  const criticalPositionRows = report.criticalPositions
    .map(
      (row) =>
        `<tr><td><code>${escapeHtml(row.fen)}</code></td><td>${row.appearances}</td><td>${row.gameCount}</td><td>${escapeHtml(row.nextMoves.join(", ") || "-")}</td></tr>`
    )
    .join("");
  const engineLineRows = report.engineLines
    .map(
      (row) =>
        `<tr><td>${row.gameId}</td><td>${escapeHtml(row.players)}</td><td>${row.ply}</td><td>${escapeHtml(row.engine)}</td><td>${row.depth ?? "-"}</td><td>${row.multipv ?? "-"}</td><td>${row.evalMate !== null ? `#${row.evalMate}` : row.evalCp !== null ? (row.evalCp / 100).toFixed(2) : "-"}</td><td>${escapeHtml(row.pv || "-")}</td><td>${escapeHtml(row.source)}</td></tr>`
    )
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(report.scope.title)} Prep Report</title>
    <style>
      :root { color-scheme: light; }
      body { font-family: Georgia, "Times New Roman", serif; margin: 32px; color: #1d2a24; background: #f6f1e8; }
      h1, h2 { margin: 0 0 12px; }
      h1 { font-size: 2rem; }
      h2 { margin-top: 28px; border-top: 1px solid #c8ba9a; padding-top: 16px; }
      p, li { line-height: 1.5; }
      table { width: 100%; border-collapse: collapse; margin-top: 12px; background: #fffaf1; }
      th, td { border: 1px solid #d7c8a5; padding: 8px 10px; text-align: left; vertical-align: top; }
      th { background: #efe2be; }
      .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
      .summary-card { background: #fffaf1; border: 1px solid #d7c8a5; padding: 12px; }
      code { font-family: "SFMono-Regular", Consolas, monospace; font-size: 0.9em; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(report.scope.title)} Prep Report</h1>
    <p>Generated ${escapeHtml(new Date(report.generatedAt).toLocaleString())}</p>
    <div class="summary-grid">
      <div class="summary-card"><strong>Games</strong><div>${report.summary.totalGames}</div></div>
      <div class="summary-card"><strong>White Wins</strong><div>${report.summary.whiteWins}</div></div>
      <div class="summary-card"><strong>Black Wins</strong><div>${report.summary.blackWins}</div></div>
      <div class="summary-card"><strong>Draws</strong><div>${report.summary.draws}</div></div>
      <div class="summary-card"><strong>Avg White Elo</strong><div>${report.summary.avgWhiteElo ?? "-"}</div></div>
      <div class="summary-card"><strong>Avg Black Elo</strong><div>${report.summary.avgBlackElo ?? "-"}</div></div>
    </div>
    <h2>Common Openings</h2>
    <table><thead><tr><th>ECO</th><th>Games</th><th>White Wins</th><th>Black Wins</th><th>Draws</th></tr></thead><tbody>${openingsRows || '<tr><td colspan="5">No openings matched.</td></tr>'}</tbody></table>
    <h2>Results By Side</h2>
    <table><thead><tr><th>Side</th><th>Games</th><th>Wins</th><th>Losses</th><th>Draws</th></tr></thead><tbody>${resultsRows || '<tr><td colspan="5">No side data available.</td></tr>'}</tbody></table>
    <h2>Model Games</h2>
    <table><thead><tr><th>ID</th><th>Players</th><th>Result</th><th>ECO</th><th>Date</th><th>Avg Elo</th></tr></thead><tbody>${modelGameRows || '<tr><td colspan="6">No games matched.</td></tr>'}</tbody></table>
    <h2>Critical Positions</h2>
    <table><thead><tr><th>FEN</th><th>Appearances</th><th>Games</th><th>Next Moves</th></tr></thead><tbody>${criticalPositionRows || '<tr><td colspan="4">No repeated positions matched.</td></tr>'}</tbody></table>
    <h2>Stored Engine Lines</h2>
    <table><thead><tr><th>Game</th><th>Players</th><th>Ply</th><th>Engine</th><th>Depth</th><th>MultiPV</th><th>Eval</th><th>PV</th><th>Source</th></tr></thead><tbody>${engineLineRows || '<tr><td colspan="9">No stored engine lines matched.</td></tr>'}</tbody></table>
  </body>
</html>`;
}

async function renderPdf(report: Awaited<ReturnType<typeof buildPrepReport>>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margin: 42,
      info: {
        Title: `${report.scope.title} Prep Report`,
        Author: "Chess DB",
      },
    });
    const chunks: Buffer[] = [];

    const pushLine = (text: string, options: { indent?: number; continued?: boolean } = {}): void => {
      doc.text(text, {
        indent: options.indent ?? 0,
        continued: options.continued ?? false,
      });
    };

    const ensureRoom = (height = 80): void => {
      if (doc.y > doc.page.height - doc.page.margins.bottom - height) {
        doc.addPage();
      }
    };

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.font("Helvetica-Bold").fontSize(20).text(`${report.scope.title} Prep Report`);
    doc.moveDown(0.2);
    doc.font("Helvetica").fontSize(10).fillColor("#555555").text(`Generated ${new Date(report.generatedAt).toLocaleString()}`);
    doc.fillColor("black");
    doc.moveDown();

    doc.font("Helvetica-Bold").fontSize(14).text("Summary");
    doc.font("Helvetica").fontSize(11);
    pushLine(`Games: ${report.summary.totalGames}`);
    pushLine(`White wins: ${report.summary.whiteWins}`);
    pushLine(`Black wins: ${report.summary.blackWins}`);
    pushLine(`Draws: ${report.summary.draws}`);
    pushLine(`Average white Elo: ${report.summary.avgWhiteElo ?? "-"}`);
    pushLine(`Average black Elo: ${report.summary.avgBlackElo ?? "-"}`);
    pushLine(`Date span: ${report.summary.earliestDate ?? "-"} to ${report.summary.latestDate ?? "-"}`);
    doc.moveDown();

    const section = (title: string, rows: string[]): void => {
      ensureRoom();
      doc.font("Helvetica-Bold").fontSize(14).text(title);
      doc.font("Helvetica").fontSize(10);
      if (rows.length === 0) {
        doc.text("No entries.");
        doc.moveDown();
        return;
      }
      for (const row of rows) {
        ensureRoom(36);
        doc.text(`- ${row}`);
      }
      doc.moveDown();
    };

    section(
      "Common Openings",
      report.openings.map(
        (row) => `${row.eco ?? "-"}: ${row.games} games, W ${row.whiteWins}, D ${row.draws}, L ${row.blackWins}`
      )
    );
    section(
      "Results By Side",
      report.resultsBySide.map(
        (row) => `${row.side}: ${row.games} games, ${row.wins} wins, ${row.losses} losses, ${row.draws} draws`
      )
    );
    section(
      "Model Games",
      report.modelGames.map(
        (row) => `#${row.id} ${row.white} vs ${row.black} (${row.result}) ${row.eco ?? "-"} ${row.date ?? "-"} avg Elo ${row.avgElo ?? "-"}`
      )
    );
    section(
      "Critical Positions",
      report.criticalPositions.map(
        (row) => `${row.fen} | appearances ${row.appearances} | games ${row.gameCount} | next moves ${row.nextMoves.join(", ") || "-"}`
      )
    );
    section(
      "Stored Engine Lines",
      report.engineLines.map(
        (row) =>
          `Game ${row.gameId}, ply ${row.ply}, ${row.players}, ${row.engine} depth ${row.depth ?? "-"} MPV ${row.multipv ?? "-"} eval ${
            row.evalMate !== null ? `#${row.evalMate}` : row.evalCp !== null ? (row.evalCp / 100).toFixed(2) : "-"
          } | ${row.pv || "-"}`
      )
    );

    doc.end();
  });
}

export async function registerReportRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  app.post("/api/reports/prep", { preHandler: requireUser }, async (request, reply) => {
    const parsed = ScopeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid request body",
        details: parsed.error.flatten(),
      });
    }

    try {
      return await buildPrepReport(pool, request.user!.id, parsed.data);
    } catch (error) {
      const message = String(error);
      if (message.includes("not found")) {
        return reply.status(404).send({ error: message });
      }
      request.log.error(error);
      return reply.status(500).send({ error: "Failed to build prep report" });
    }
  });

  app.post("/api/reports/prep/html", { preHandler: requireUser }, async (request, reply) => {
    const parsed = ScopeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid request body",
        details: parsed.error.flatten(),
      });
    }

    try {
      const report = await buildPrepReport(pool, request.user!.id, parsed.data);
      reply.header(
        "content-disposition",
        `attachment; filename="${report.scope.title.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase()}-prep-report.html"`
      );
      reply.type("text/html; charset=utf-8");
      return renderHtml(report);
    } catch (error) {
      const message = String(error);
      if (message.includes("not found")) {
        return reply.status(404).send({ error: message });
      }
      request.log.error(error);
      return reply.status(500).send({ error: "Failed to export prep report" });
    }
  });

  app.post("/api/reports/prep/pdf", { preHandler: requireUser }, async (request, reply) => {
    const parsed = ScopeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid request body",
        details: parsed.error.flatten(),
      });
    }

    try {
      const report = await buildPrepReport(pool, request.user!.id, parsed.data);
      const pdf = await renderPdf(report);
      reply.header(
        "content-disposition",
        `attachment; filename="${report.scope.title.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase()}-prep-report.pdf"`
      );
      reply.type("application/pdf");
      return reply.send(pdf);
    } catch (error) {
      const message = String(error);
      if (message.includes("not found")) {
        return reply.status(404).send({ error: message });
      }
      request.log.error(error);
      return reply.status(500).send({ error: "Failed to export prep report PDF" });
    }
  });
}
