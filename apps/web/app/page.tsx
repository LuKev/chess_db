"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type User = {
  id: number;
  email: string;
  createdAt: string;
};

type GameRow = {
  id: number;
  white: string;
  black: string;
  result: string;
  date: string | null;
  event: string | null;
  eco: string | null;
  plyCount: number | null;
  timeControl: string | null;
};

type GamesResponse = {
  page: number;
  pageSize: number;
  total: number;
  items: GameRow[];
};

type ImportJob = {
  id: number;
  status: string;
  totals: {
    parsed: number;
    inserted: number;
    duplicates: number;
    parseErrors: number;
  };
  createdAt: string;
  updatedAt: string;
};

type ImportListResponse = {
  page: number;
  pageSize: number;
  total: number;
  items: ImportJob[];
};

type SavedFilter = {
  id: number;
  name: string;
  query: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type AnalysisResponse = {
  id: number;
  status: string;
  fen: string;
  limits: {
    depth: number | null;
    nodes: number | null;
    timeMs: number | null;
  };
  result: {
    bestMove: string | null;
    pv: string | null;
    evalCp: number | null;
    evalMate: number | null;
  };
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

type ExportJob = {
  id: number;
  status: string;
  mode: string;
  outputObjectKey: string | null;
  exportedGames: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
}

function toQuery(params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      query.set(key, String(value));
    }
  }

  const result = query.toString();
  return result ? `?${result}` : "";
}

async function fetchJson<T>(
  path: string,
  init: RequestInit = {},
  options: { jsonBody?: boolean } = { jsonBody: true }
): Promise<{ status: number; data: T | { error?: string } }> {
  const headers = new Headers(init.headers);

  if (options.jsonBody && !(init.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    credentials: "include",
    headers,
  });

  let data: T | { error?: string };
  try {
    data = (await response.json()) as T | { error?: string };
  } catch {
    data = {};
  }

  return { status: response.status, data };
}

