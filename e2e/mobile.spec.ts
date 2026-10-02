import { expect, test, type Page } from "@playwright/test";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { snapshotFromXlsx } from "../lib/import/snapshot";
import { fixturePath } from "../tests/fixture-path";

let folder: string;
let jonatha: string;
let milena: string;

test.beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "treino-mobile-e2e-"));
  jonatha = join(folder, "TREINO 1 JONATHA.xlsx");
  milena = join(folder, "TREINO 4 MILENA.xlsx");
  await copyFile(fixturePath("TREINO 1 JONATHA.xlsx"), jonatha);
  await copyFile(fixturePath("TREINO 4 MILENA.xlsx"), milena);
});
test.afterEach(async () => { await rm(folder, { recursive: true, force: true }); });

async function importFile(page: Page, path: string) {
  await page.getByRole("link", { name: /Import Excel file/ }).first().tap().catch(async () => {
    await page.getByRole("link", { name: /Switch training/ }).tap();
  });
  await expect(page.getByRole("heading", { name: /Training plans/ })).toBeVisible();
  await chooseExcelFile(page, path);
  await expect(page.getByRole("heading", { name: "Training ready" })).toBeVisible();
  await page.locator(".review-card").getByRole("button", { name: /Use this training/ }).tap();
  await expect(page).toHaveURL(/\/$/);
}

async function chooseExcelFile(page: Page, path: string) {
  const direct = await page.evaluate(() => window.isSecureContext && "showOpenFilePicker" in window);
  const button = direct ? page.getByRole("button", { name: "Import as safe copy" })
    : page.getByRole("button", { name: "Choose workbook" });
  await expect(button).toBeVisible();
  const chooserPromise = page.waitForEvent("filechooser");
  await button.tap();
  await (await chooserPromise).setFiles(path);
}

test("mobile first launch, workout actions, reload, back/forward and history", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Choose your training/ })).toBeVisible();
  await importFile(page, jonatha);
  await expect(page.getByText("2 WORKOUTS", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start workout" }).first().tap();
  await expect(page.getByRole("button", { name: /Mark complete/ }).first()).toBeVisible();
  await page.getByRole("button", { name: /Mark complete/ }).first().tap();
  await page.getByRole("textbox", { name: "Actual load for Agachamento goblet" }).fill("9");
  await page.goBack();
  await expect(page.getByText(/in progress/)).toBeVisible();
  await page.goForward();
  await page.reload();
  await expect(page.getByText("1 of 11 blocks completed")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Actual load for Agachamento goblet" })).toHaveValue("9");
  await page.getByRole("link", { name: /Finish workout/ }).tap();
  await expect(page.getByRole("heading", { name: "Nice work." })).toBeVisible();
  await page.getByRole("button", { name: /Save workout/ }).tap();
  await expect(page.getByRole("heading", { name: /History/ })).toBeVisible();
  await expect(page.getByText(/1\/11 done/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/1\/11 done/)).toBeVisible();
  await page.getByRole("link", { name: /Workout A/ }).last().tap();
  await expect(page.getByText(/Load 9/)).toBeVisible();
});

test("mobile plan switching isolates history and renders cardio instructions", async ({ page }) => {
  await page.goto("/");
  await importFile(page, milena);
  await expect(page.getByText("3 WORKOUTS")).toBeVisible();
  await page.getByRole("link", { name: "History", exact: true }).tap();
  await expect(page.locator(".history-total strong")).toHaveText("20");
  await page.getByRole("link", { name: "Plans", exact: true }).tap();
  await chooseExcelFile(page, jonatha);
  await expect(page.getByRole("heading", { name: "Training ready" })).toBeVisible();
  await page.locator(".review-card").getByRole("button", { name: /Use this training/ }).tap();
  await page.getByRole("link", { name: "History", exact: true }).tap();
  await expect(page.locator(".history-total strong")).toHaveText("0");
  await page.getByRole("link", { name: "Plans", exact: true }).tap();
  await page.getByRole("article").filter({ hasText: "TREINO 4 MILENA" }).getByRole("button", { name: "Use this training" }).tap();
  await expect(page.getByText("3 WORKOUTS")).toBeVisible();
  await page.getByRole("button", { name: "Start workout" }).last().tap();
  await expect(page.getByRole("heading", { name: "Workout Cardio" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Semana 1" })).toBeVisible();
  await page.getByRole("button", { name: "Mark block complete" }).first().tap();
  await expect(page.getByText("1 of 3 blocks completed")).toBeVisible();
});

test("production PWA keeps the imported workout usable offline", async ({ page, context }) => {
  test.skip(process.env.E2E_PRODUCTION !== "1", "Production Next.js runtime only");
  await page.goto("/");
  await importFile(page, jonatha);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.getByRole("button", { name: "Start workout" }).first().tap();
  await page.getByRole("button", { name: /Mark complete/ }).first().tap();
  await page.reload();
  await expect(page.getByText("1 of 11 blocks completed")).toBeVisible();
  await page.getByRole("link", { name: /Finish workout/ }).tap();
  await page.getByRole("button", { name: /Save workout/ }).tap();
  await expect(page.getByText(/1\/11 done/)).toBeVisible();
});

test("production connector requests bypass PWA cache and update notice waits for a tap", async ({ page }) => {
  test.skip(process.env.E2E_PRODUCTION !== "1", "Production Next.js runtime only");
  await page.goto("/debug");
  const build = await page.getByText("BUILD", { exact: true }).locator("..").locator("strong").textContent();
  expect(build).toMatch(/^[a-zA-Z0-9_-]{8,48}$/);
  const workerCode = await page.evaluate(async () => (await fetch("/sw.js", { cache: "no-store" })).text());
  expect(workerCode).toContain(`treino-${build}`);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  const result = await page.evaluate(async () => {
    const response = await fetch("/api/google-connector", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operation: "ping", connectorUrl: "http://127.0.0.1/", key: "a".repeat(64) }) });
    const cachesList = await caches.keys();
    const requests = (await Promise.all(cachesList.filter((name) => name.startsWith("treino-")).map(async (name) =>
      (await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname)))).flat();
    return { status: response.status, cachedApi: requests.some((path) => path.startsWith("/api/")) };
  });
  expect(result).toEqual({ status: 400, cachedApi: false });
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new Event("controllerchange")));
  await expect(page.getByText("New version available")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();
});

