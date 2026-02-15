import { expect, test } from "@playwright/test";

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

test.describe("viewer demo ui", () => {
  test("pieces are not tiny relative to squares", async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 1100, height: 780 });
    await page.goto(joinPath(appEntryPath(baseURL), "/viewer-demo"));

    const board = page.getByTestId("viewer-demo-board");
    await expect(board).toBeVisible();

    const metrics = await board.locator(".square").first().evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const fontSize = Number.parseFloat(window.getComputedStyle(el).fontSize || "0");
      return {
        squareHeight: rect.height,
        fontSize,
        ratio: rect.height > 0 ? fontSize / rect.height : 0,
      };
    });

    // Regression test: historically the pieces were too small (e.g. 18px font in ~40-50px squares).
    expect(metrics.fontSize).toBeGreaterThanOrEqual(24);
    expect(metrics.ratio).toBeGreaterThanOrEqual(0.55);

    await board.screenshot({ path: "test-results/viewer-demo-board.png" });
  });
});

