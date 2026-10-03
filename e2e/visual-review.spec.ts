import { expect, test } from "@playwright/test";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixturePath } from "../tests/fixture-path";

test("phone screens stay compact and readable through the gym flow", async ({ page }, testInfo) => {
  const folder = await mkdtemp(join(tmpdir(), "treino-visual-review-"));
  const workbook = join(folder, "TREINO 1 JONATHA.xlsx");
  await copyFile(fixturePath("TREINO 1 JONATHA.xlsx"), workbook);
  async function capture(name: string) {
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${name}.png`), animations: "disabled" });
  }
  try {
    await page.goto("/plans/");
    await expect(page.getByRole("heading", { name: "Training plans" })).toBeVisible();
    await capture("plans-empty");
    await page.getByRole("button", { name: /Add training/ }).tap();
    await capture("choose-source");
    await page.getByRole("button", { name: /Use Google Sheets/ }).tap();
    await capture("google-link");
    await page.getByRole("button", { name: "Back" }).tap();
    const direct = await page.evaluate(() => window.isSecureContext && "showOpenFilePicker" in window);
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: direct ? "Import as safe copy" : /Choose workbook/ }).tap();
    await (await chooser).setFiles(workbook);
    await expect(page.getByRole("heading", { name: "Training ready" })).toBeVisible();
    await capture("import-review");
    await page.locator(".import-review").getByRole("button", { name: /Use this training/ }).tap();
    await page.getByRole("link", { name: "Plans", exact: true }).tap();
    await capture("plans-active");
    await page.getByRole("link", { name: "Home", exact: true }).tap();
    await page.getByRole("button", { name: "Start workout" }).first().tap();
    await expect(page.locator(".workout-title h1")).toBeInViewport();
    await capture("workout");
    const normalViewport = page.viewportSize()!;
    await page.setViewportSize({ ...normalViewport, height: 440 });
    await page.getByRole("textbox", { name: "Actual load for Agachamento goblet" }).focus();
    await capture("load-entry-short-viewport");
    await page.setViewportSize(normalViewport);
    await page.evaluate(() => { document.documentElement.style.fontSize = "125%"; });
    await capture("workout-larger-text");
    await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
    await page.getByRole("checkbox", { name: /Complete Agachamento goblet/ }).tap();
    await capture("exercise-completed");
    await page.getByRole("textbox", { name: "Actual load for Agachamento goblet" }).fill("7,5");
    await page.getByRole("link", { name: /Finish workout/ }).tap();
    await page.getByRole("button", { name: /Save workout/ }).tap();
    await capture("history");
    await page.getByRole("link", { name: "Stats", exact: true }).tap();
    await capture("statistics");
    await page.getByRole("link", { name: "Home", exact: true }).tap();
    await page.getByRole("button", { name: "Start workout" }).first().tap();
    await page.getByRole("link", { name: /Finish workout/ }).tap();
    await page.getByRole("button", { name: /Save workout/ }).tap();
    await expect(page.getByRole("dialog")).toBeVisible();
    await capture("same-day-dialog");
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
