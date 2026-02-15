import { randomBytes } from "node:crypto";

export const DEFAULT_API_BASE_URL = "http://localhost:4000";

export function resolveApiBaseUrl(env = process.env) {
  const value = env.API_BASE_URL?.trim();
  return value && value.length > 0 ? value : DEFAULT_API_BASE_URL;
}

export function randomEmail(prefix = "smoke") {
  const salt = randomBytes(4).toString("hex");
  return `${prefix}-${Date.now()}-${salt}@example.com`;
}

export function randomPassword(prefix = "bench") {
  // API requires min length 8. Keep it long to avoid policy changes.
  return `${prefix}-${randomBytes(24).toString("hex")}`;
}

export function parseJsonResponse(bodyText) {
  try {
    return bodyText ? JSON.parse(bodyText) : {};
  } catch {
    return { raw: bodyText };
  }
}

export function getSessionCookie(response) {
  const headers = response.headers;
  const setCookie =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()[0]
      : headers.get("set-cookie");

  if (!setCookie) {
    throw new Error("Missing Set-Cookie header");
  }
  return setCookie.split(";")[0];
}

export async function requestJson(baseUrl, path, init = {}) {
  const headers = new Headers(init.headers);
  const hasBody = init.body !== undefined && init.body !== null;
  const isFormData =
    typeof FormData !== "undefined" && init.body instanceof FormData;

  if (hasBody && !isFormData && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
  });
  const text = await response.text();
  return {
    response,
    body: parseJsonResponse(text),
    text,
  };
}

export function resolveBenchCredentials({
  env = process.env,
  prefix = "bench",
} = {}) {
  const email = env.BENCH_EMAIL?.trim() || `${prefix}-${Date.now()}@example.com`;
  const password = env.BENCH_PASSWORD?.trim() || randomPassword(prefix);
  return { email, password };
}

export async function registerAndLogin({ baseUrl, email, password }) {
  const register = await requestJson(baseUrl, "/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
    }),
  });

  if (![201, 409].includes(register.response.status)) {
    throw new Error(
      `Failed to register user: ${register.response.status} ${register.text}`
    );
  }

  const login = await requestJson(baseUrl, "/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
    }),
  });

  if (login.response.status !== 200) {
    throw new Error(
      `Failed to login user: ${login.response.status} ${login.text}`
    );
  }

  return getSessionCookie(login.response);
}
