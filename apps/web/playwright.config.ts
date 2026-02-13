import { defineConfig } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
const parsedBaseUrl = new URL(baseURL);
const isLocal =
  (parsedBaseUrl.hostname === "127.0.0.1" || parsedBaseUrl.hostname === "localhost") &&
  (parsedBaseUrl.port === "" || parsedBaseUrl.port === "3000");

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  retries: 1,
  use: {
    baseURL,
    ignoreHTTPSErrors: true,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: isLocal
    ? {
        // For local runs, bring up Next dev server automatically.
        command: "npm run dev",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      }
    : undefined,
});
