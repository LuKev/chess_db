#!/usr/bin/env node

const baseUrl = process.env.SMOKE_API_BASE_URL;
if (!baseUrl) {
  throw new Error("Missing SMOKE_API_BASE_URL");
}

function randomEmail() {
  return `smoke-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`;
}

async function jsonRequest(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
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

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        registerStatus: register.response.status,
        loginStatus: login.response.status,
        importStatus: importStatus.status,
      },
      null,
      2
    )
  );
}

await main();

