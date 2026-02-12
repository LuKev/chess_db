#!/usr/bin/env node

const baseUrl = process.env.SMOKE_API_BASE_URL;
if (!baseUrl) {
  throw new Error("Missing SMOKE_API_BASE_URL");
}
const requiredApiOrigin = process.env.RELEASE_REQUIRED_API_ORIGIN?.trim();
const baseOrigin = new URL(baseUrl).origin;
if (requiredApiOrigin && baseOrigin !== requiredApiOrigin) {
  throw new Error(
    `Release blocked: SMOKE_API_BASE_URL origin (${baseOrigin}) must match RELEASE_REQUIRED_API_ORIGIN (${requiredApiOrigin})`
  );
}

function randomEmail() {
  return `smoke-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`;
}

async function jsonRequest(path, init = {}) {
  const hasJsonBody = init.body !== undefined && !(init.body instanceof FormData);
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(hasJsonBody ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  const body = await response.text();
  let data = {};
  try {
    data = JSON.parse(body);
  } catch {
    data = { raw: body };
  }
  return { response, data };
}

async function main() {
  if (requiredApiOrigin) {
    const requiredHealth = await fetch(`${requiredApiOrigin}/health`);
    if (!requiredHealth.ok) {
      throw new Error(
        `Required API origin health check failed: ${requiredApiOrigin} (${requiredHealth.status})`
      );
    }
  }

  const health = await fetch(`${baseUrl}/health`);
  if (!health.ok) {
    throw new Error(`Health check failed: ${health.status}`);
  }

  const email = randomEmail();
  const password = "SmokePassword123!";

  const register = await jsonRequest("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (register.response.status !== 201) {
    throw new Error(`Register failed: ${register.response.status} ${JSON.stringify(register.data)}`);
  }

  const login = await jsonRequest("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (login.response.status !== 200) {
    throw new Error(`Login failed: ${login.response.status} ${JSON.stringify(login.data)}`);
  }
  const cookie = login.response.headers.get("set-cookie");
  if (!cookie) {
    throw new Error("Login response did not include Set-Cookie");
  }
  const lowerCookie = cookie.toLowerCase();
  if (!lowerCookie.includes("httponly")) {
    throw new Error("Session cookie missing HttpOnly attribute");
  }
  if (!lowerCookie.includes("samesite=lax")) {
    throw new Error("Session cookie missing SameSite=Lax attribute");
  }
  if (baseOrigin.startsWith("https://") && !lowerCookie.includes("secure")) {
    throw new Error("HTTPS deployment cookie missing Secure attribute");
  }
  const sessionCookie = cookie.split(";")[0];

  const me = await fetch(`${baseUrl}/api/auth/me`, {
    headers: {
      cookie: sessionCookie,
    },
  });
  if (!me.ok) {
    throw new Error(`Auth me failed: ${me.status}`);
  }

  const pgn = `[Event "Smoke"]\n[White "A"]\n[Black "B"]\n[Result "1-0"]\n\n1. e4 e5 1-0\n`;
  const form = new FormData();
  form.set("file", new Blob([pgn], { type: "application/x-chess-pgn" }), "smoke.pgn");
  const importResponse = await fetch(`${baseUrl}/api/imports`, {
    method: "POST",
    headers: {
      cookie: sessionCookie,
      origin: baseOrigin,
    },
    body: form,
  });
  const importBody = await importResponse.json().catch(() => ({}));
  if (importResponse.status !== 201) {
    throw new Error(`Import enqueue failed: ${importResponse.status} ${JSON.stringify(importBody)}`);
  }
  if (!importBody.id) {
    throw new Error("Import enqueue response missing id");
  }

  const importStatus = await fetch(`${baseUrl}/api/imports/${importBody.id}`, {
    headers: {
      cookie: sessionCookie,
    },
  });
  if (importStatus.status !== 200) {
    throw new Error(`Import status failed: ${importStatus.status}`);
  }

  const analysis = await jsonRequest("/api/analysis", {
    method: "POST",
    headers: {
      cookie: sessionCookie,
      origin: baseOrigin,
    },
    body: JSON.stringify({
      fen: "rn1qkbnr/pppb1ppp/3p4/4p3/3PP3/2N2N2/PPP2PPP/R1BQKB1R w KQkq - 0 5",
      depth: 8,
    }),
  });
  if (analysis.response.status !== 201 && analysis.response.status !== 200) {
    throw new Error(
      `Authenticated write failed: ${analysis.response.status} ${JSON.stringify(analysis.data)}`
    );
  }
  if (!analysis.data.id || !analysis.data.status) {
    throw new Error("Authenticated write response missing expected id/status contract");
  }

  const logout = await jsonRequest("/api/auth/logout", {
    method: "POST",
    headers: {
      cookie: sessionCookie,
      origin: baseOrigin,
    },
  });
  if (logout.response.status !== 200) {
    throw new Error(`Logout failed: ${logout.response.status} ${JSON.stringify(logout.data)}`);
  }

  const meAfterLogout = await fetch(`${baseUrl}/api/auth/me`, {
    headers: {
      cookie: sessionCookie,
    },
  });
  if (meAfterLogout.status !== 401) {
    throw new Error(`Expected /api/auth/me to be 401 after logout, got ${meAfterLogout.status}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        requiredApiOrigin: requiredApiOrigin ?? null,
        registerStatus: register.response.status,
        loginStatus: login.response.status,
        importStatus: importStatus.status,
        analysisStatus: analysis.response.status,
        logoutStatus: logout.response.status,
      },
      null,
      2
    )
  );
}

await main();
