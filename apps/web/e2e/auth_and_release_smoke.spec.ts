import { expect, test, type Page } from "@playwright/test";

function randomEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`;
}

function apiOriginFromBase(baseURL: string): string {
  const url = new URL(baseURL);
  if (url.hostname.endsWith("kezilu.com")) {
    return "https://api.kezilu.com";
  }
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    return "http://127.0.0.1:4000";
  }
  return `${url.protocol}//${url.hostname.replace(/^www\./, "api.")}${url.port ? `:${url.port}` : ""}`;
}

function appEntryPath(baseURL: string | undefined): string {
  if (!baseURL) {
    return "/";
  }
  const url = new URL(baseURL);
  return url.pathname && url.pathname !== "/" ? url.pathname : "/";
}

function joinPath(base: string, suffix: string): string {
  const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  const normalizedSuffix = suffix.startsWith("/") ? suffix : `/${suffix}`;
  return `${normalizedBase}${normalizedSuffix}` || "/";
}

async function registerViaUi(params: {
  page: Page;
  email: string;
  password: string;
}): Promise<void> {
  await params.page.getByTestId("auth-email").fill(params.email);
  await params.page.getByTestId("auth-password").fill(params.password);
  await params.page.getByTestId("auth-register").click();
  await expect(params.page.getByTestId("user-email")).toContainText(params.email, {
    timeout: 20_000,
  });
}

async function loginViaUi(params: {
  page: Page;
  email: string;
  password: string;
}): Promise<void> {
  await params.page.getByTestId("auth-email").fill(params.email);
  await params.page.getByTestId("auth-password").fill(params.password);
  await params.page.getByTestId("auth-login").click();
  await expect(params.page.getByTestId("user-email")).toContainText(params.email, {
    timeout: 20_000,
  });
}

test.describe("release-like browser coverage", () => {
  test("register, persist session across reload, logout, and login", async ({ page, baseURL }) => {
    const email = randomEmail("e2e-auth");
    const password = "E2ePassword123!";

    await page.goto(joinPath(appEntryPath(baseURL), "/login"));
    await registerViaUi({ page, email, password });

    await page.reload();
    await expect(page.getByTestId("user-email")).toContainText(email);

    await page.getByTestId("auth-logout").click();
    await expect(page.getByTestId("auth-status")).toContainText("Not signed in");

    await page.getByTestId("auth-email").fill(email);
    await page.getByTestId("auth-password").fill(password);
    await page.getByTestId("auth-login").click();
    await expect(page.getByTestId("user-email")).toContainText(email);
  });

  test("sample game seed and viewer open flow works", async ({ page, baseURL }) => {
    const configuredEmail = process.env.E2E_EMAIL?.trim();
    const configuredPassword = process.env.E2E_PASSWORD?.trim();
    const email = configuredEmail ?? randomEmail("e2e-seed");
    const password = configuredPassword ?? "E2ePassword123!";

    await page.goto(joinPath(appEntryPath(baseURL), "/login"));
    if (configuredEmail && configuredPassword) {
      await loginViaUi({ page, email, password });
    } else {
      await registerViaUi({ page, email, password });
    }

    await page.goto(joinPath(appEntryPath(baseURL), "/diagnostics"));
    await page.getByTestId("seed-insert-sample-game").click();
    await expect(page.getByRole("button", { name: "Open" }).first()).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole("button", { name: "Open" }).first().click();
    await expect(page.getByTestId("viewer-status")).toContainText("Viewing game", {
      timeout: 20_000,
    });
  });

  test("csrf rejects bad origin and password reset ui is wired", async ({
    page,
    context,
    baseURL,
  }) => {
    const configuredEmail = process.env.E2E_EMAIL?.trim();
    const configuredPassword = process.env.E2E_PASSWORD?.trim();
    const email = configuredEmail ?? randomEmail("e2e-csrf");
    const password = configuredPassword ?? "E2ePassword123!";
    const resolvedBaseUrl = baseURL ?? "http://127.0.0.1:3000";
    const apiOrigin = process.env.E2E_API_ORIGIN ?? apiOriginFromBase(resolvedBaseUrl);

    await page.goto(joinPath(appEntryPath(baseURL), "/login"));
    if (configuredEmail && configuredPassword) {
      await loginViaUi({ page, email, password });
    } else {
      await registerViaUi({ page, email, password });
    }

    const cookies = await context.cookies(apiOrigin);
    const sessionCookie = cookies.find((cookie) => cookie.name.includes("chessdb_session"));
    expect(sessionCookie).toBeTruthy();
    const rawCookie = `${sessionCookie!.name}=${sessionCookie!.value}`;

    const badOriginLogout = await context.request.post(`${apiOrigin}/api/auth/logout`, {
      headers: {
        cookie: rawCookie,
        origin: "https://attacker.example",
      },
    });
    expect(badOriginLogout.status()).toBe(403);

    await page.getByTestId("reset-email").fill(email);
    await page.getByTestId("reset-request").click();
    await expect(page.getByTestId("reset-status")).toContainText(/reset|email|token/i);

    await page.getByTestId("reset-token").fill("invalid-token");
    await page.getByTestId("reset-new-password").fill("AnotherPass123!");
    await page.getByTestId("reset-confirm").click();
    await expect(page.getByTestId("reset-status")).toContainText(/failed|invalid|expired/i);
  });
});
