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
  test("piece images fill squares at a readable size", async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 1100, height: 780 });
    await page.goto(joinPath(appEntryPath(baseURL), "/viewer-demo"));

    const board = page.getByTestId("viewer-demo-board");
    await expect(board).toBeVisible();

    const metrics = await board.locator(".square").first().evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const piece = el.querySelector("img");
      const pieceRect = piece?.getBoundingClientRect();
      return {
        squareHeight: rect.height,
        pieceHeight: pieceRect?.height ?? 0,
        ratio: rect.height > 0 ? (pieceRect?.height ?? 0) / rect.height : 0,
      };
    });

    expect(metrics.pieceHeight).toBeGreaterThanOrEqual(28);
    expect(metrics.ratio).toBeGreaterThanOrEqual(0.7);

    await board.screenshot({ path: "test-results/viewer-demo-board.png" });
  });
});