export default function Home() {
  const [email, setEmail] = useState("player@example.com");
  const [password, setPassword] = useState("password123");
  const [user, setUser] = useState<User | null>(null);
  const [authMessage, setAuthMessage] = useState("Checking session...");

  const [player, setPlayer] = useState("");
  const [eco, setEco] = useState("");
  const [result, setResult] = useState("");
  const [timeControl, setTimeControl] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sort, setSort] = useState("date_desc");
  const [page, setPage] = useState(1);

  const [games, setGames] = useState<GamesResponse | null>(null);
  const [tableStatus, setTableStatus] = useState("Sign in to load games");

  const [importFile, setImportFile] = useState<File | null>(null);
  const [importStatus, setImportStatus] = useState("Sign in to import PGN files");
  const [imports, setImports] = useState<ImportJob[]>([]);

  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
  const [filterName, setFilterName] = useState("");
  const [filterMessage, setFilterMessage] = useState("Sign in to manage saved filters");
  const [analysisFen, setAnalysisFen] = useState(
    "rn1qkbnr/pppb1ppp/3p4/4p3/3PP3/2N2N2/PPP2PPP/R1BQKB1R w KQkq - 0 5"
  );
  const [analysisDepth, setAnalysisDepth] = useState(12);
  const [analysisStatus, setAnalysisStatus] = useState("Sign in to run analysis");
  const [activeAnalysis, setActiveAnalysis] = useState<AnalysisResponse | null>(null);
  const [exportJobs, setExportJobs] = useState<ExportJob[]>([]);
  const [exportStatus, setExportStatus] = useState("Sign in to create exports");

  const pageCount = useMemo(() => {
    if (!games) {
      return 1;
    }
    return Math.max(1, Math.ceil(games.total / games.pageSize));
  }, [games]);

  async function refreshSession(): Promise<void> {
    const response = await fetchJson<{ user: User }>("/api/auth/me", {
      method: "GET",
    });

    if (response.status === 200 && "user" in response.data) {
      setUser(response.data.user);
      setAuthMessage(`Signed in as ${response.data.user.email}`);
      return;
    }

    setUser(null);
    setGames(null);
    setImports([]);
    setExportJobs([]);
    setSavedFilters([]);
    setAuthMessage("Not signed in");
  }

  async function refreshGames(nextPage = page): Promise<void> {
    if (!user) {
      setGames(null);
      setTableStatus("Sign in to load games");
      return;
    }

    const query = toQuery({
      page: nextPage,
      pageSize: 25,
      sort,
      player,
      eco,
      result,
      timeControl,
      fromDate,
      toDate,
    });

    setTableStatus("Loading games...");
    const response = await fetchJson<GamesResponse>(`/api/games${query}`, {
      method: "GET",
    });

    if (response.status !== 200 || !("items" in response.data)) {
      setGames(null);
      setTableStatus(
        `Failed to load games${"error" in response.data && response.data.error ? `: ${response.data.error}` : ""}`
      );
      return;
    }

    setGames(response.data);
    setTableStatus(
      response.data.total > 0
        ? `${response.data.total} game(s) matched`
        : "No games match current filters"
    );
  }

  async function refreshImports(): Promise<void> {
    if (!user) {
      setImports([]);
      setImportStatus("Sign in to import PGN files");
      return;
    }

    const response = await fetchJson<ImportListResponse>("/api/imports?page=1&pageSize=15", {
      method: "GET",
    });

    if (response.status !== 200 || !("items" in response.data)) {
      setImportStatus(
        `Failed to load imports${"error" in response.data && response.data.error ? `: ${response.data.error}` : ""}`
      );
      return;
    }

    setImports(response.data.items);
    setImportStatus(
      response.data.items.length > 0
        ? `${response.data.total} import job(s)`
        : "No import jobs yet"
    );
  }

  async function refreshSavedFilters(): Promise<void> {
    if (!user) {
      setSavedFilters([]);
      setFilterMessage("Sign in to manage saved filters");
      return;
    }

    const response = await fetchJson<{ items: SavedFilter[] }>("/api/filters", {
      method: "GET",
    });

    if (response.status !== 200 || !("items" in response.data)) {
      setFilterMessage(
        `Failed to load filters${"error" in response.data && response.data.error ? `: ${response.data.error}` : ""}`
      );
      return;
    }

    setSavedFilters(response.data.items);
    setFilterMessage(
      response.data.items.length > 0 ? `${response.data.items.length} saved filter(s)` : "No saved filters"
    );
  }

  async function refreshExports(): Promise<void> {
    if (!user) {
      setExportJobs([]);
      setExportStatus("Sign in to create exports");
      return;
    }

    const response = await fetchJson<{ items: ExportJob[] }>("/api/exports", {
      method: "GET",
    });

    if (response.status !== 200 || !("items" in response.data)) {
      setExportStatus(
        `Failed to load exports${"error" in response.data && response.data.error ? `: ${response.data.error}` : ""}`
      );
      return;
    }

    setExportJobs(response.data.items);
    setExportStatus(
      response.data.items.length > 0 ? `${response.data.items.length} export job(s)` : "No export jobs yet"
    );
  }

  async function submitAuth(mode: "register" | "login"): Promise<void> {
    const endpoint = mode === "register" ? "/api/auth/register" : "/api/auth/login";
    const response = await fetchJson<{ user: User }>(endpoint, {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });

    if (response.status >= 400) {
      setAuthMessage(
        `Auth failed${"error" in response.data && response.data.error ? `: ${response.data.error}` : ""}`
      );
      return;
    }

    await refreshSession();
    setPage(1);
    await Promise.all([refreshGames(1), refreshImports(), refreshSavedFilters(), refreshExports()]);
  }

  async function logout(): Promise<void> {
    await fetchJson<{ ok: boolean }>("/api/auth/logout", {
      method: "POST",
    });

    await refreshSession();
  }

  async function createSampleGame(): Promise<void> {
    if (!user) {
      return;
    }

    const sampleHash = `sample-${Date.now()}`;
    const response = await fetchJson<{ id: number }>("/api/games", {
      method: "POST",
      body: JSON.stringify({
        white: "Kasparov, Garry",
        black: "Karpov, Anatoly",
        result: "1-0",
        eco: "B44",
        event: "World Championship",
        site: "Moscow",
        date: "1985-10-15",
        timeControl: "40/7200:20/3600",
        plyCount: 58,
        startingFen: "startpos",
        movesHash: sampleHash,
        pgn: "[Event \"World Championship\"]\n\n1. e4 c5 2. Nf3 e6 3. d4 cxd4 1-0",
        moveTree: {
          mainline: ["e4", "c5", "Nf3", "e6", "d4", "cxd4"],
        },
      }),
    });

    if (response.status >= 400) {
      setTableStatus(
        `Failed to insert sample game${"error" in response.data && response.data.error ? `: ${response.data.error}` : ""}`
      );
      return;
    }

    await refreshGames(1);
    setPage(1);
  }

  async function uploadImportFile(): Promise<void> {
    if (!user || !importFile) {
      return;
    }

    const form = new FormData();
    form.append("file", importFile);

    setImportStatus("Uploading and queueing import job...");
    const response = await fetchJson<{ id: number }>("/api/imports", {
      method: "POST",
      body: form,
    }, { jsonBody: false });

    if (response.status !== 201) {
      setImportStatus(
        `Import upload failed${"error" in response.data && response.data.error ? `: ${response.data.error}` : ""}`
      );
      return;
    }

    setImportStatus(`Queued import job #${"id" in response.data ? response.data.id : "?"}`);
    setImportFile(null);
    await refreshImports();
  }

  async function saveCurrentFilter(): Promise<void> {
    if (!user || !filterName.trim()) {
      return;
    }

    const response = await fetchJson<{ id: number }>("/api/filters", {
      method: "POST",
      body: JSON.stringify({
        name: filterName.trim(),
        query: {
          player,
          eco,
          result,
          timeControl,
          fromDate,
          toDate,
          sort,
        },
      }),
    });

    if (response.status !== 201) {
      setFilterMessage(
        `Failed to save filter${"error" in response.data && response.data.error ? `: ${response.data.error}` : ""}`
      );
      return;
    }

    setFilterName("");
    await refreshSavedFilters();
  }

  async function deleteFilter(id: number): Promise<void> {
    if (!user) {
      return;
    }

    const response = await fetchJson<{ error?: string }>(`/api/filters/${id}`, {
      method: "DELETE",
    });

    if (response.status !== 204) {
      setFilterMessage(
        `Failed to delete filter${"error" in response.data && response.data.error ? `: ${response.data.error}` : ""}`
      );
      return;
    }

    await refreshSavedFilters();
  }

  async function refreshAnalysis(analysisId: number): Promise<void> {
    const response = await fetchJson<AnalysisResponse>(`/api/analysis/${analysisId}`, {
      method: "GET",
    });

    if (response.status !== 200 || !("status" in response.data)) {
      setAnalysisStatus(
        `Failed to load analysis${"error" in response.data && response.data.error ? `: ${response.data.error}` : ""}`
      );
      return;
    }

    setActiveAnalysis(response.data);
    setAnalysisStatus(`Analysis #${response.data.id}: ${response.data.status}`);
  }

  async function createAnalysis(): Promise<void> {
    if (!user) {
      return;
    }

    const response = await fetchJson<{ id: number; status: string }>("/api/analysis", {
      method: "POST",
      body: JSON.stringify({
        fen: analysisFen,
        depth: analysisDepth,
      }),
    });

    if (response.status !== 201 || !("id" in response.data)) {
      setAnalysisStatus(
        `Failed to create analysis${"error" in response.data && response.data.error ? `: ${response.data.error}` : ""}`
      );
      return;
    }

    setAnalysisStatus(`Queued analysis #${response.data.id}`);
    await refreshAnalysis(response.data.id);
  }

  async function cancelAnalysis(): Promise<void> {
    if (!activeAnalysis) {
      return;
    }

    const response = await fetchJson<{ status: string }>(
      `/api/analysis/${activeAnalysis.id}/cancel`,
      {
        method: "POST",
      }
    );

    if (response.status !== 200) {
      setAnalysisStatus(
        `Failed to cancel analysis${"error" in response.data && response.data.error ? `: ${response.data.error}` : ""}`
      );
      return;
    }

    setAnalysisStatus(`Analysis #${activeAnalysis.id}: cancelled`);
    await refreshAnalysis(activeAnalysis.id);
  }

  async function createExportByCurrentFilter(): Promise<void> {
    if (!user) {
      return;
    }

    const response = await fetchJson<{ id: number }>("/api/exports", {
      method: "POST",
      body: JSON.stringify({
        mode: "query",
        query: {
          player,
          eco,
          result,
          timeControl,
          fromDate,
          toDate,
        },
      }),
    });

    if (response.status !== 201 || !("id" in response.data)) {
      setExportStatus(
        `Failed to queue export${"error" in response.data && response.data.error ? `: ${response.data.error}` : ""}`
      );
      return;
    }

    setExportStatus(`Queued export job #${response.data.id}`);
    await refreshExports();
  }

  function applySavedFilter(savedFilter: SavedFilter): void {
    const query = savedFilter.query;

    setPlayer(String(query.player ?? ""));
    setEco(String(query.eco ?? ""));
    setResult(String(query.result ?? ""));
    setTimeControl(String(query.timeControl ?? ""));
    setFromDate(String(query.fromDate ?? ""));
    setToDate(String(query.toDate ?? ""));
    setSort(String(query.sort ?? "date_desc"));
    setPage(1);
    void refreshGames(1);
  }

  function onFilterSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setPage(1);
    void refreshGames(1);
  }

  useEffect(() => {
    void refreshSession();
  }, []);

  useEffect(() => {
    if (!user) {
      return;
    }

    void Promise.all([refreshGames(1), refreshImports(), refreshSavedFilters(), refreshExports()]);
    setPage(1);
  }, [user]);

  useEffect(() => {
    void refreshGames(page);
  }, [sort, page]);

  useEffect(() => {
    if (!user) {
      return;
    }

    const interval = setInterval(() => {
      void refreshImports();
    }, 3000);

    return () => clearInterval(interval);
  }, [user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    const interval = setInterval(() => {
      void refreshExports();
    }, 3000);

    return () => clearInterval(interval);
  }, [user]);

  useEffect(() => {
    if (!user || !activeAnalysis) {
      return;
    }

    if (["completed", "failed", "cancelled"].includes(activeAnalysis.status)) {
      return;
    }

    const interval = setInterval(() => {
      void refreshAnalysis(activeAnalysis.id);
    }, 1500);

    return () => clearInterval(interval);
  }, [user, activeAnalysis]);

  return (
    <main>
      <h1>Chess DB</h1>
      <p className="muted">
        Sprint 1/2 implementation: auth, tenant-safe data model, import queueing, saved filters, and
        indexed game search.
      </p>

      <section className="card">
        <h2>Account</h2>
        <form
          className="auth-grid"
          onSubmit={(event) => {
            event.preventDefault();
            void submitAuth("login");
          }}
        >
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={8}
            />
          </label>
          <div className="button-row">
            <button type="button" onClick={() => void submitAuth("register")}>Register</button>
            <button type="submit">Login</button>
            <button type="button" onClick={() => void logout()}>Logout</button>
          </div>
        </form>
        <p className="muted">{authMessage}</p>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Import Jobs</h2>
          <div className="button-row">
            <input
              type="file"
              accept=".pgn,.pgn.zst"
              onChange={(event) => setImportFile(event.target.files?.[0] ?? null)}
              disabled={!user}
            />
            <button onClick={() => void uploadImportFile()} disabled={!user || !importFile}>
              Upload PGN
            </button>
          </div>
        </div>

        <p className="muted">{importStatus}</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Status</th>
                <th>Parsed</th>
                <th>Inserted</th>
                <th>Duplicates</th>
                <th>Parse Errors</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {imports.map((job) => (
                <tr key={job.id}>
                  <td>{job.id}</td>
                  <td>{job.status}</td>
                  <td>{job.totals.parsed}</td>
                  <td>{job.totals.inserted}</td>
                  <td>{job.totals.duplicates}</td>
                  <td>{job.totals.parseErrors}</td>
                  <td>{new Date(job.updatedAt).toLocaleString()}</td>
                </tr>
              ))}
              {imports.length === 0 ? (
                <tr>
                  <td colSpan={7}>No import jobs</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Exports</h2>
          <button onClick={() => void createExportByCurrentFilter()} disabled={!user}>
            Export Current Filter
          </button>
        </div>
        <p className="muted">{exportStatus}</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Status</th>
                <th>Mode</th>
                <th>Games</th>
                <th>Output Key</th>
              </tr>
            </thead>
            <tbody>
              {exportJobs.map((job) => (
                <tr key={job.id}>
                  <td>{job.id}</td>
                  <td>{job.status}</td>
                  <td>{job.mode}</td>
                  <td>{job.exportedGames}</td>
                  <td>{job.outputObjectKey ?? "-"}</td>
                </tr>
              ))}
              {exportJobs.length === 0 ? (
                <tr>
                  <td colSpan={5}>No export jobs</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Engine Analysis</h2>
          <div className="button-row">
            <button onClick={() => void createAnalysis()} disabled={!user}>
              Analyze Position
            </button>
            <button
              onClick={() => void cancelAnalysis()}
              disabled={!user || !activeAnalysis || activeAnalysis.status !== "running"}
            >
              Cancel
            </button>
          </div>
        </div>
        <div className="analysis-grid">
          <label>
            FEN
            <input
              value={analysisFen}
              onChange={(event) => setAnalysisFen(event.target.value)}
              disabled={!user}
            />
          </label>
          <label>
            Depth
            <input
              type="number"
              min={1}
              max={40}
              value={analysisDepth}
              onChange={(event) => setAnalysisDepth(Number(event.target.value))}
              disabled={!user}
            />
          </label>
        </div>
        <p className="muted">{analysisStatus}</p>
        {activeAnalysis ? (
          <pre>{JSON.stringify(activeAnalysis, null, 2)}</pre>
        ) : null}
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Saved Filters</h2>
        </div>

        <div className="button-row">
          <input
            placeholder="Filter name"
            value={filterName}
            onChange={(event) => setFilterName(event.target.value)}
            disabled={!user}
          />
          <button onClick={() => void saveCurrentFilter()} disabled={!user || !filterName.trim()}>
            Save Current Filter
          </button>
        </div>

        <p className="muted">{filterMessage}</p>

        <div className="saved-filters">
          {savedFilters.map((savedFilter) => (
            <div key={savedFilter.id} className="saved-filter-item">
              <div>
                <strong>{savedFilter.name}</strong>
              </div>
              <div className="button-row">
                <button onClick={() => applySavedFilter(savedFilter)} disabled={!user}>
                  Apply
                </button>
                <button onClick={() => void deleteFilter(savedFilter.id)} disabled={!user}>
                  Delete
                </button>
              </div>
            </div>
          ))}
          {savedFilters.length === 0 ? <p className="muted">No saved filters</p> : null}
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Database Home</h2>
          <button onClick={() => void createSampleGame()} disabled={!user}>
            Insert Sample Game
          </button>
        </div>

        <form className="filters" onSubmit={onFilterSubmit}>
          <input
            placeholder="Player"
            value={player}
            onChange={(event) => setPlayer(event.target.value)}
          />
          <input placeholder="ECO" value={eco} onChange={(event) => setEco(event.target.value)} />
          <input
            placeholder="Result"
            value={result}
            onChange={(event) => setResult(event.target.value)}
          />
          <input
            placeholder="Time control"
            value={timeControl}
            onChange={(event) => setTimeControl(event.target.value)}
          />
          <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
          <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="date_desc">Date desc</option>
            <option value="date_asc">Date asc</option>
            <option value="white">White</option>
            <option value="black">Black</option>
            <option value="eco">ECO</option>
          </select>
          <button type="submit" disabled={!user}>
            Apply Filters
          </button>
        </form>

        <p className="muted">{tableStatus}</p>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>White</th>
                <th>Black</th>
                <th>Result</th>
                <th>Date</th>
                <th>ECO</th>
                <th>Event</th>
                <th>Ply</th>
              </tr>
            </thead>
            <tbody>
              {games?.items.map((game) => (
                <tr key={game.id}>
                  <td>{game.id}</td>
                  <td>{game.white}</td>
                  <td>{game.black}</td>
                  <td>{game.result}</td>
                  <td>{game.date ?? "-"}</td>
                  <td>{game.eco ?? "-"}</td>
                  <td>{game.event ?? "-"}</td>
                  <td>{game.plyCount ?? "-"}</td>
                </tr>
              ))}
              {games && games.items.length === 0 ? (
                <tr>
                  <td colSpan={8}>No rows</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="button-row">
          <button
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={!user || page <= 1}
          >
            Previous
          </button>
          <span>
            Page {page} / {pageCount}
          </span>
          <button
            onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
            disabled={!user || page >= pageCount}
          >
            Next
          </button>
        </div>
      </section>
    </main>
  );
}
