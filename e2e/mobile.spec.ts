import { expect, test, type Page } from "@playwright/test";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { snapshotFromXlsx } from "../lib/import/snapshot";
import { parseTrainingSnapshot } from "../lib/import/template-parser";
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
  await expect(page.getByRole("heading", { name: /Training plans|Add training/ })).toBeVisible();
  await chooseExcelFile(page, path);
  await expect(page.getByRole("heading", { name: "Training ready" })).toBeVisible();
  await page.locator(".review-card").getByRole("button", { name: /Use this training/ }).tap();
  await expect(page).toHaveURL(/\/$/);
}

async function chooseExcelFile(page: Page, path: string) {
  await expect(page.getByRole("heading", { name: /Training plans|Add training/ })).toBeVisible();
  if (await page.getByRole("heading", { name: "Training plans" }).isVisible()) await page.getByRole("button", { name: /Add training/ }).tap();
  const direct = await page.evaluate(() => window.isSecureContext && "showOpenFilePicker" in window);
  const button = direct ? page.getByRole("button", { name: "Import as safe copy" })
    : page.getByRole("button", { name: "Choose workbook" });
  await expect(button).toBeVisible();
  const chooserPromise = page.waitForEvent("filechooser");
  await button.tap();
  await (await chooserPromise).setFiles(path);
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test("mobile first launch, workout actions, reload, back/forward and history", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Choose your training/ })).toBeVisible();
  await importFile(page, jonatha);
  await expectNoHorizontalOverflow(page);
  await expect(page.getByText("2 WORKOUTS", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start workout" }).first().tap();
  await expectNoHorizontalOverflow(page);
  await expect(page.getByRole("checkbox", { name: /Complete/ }).first()).toBeVisible();
  await page.getByRole("checkbox", { name: /Complete/ }).first().tap();
  await expect(page.getByRole("checkbox", { name: /Reopen/ }).first()).toHaveAttribute("aria-checked", "true");
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

test("same-day Add and Replace keep distinct history entries and statistics offline", async ({ page, context }) => {
  await page.goto("/");
  await importFile(page, jonatha);
  const startAndFinish = async () => {
    await page.getByRole("button", { name: "Start workout" }).first().tap();
    const toggle = page.getByRole("checkbox", { name: /Complete Agachamento goblet/ });
    await toggle.tap();
    await expect(page.getByRole("checkbox", { name: /Reopen Agachamento goblet/ })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("textbox", { name: "Actual load for Agachamento goblet" }).fill("7,5");
    await page.getByRole("link", { name: /Finish workout/ }).tap();
    await page.getByRole("button", { name: /Save workout/ }).tap();
  };
  await startAndFinish();
  await expect(page.locator(".history-list a.history-card")).toHaveCount(1);
  await page.getByRole("link", { name: "Home", exact: true }).tap();
  await startAndFinish();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).tap();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: /Save workout/ }).tap();
  await page.getByRole("button", { name: /Add another workout/ }).tap();
  await expect(page.locator(".history-list a.history-card")).toHaveCount(2);
  await page.getByRole("link", { name: "Home", exact: true }).tap();
  await startAndFinish();
  await page.getByRole("button", { name: /Replace previous workout/ }).tap();
  await expect(page.locator(".history-list a.history-card")).toHaveCount(2);
  await context.setOffline(true);
  await page.getByRole("link", { name: "Stats", exact: true }).tap();
  await expect(page.getByRole("heading", { name: /Statistics/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Load progression" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("mobile plan switching isolates history and renders cardio instructions", async ({ page }) => {
  await page.goto("/");
  await importFile(page, milena);
  await expectNoHorizontalOverflow(page);
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
  await page.getByRole("checkbox", { name: /Complete Semana 1/ }).first().tap();
  await expect(page.getByText("1 of 3 blocks completed")).toBeVisible();
});

test("very long training names stay inside a small phone viewport", async ({ page }) => {
  await page.goto("/");
  await importFile(page, milena);
  await page.getByRole("link", { name: "Plans", exact: true }).tap();
  page.once("dialog", (dialog) => void dialog.accept("Very long training name — strength and conditioning programme for a small phone screen"));
  await page.locator(".active-plan-card .plan-manage summary").tap();
  await page.locator(".active-plan-card").getByRole("button", { name: "Rename locally" }).tap();
  await expect(page.getByText(/Very long training name/)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByRole("link", { name: "Home", exact: true }).tap();
  await expectNoHorizontalOverflow(page);
});

test("production PWA keeps the imported workout usable offline", async ({ page, context }) => {
  test.skip(process.env.E2E_PRODUCTION !== "1", "Production Next.js runtime only");
  await page.goto("/");
  await importFile(page, jonatha);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.getByRole("button", { name: "Start workout" }).first().tap();
  await page.getByRole("checkbox", { name: /Complete/ }).first().tap();
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

test("PWA update prompt cannot reload an in-progress workout", async ({ page }) => {
  test.skip(process.env.E2E_PRODUCTION !== "1", "Production Next.js runtime only");
  await page.goto("/");
  await importFile(page, jonatha);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "Start workout" }).first().tap();
  await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new Event("controllerchange")));
  await expect(page.getByText(/reload after your workout/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Reload" })).toBeDisabled();
  await page.reload();
  await expect(page.getByText(/IN PROGRESS/).first()).toBeVisible();
});

test("fresh mobile user connects, imports by Sheet URL, finishes locally and syncs", async ({ page }, testInfo) => {
  const spreadsheetId = "a12345678901234567890123";
  const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  const secondId = "b12345678901234567890123";
  const secondUrl = `https://docs.google.com/spreadsheets/d/${secondId}/edit`;
  const snapshot = await snapshotFromXlsx(new Uint8Array(await readFile(jonatha)));
  const imported = parseTrainingSnapshot(snapshot, { kind: "google", filename: "Friend copy", template: "", mappings: {},
    authMode: "oauth", spreadsheetId, sheetUrl, sourceProof: "a".repeat(43), syncEnabled: true }, "Friend copy");
  let connected = false;
  const operations: string[] = [];
  await page.route("**/api/google/auth/status", (route) => route.fulfill({ json: { connected } }));
  await page.route("**/api/google/auth/start?**", async (route) => {
    connected = true;
    operations.push("connect");
    await route.fulfill({ status: 302, headers: { location: "/plans/?google=connected" }, body: "" });
  });
  await page.route("**/api/google/sheets/import", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const url = route.request().postDataJSON().url;
    expect([sheetUrl, secondUrl]).toContain(url);
    operations.push("import");
    await route.fulfill({ json: { imported: url === sheetUrl ? imported : { ...imported, name: "Second copy",
      source: { ...imported.source, filename: "Second copy", spreadsheetId: secondId, sheetUrl: secondUrl } } } });
  });
  await page.route("**/api/google/sheets/refresh", (route) => route.fulfill({ json: { imported } }));
  await page.route("**/api/google/sheets/register-completion", async (route) => {
    const body = route.request().postDataJSON();
    expect(body.spreadsheetId).toBe(spreadsheetId);
    expect(body).not.toHaveProperty("range");
    operations.push("sync");
    await route.fulfill({ json: { status: "synced", sourceSlot: "E5" } });
  });
  await page.goto("/plans/");
  await page.getByRole("button", { name: /Add training/ }).tap();
  await page.getByRole("button", { name: /Use Google Sheets/ }).tap();
  await page.getByRole("button", { name: /Connect Google/ }).tap();
  await expect(page.getByRole("heading", { name: "Google account connected" })).toBeVisible();
  await page.getByLabel("PASTE GOOGLE SHEETS LINK").fill(sheetUrl);
  await page.getByRole("button", { name: /Import training/ }).tap();
  await expect(page.getByRole("heading", { name: /Importing training/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("google-import-progress.png"), animations: "disabled" });
  await expect(page.getByRole("heading", { name: "Training ready" })).toBeVisible();
  await page.locator(".review-card").getByRole("button", { name: /Use this training/ }).tap();
  await page.getByRole("button", { name: "Start workout" }).first().tap();
  await page.getByRole("link", { name: /Finish workout/ }).tap();
  await page.getByRole("button", { name: /Save workout/ }).tap();
  await expect.poll(() => operations.filter((item) => item === "sync").length).toBe(1);
  await expect(page.getByText(/Synced/)).toBeVisible();
  await page.getByRole("link", { name: "Plans", exact: true }).tap();
  await page.getByRole("button", { name: /\+ Add training/ }).tap();
  await page.getByRole("button", { name: /Use Google Sheets/ }).tap();
  await page.getByLabel("PASTE GOOGLE SHEETS LINK").fill(secondUrl);
  await page.getByRole("button", { name: /Import training/ }).tap();
  await expect(page.getByRole("heading", { name: "Training ready" })).toBeVisible();
  expect(operations).toEqual(["connect", "import", "sync", "import"]);
});

test("local backup rejects malformed JSON and restores a reviewed plan", async ({ page }) => {
  await page.goto("/");
  await importFile(page, jonatha);
  await page.getByRole("link", { name: "Settings", exact: true }).tap();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export backup" }).tap();
  const saved = await downloadPromise;
  const backup = await readFile(await saved.path()!, "utf8");
  expect(backup).toContain('"format": "treino-local-backup"');
  expect(backup).not.toContain("connectorUrl");
  await page.locator('input[type="file"]').setInputFiles({ name: "broken.json", mimeType: "application/json", buffer: Buffer.from("{") });
  await expect(page.getByText(/not valid JSON/)).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({ name: "valid.json", mimeType: "application/json", buffer: Buffer.from(backup) });
  await expect(page.getByText(/Backup validated/)).toBeVisible();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Restore this backup" }).tap();
  await expect(page.getByText(/Backup restored/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Download previous data safety snapshot/ })).toBeVisible();
  await page.getByRole("link", { name: "Home", exact: true }).tap();
  await expect(page.getByText("2 WORKOUTS", { exact: true })).toBeVisible();
});
