function getBasePath(): string {
  return process.env.NEXT_PUBLIC_BASE_PATH ?? "";
}

function getApiBaseUrl(): string {
  return process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
}

async function fetchApiHealth(): Promise<{
  ok: boolean;
  status: string;
  details?: unknown;
}> {
  const apiBaseUrl = getApiBaseUrl();
  if (!apiBaseUrl) {
    return { ok: false, status: "API URL not configured" };
  }

  try {
    const res = await fetch(`${apiBaseUrl}/health`, { cache: "no-store" });
    if (!res.ok) {
      return { ok: false, status: `API returned ${res.status}` };
    }
    const data = await res.json();
    return { ok: true, status: "Healthy", details: data };
  } catch (error) {
    return { ok: false, status: "API request failed", details: String(error) };
  }
}

export default async function Home() {
  const basePath = getBasePath() || "/";
  const apiHealth = await fetchApiHealth();

  return (
    <main>
      <h1>Chess DB</h1>
      <p className="muted">
        Starter deployment for a web-based chess database project.
      </p>
      <div className="card">
        <p>
          <strong>Base path:</strong> <code>{basePath}</code>
        </p>
        <p>
          <strong>API status:</strong> {apiHealth.ok ? "ok" : "down"} -{" "}
          {apiHealth.status}
        </p>
        {apiHealth.details ? (
          <pre>{JSON.stringify(apiHealth.details, null, 2)}</pre>
        ) : null}
      </div>
      <p>
        Planning docs: <code>/docs/mvp_spec.md</code> and{" "}
        <code>/docs/build_backlog_plan.md</code>
      </p>
    </main>
  );
}

