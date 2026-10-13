import { expect, test } from "@playwright/test";
import JSZip from "jszip";
import { readFile } from "node:fs/promises";

const seed = { schemaVersion: 5, activePlanId: "P", exerciseNotes: [], sessions: [], plans: [{ id: "P", name: "Synthetic navigation",
  source: { kind: "builtin", label: "Local" }, version: 1, importedAt: "2001-01-01T08:00:00Z", updatedAt: "2001-01-01T08:00:00Z",
  importWarnings: [], legacyCompletions: Array.from({ length: 20 }, (_, i) => ({ id: `date-${i}`, workoutId: "A", date: `2001-01-${String(i + 1).padStart(2, "0")}`, sourceSlot: `E${i + 5}` })),
  workouts: [{ id: "A", title: "Workout A", description: "", blocks: [{ kind: "exercise", id: "e", name: "Synthetic Exercise", section: "Strength", prescription: "3x10" }] }] }] };
test.beforeEach(async ({ page }) => {
  await page.addInitScript((data) => { if (!localStorage.getItem("treino-local:v2")) localStorage.setItem("treino-local:v2", JSON.stringify(data)); }, seed);
  await page.route("**/api/google/auth/status", (r) => r.fulfill({ json: { connected: false } }));
});

test("History All training and scroll survive Friends navigation while disconnected state appears immediately", async ({ page }) => {
  let delayed = false;
  let release: (() => void) | undefined;
  await page.route("**/api/social/**", async (r) => { if (delayed) await new Promise<void>((resolve) => { release = resolve; }); return r.fulfill({ status: 401, json: { error: "Sign in required" } }); });
  await page.goto("/friends/");
  await expect(page.locator(".friends-directory")).toContainText("Sign in with Google");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await nav.getByRole("link", { name: "History", exact: true }).click();
  await page.getByRole("combobox", { name: /TRAINING PLAN/ }).selectOption("all");
  await page.evaluate(() => window.scrollTo(0, 700));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(600);
  delayed = true;
  await nav.getByRole("link", { name: "Friends", exact: true }).click();
  await expect(page.locator(".friends-directory")).toContainText("Sign in with Google");
  await expect(page.getByText(/Loading (your )?friends/)).toHaveCount(0);
  await expect.poll(() => Boolean(release)).toBe(true);
  delayed = false; release!();
  await nav.getByRole("link", { name: "History", exact: true }).click();
  await expect(page.getByRole("combobox", { name: /TRAINING PLAN/ })).toHaveValue("all");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(600);
});

test("History view preferences are isolated across confirmed authenticated accounts", async ({ page }) => {
  let account = "A";
  await page.route("**/api/social/**", (r) => {
    const path = new URL(r.request().url()).pathname;
    return r.fulfill({ json: path.endsWith("/me") ? { accountId: account, email: `${account}@example.invalid`, displayName: account, sharingEnabled: false } :
      path.endsWith("/home") ? { activities: [], received: [], friendCount: 0 } : { friends: [] } });
  });
  await page.goto("/friends/");
  await expect(page.getByText("No connected friends yet.")).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await nav.getByRole("link", { name: "History", exact: true }).click();
  await page.getByRole("combobox", { name: /TRAINING PLAN/ }).selectOption("all");
  await nav.getByRole("link", { name: "Friends", exact: true }).click();
  account = "B";
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("treino-social-preference-v1")!).accountId)).toBe("B");
  await nav.getByRole("link", { name: "History", exact: true }).click();
  await expect(page.getByRole("combobox", { name: /TRAINING PLAN/ })).toHaveValue("active");
  await nav.getByRole("link", { name: "Friends", exact: true }).click();
  account = "A";
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("treino-social-preference-v1")!).accountId)).toBe("A");
  await nav.getByRole("link", { name: "History", exact: true }).click();
  await expect(page.getByRole("combobox", { name: /TRAINING PLAN/ })).toHaveValue("all");
});

test("incompatible Excel headers and zero-workout responses never show successful activation", async ({ page }) => {
  const zip = await JSZip.loadAsync(await readFile("tests/fixtures/mobile-audit.xlsx"));
  zip.file("xl/styles.xml", '<styleSheet><cellXfs><xf numFmtId="0"/></cellXfs></styleSheet>');
  zip.file("xl/workbook.xml", '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="r1"/></sheets></workbook>');
  zip.file("xl/_rels/workbook.xml.rels", '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>');
  zip.file("xl/worksheets/sheet1.xml", '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Exercise</t></is></c><c r="B1" t="inlineStr"><is><t>Load</t></is></c></row></sheetData></worksheet>');
  await page.route("**/api/social/**", (r) => r.fulfill({ status: 401, json: {} }));
  await page.goto("/plans/?source=excel");
  await page.locator('input[type="file"]').setInputFiles({ name: "incompatible.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: await zip.generateAsync({ type: "nodebuffer" }) });
  await expect(page.getByRole("status")).toContainText("supported training workbook");
  await expect(page.getByRole("status")).toContainText("Recognized headers: Exercise · Load");
  await expect(page.getByRole("heading", { name: "Training ready", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Use this training/ })).toHaveCount(0);
  const zero = { name: "Invalid", source: { kind: "google", filename: "Synthetic", template: "test", mappings: {} }, sourceFingerprint: "test", workouts: [], warnings: [], legacyCompletions: [] };
  await page.route("**/api/google/auth/status", (r) => r.fulfill({ json: { connected: true } }));
  await page.route("**/api/google/sheets/import", (r) => r.fulfill({ json: { imported: zero } }));
  await page.goto("/plans/?source=google");
  await page.getByLabel("PASTE GOOGLE SHEETS LINK").fill("https://docs.google.com/spreadsheets/d/synthetic-sheet-id/edit");
  await page.getByRole("button", { name: /Import training/ }).click();
  await expect(page.getByRole("heading", { name: "Import needs review", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Use this training/ })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("treino-local:v2")!).plans.length)).toBe(1);
});
