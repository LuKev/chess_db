#!/usr/bin/env node

import { randomEmail, randomPassword, requestJson } from "./lib/api_client.mjs";

const baseUrl = process.env.SMOKE_API_BASE_URL;
if (!baseUrl) {
  throw new Error("Missing SMOKE_API_BASE_URL");
}
const requiredApiOrigin = process.env.RELEASE_REQUIRED_API_ORIGIN?.trim();
const baseOrigin = new URL(baseUrl).origin;
const webOrigin =
  process.env.SMOKE_WEB_ORIGIN?.trim() ||
  (() => {
    const parsed = new URL(baseOrigin);
    if (parsed.hostname.startsWith("api.")) {
      return `${parsed.protocol}//${parsed.hostname.slice(4)}${parsed.port ? `:${parsed.port}` : ""}`;
    }
    return baseOrigin;
  })();
if (requiredApiOrigin && baseOrigin !== requiredApiOrigin) {
  throw new Error(
    `Release blocked: SMOKE_API_BASE_URL origin (${baseOrigin}) must match RELEASE_REQUIRED_API_ORIGIN (${requiredApiOrigin})`
  );
}

const smokeEmail = process.env.SMOKE_EMAIL?.trim() || null;
const smokePassword = process.env.SMOKE_PASSWORD?.trim() || null;
if ((smokeEmail && !smokePassword) || (!smokeEmail && smokePassword)) {
  throw new Error("Provide both SMOKE_EMAIL and SMOKE_PASSWORD (or neither).");
}

const requestJsonApi = (path, init = {}) => requestJson(baseUrl, path, init);

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

  const email = smokeEmail ?? randomEmail("smoke");
  const password = smokePassword ?? randomPassword("smoke");

  let registerStatus = null;
  if (!smokeEmail) {
    const register = await requestJsonApi("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    registerStatus = register.response.status;
    if (register.response.status !== 201) {
      throw new Error(
        `Register failed: ${register.response.status} ${JSON.stringify(register.body)}`
      );
    }
  }

  const login = await requestJsonApi("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (login.response.status !== 200) {
    throw new Error(`Login failed: ${login.response.status} ${JSON.stringify(login.body)}`);
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
      origin: webOrigin,
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

  const analysis = await requestJsonApi("/api/analysis", {
    method: "POST",
    headers: {
      cookie: sessionCookie,
      origin: webOrigin,
    },
    body: JSON.stringify({
      fen: "rn1qkbnr/pppb1ppp/3p4/4p3/3PP3/2N2N2/PPP2PPP/R1BQKB1R w KQkq - 0 5",
      depth: 8,
    }),
  });
  if (analysis.response.status !== 201 && analysis.response.status !== 200) {
    throw new Error(
      `Authenticated write failed: ${analysis.response.status} ${JSON.stringify(analysis.body)}`
    );
  }
  if (!analysis.body.id || !analysis.body.status) {
    throw new Error("Authenticated write response missing expected id/status contract");
  }

  const logout = await requestJsonApi("/api/auth/logout", {
    method: "POST",
    headers: {
      cookie: sessionCookie,
      origin: webOrigin,
    },
  });
  if (logout.response.status !== 200) {
    throw new Error(`Logout failed: ${logout.response.status} ${JSON.stringify(logout.body)}`);
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
        webOrigin,
        registerStatus,
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