test("mobile Google connector import, validation and one verified completion use the same-origin route", async ({ page }) => {
  const snapshot = await snapshotFromXlsx(new Uint8Array(await readFile(jonatha)));
  const operations: string[] = [];
  await page.route("**/api/google-connector", async (route) => {
    const body = route.request().postDataJSON();
    operations.push(body.operation);
    const result = body.operation === "ping" ? { spreadsheetName: "Test copy", sheetUrl: "https://docs.google.com/spreadsheets/d/copy", workoutSheets: ["TREINO A", "TREINO B"] } :
      body.operation === "getWorkbookSnapshot" ? { spreadsheetName: "Test copy", sheetUrl: "https://docs.google.com/spreadsheets/d/copy", mappingId: "abcdef12", snapshot } :
      { status: "synced", workoutId: body.payload.workoutId, localDate: body.payload.localDate, sourceSlot: "E5" };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, version: 1, result }) });
  });
  await page.goto("/plans/");
  await page.getByLabel("APPS SCRIPT /EXEC URL").fill("https://script.google.com/macros/s/AKfycbx123/exec");
  await page.getByLabel("CONNECTION KEY").fill("a".repeat(64));
  await page.getByRole("button", { name: /Test connection/ }).tap();
  await expect(page.getByText(/Connected: Test copy/)).toBeVisible();
  await page.getByRole("button", { name: /Import training/ }).tap();
  await expect(page.getByRole("heading", { name: "Training ready" })).toBeVisible();
  await page.locator(".review-card").getByRole("button", { name: /Use this training/ }).tap();
  await page.getByRole("link", { name: "Source", exact: true }).tap();
  await page.getByRole("button", { name: /Validate source/ }).tap();
  await expect(page.getByText(/Source validated/)).toBeVisible();
  await page.getByRole("button", { name: "Enable sync" }).tap();
  await page.getByRole("link", { name: "Home", exact: true }).tap();
  await page.getByRole("button", { name: "Start workout" }).first().tap();
  await page.getByRole("link", { name: /Finish workout/ }).tap();
  await page.getByRole("button", { name: /Save workout/ }).tap();
  await expect.poll(() => operations.filter((operation) => operation === "registerWorkoutCompletion").length).toBe(1);
  await expect(page.getByText(/Synced/)).toBeVisible();
  await page.getByRole("link", { name: /Workout A/ }).last().tap();
  await expect(page.getByText(/Date verified in E5/)).toBeVisible();
  await page.getByRole("link", { name: "Plans", exact: true }).tap();
  await page.getByRole("article").filter({ hasText: "Test copy" }).getByRole("button", { name: "Refresh training" }).tap();
  await expect(page.getByRole("heading", { name: "Training ready" })).toBeVisible();
  await page.locator(".review-card").getByRole("button", { name: /Update this training/ }).tap();
  await expect(page.getByText("2 WORKOUTS", { exact: true })).toBeVisible();
  expect(operations.filter((operation) => operation === "getWorkbookSnapshot").length).toBe(3);
});
