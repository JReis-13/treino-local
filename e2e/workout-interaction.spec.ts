import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";

async function begin(page: Page) {
  await page.goto("/plans/?source=excel");
  await page.locator('input[type="file"]').setInputFiles(resolve("tests/fixtures/mobile-audit.xlsx"));
  await page.getByRole("button", { name: /Use this training/ }).click();
  await page.getByRole("button", { name: "Start workout", exact: true }).click();
}
const card = (page: Page, name: string) => page.locator(".exercise-card").filter({ has: page.getByRole("heading", { name, exact: true }) });
async function jump(page: Page, id: string) {
  await page.getByLabel("Workout options").click();
  await page.getByLabel("Jump to exercise").selectOption(id);
}
test.beforeEach(async ({ page }) => {
  await page.route("**/api/social/**", r => r.fulfill({ status: 401, json: { error: "Not connected" } }));
  await page.route("**/api/google/auth/status", r => r.fulfill({ json: { connected: false } }));
});

test("explicit atomic completion preserves grouped loads across views, offline save, History and future Last", async ({ page, context }, info) => {
  await begin(page);
  const nova = card(page, "Nova Press");
  await nova.getByRole("textbox").fill("14,5");
  await nova.getByRole("checkbox", { name: "Save load & complete Nova Press" }).dblclick();
  await expect(nova.getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
  await expect(card(page, "Orbit Row").getByRole("checkbox")).toHaveAttribute("aria-checked", "false");
  await expect(card(page, "Orbit Row").getByRole("textbox")).toHaveValue("12,5");
  await jump(page, "A-strength-28-1");
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await expect(page.locator(".focus-name")).toHaveText("Quartz Pull");
  await page.getByRole("textbox", { name: "Actual load for Quartz Pull", exact: true }).fill("2x9kg");
  await page.getByRole("button", { name: "Save load & complete", exact: true }).click();
  await expect(page.locator(".focus-name")).toHaveText("Comet Lift");
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await expect(page.locator(".focus-name")).toHaveText("Comet Lift");
  await expect(page.getByRole("textbox", { name: "Actual load for Comet Lift", exact: true })).toHaveValue("20kg (17,5 no final)");
  await page.getByRole("button", { name: "List", exact: true }).click();
  await card(page, "Comet Lift").getByRole("button", { name: "Details", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill("22kg (17,5 no final)");
  await dialog.getByRole("button", { name: "Save load & complete", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Undo completion" })).toBeVisible();
  await page.getByLabel("Close exercise details").click();
  const empty = card(page, "Lumen Raise");
  await empty.getByRole("button", { name: "+ Record a load" }).click();
  await empty.getByRole("textbox").fill("12,5 kg");
  await expect(empty.getByRole("textbox")).toHaveAttribute("aria-invalid", "false");
  for (const width of [320, 393]) {
    await page.setViewportSize({ width, height: 640 });
    await empty.getByRole("textbox").focus();
    await empty.getByRole("checkbox").scrollIntoViewIfNeeded();
    expect((await empty.getByRole("checkbox").boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`combined-${width}.png`) });
  }
  await empty.getByRole("checkbox", { name: "Save load & complete Lumen Raise" }).click();
  await context.setOffline(true);
  await page.getByLabel("Workout options").click();
  await page.getByRole("link", { name: /Review session/ }).click();
  await page.getByRole("button", { name: /Save workout/ }).click();
  await expect(page.getByRole("heading", { name: "Session saved" })).toBeVisible();
  await expect(page.getByLabel("Local save confirmation")).toContainText("Partial session");
  await expect(page.getByRole("link", { name: "Done", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("saved-393.png"), fullPage: true });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("treino-local:v2")!).sessions.find((s: { status: string }) => s.status === "completed"));
  expect(saved.blocks.find((b: { blockId: string }) => b.blockId === "A-strength-26-1").actualLoad).toBe("14.5kg");
  expect(saved.blocks.find((b: { blockId: string }) => b.blockId === "A-strength-26-2").completed).toBe(false);
  await context.setOffline(false);
  await page.getByRole("link", { name: /View History/ }).click();
  await page.locator("a.history-card").filter({ hasText: "Saved locally" }).first().click();
  await expect(page.locator(".detail-list")).toContainText("22kg (17,5 no final)");
  await page.goto("/");
  await page.getByRole("button", { name: "Start workout", exact: true }).click();
  await expect(card(page, "Nova Press").locator(".load-reference")).toContainText("Last used14.5kg");
  await expect(card(page, "Nova Press").locator(".load-reference")).toContainText("Current plan12kg");
});

test("invalid and failed combined saves never complete or advance; recovery writes exactly once", async ({ page }) => {
  await begin(page);
  await jump(page, "A-strength-26-1");
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  const input = page.getByRole("textbox", { name: "Actual load for Nova Press", exact: true });
  await input.fill("15,");
  await expect(page.getByRole("button", { name: "Save load & complete", exact: true })).toBeDisabled();
  await expect(page.getByText("Enter a complete number", { exact: false })).toBeVisible();
  await input.fill("15");
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    (window as unknown as { restore: () => void }).restore = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function(k, v) { if (k === "treino-local:v2") throw new Error("Synthetic failure"); return original.call(this, k, v); };
  });
  await page.getByRole("button", { name: "Save load & complete", exact: true }).click();
  await expect(page.getByText("Could not save completion.", { exact: false })).toBeVisible();
  await expect(page.locator(".focus-name")).toHaveText("Nova Press");
  await expect(input).toHaveValue("15");
  await page.evaluate(() => {
    (window as unknown as { restore: () => void }).restore();
    const original = Storage.prototype.setItem;
    (window as unknown as { writes: number }).writes = 0;
    Storage.prototype.setItem = function(k, v) { if (k === "treino-local:v2") (window as unknown as { writes: number }).writes++; return original.call(this, k, v); };
  });
  await page.getByRole("button", { name: "Save load & complete", exact: true }).click();
  await expect(page.locator(".focus-name")).toHaveText("Orbit Row");
  expect(await page.evaluate(() => (window as unknown as { writes: number }).writes)).toBe(1);
  await page.reload();
  await expect(page.locator(".focus-name")).toHaveText("Orbit Row");
});

test("selecting exercise ten survives mode switches; both modes provide review and active B never silently opens A", async ({ page }, info) => {
  const blocks = Array.from({ length: 15 }, (_, i) => ({ kind: "exercise", id: `b${i}`, section: "Strength", name: `Exercise ${i+1}`, prescription: "3 × 10", defaultLoad: "10" }));
  const a = { id: "A", title: "Workout A", description: "", blocks }, b = { id: "B", title: "Workout B", description: "", blocks };
  const plan = { id: "P", name: "Synthetic", source: { kind: "builtin", label: "Local" }, version: 1, importedAt: "2026-10-01T08:00:00Z", updatedAt: "2026-10-01T08:00:00Z", importWarnings: [], legacyCompletions: [], workouts: [a,b] };
  const session = { id: "S", planId: "P", planVersion: 1, workoutId: "A", workoutSnapshot: a, status: "inProgress", startedAt: new Date().toISOString(), blocks: blocks.map(x => ({ blockId: x.id, completed: false, actualLoad: "10" })), syncStatus: "notApplicable" };
  await page.addInitScript(data => { if (!localStorage.getItem("treino-local:v2")) localStorage.setItem("treino-local:v2", JSON.stringify(data)); }, { schemaVersion: 5, activePlanId: "P", plans: [plan], sessions: [session], exerciseNotes: [] });
  await page.goto("/");
  await page.getByRole("button", { name: "View Workout B" }).click();
  await expect(page.getByRole("heading", { name: "Workout B", exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Workout A is still in progress");
  await page.getByRole("button", { name: /Resume Workout A/ }).click();
  await expect(page.locator(".active-workout-header h1")).toHaveText("Workout A");
  for (const width of [320,393]) {
    await page.setViewportSize({ width, height: 844 });
    await jump(page, "b9");
    await page.getByRole("button", { name: "Focus", exact: true }).click();
    await expect(page.locator(".focus-name")).toHaveText("Exercise 10");
    await jump(page, "b12");
    await expect(page.locator(".focus-name")).toHaveText("Exercise 13");
    await page.getByLabel("Workout options").click();
    await expect(page.getByRole("link", { name: /Review session/ })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`navigation-${width}.png`) });
    await page.getByLabel("Workout options").click();
    await page.getByRole("button", { name: "List", exact: true }).click();
    await page.getByRole("button", { name: "Focus", exact: true }).click();
    await expect(page.locator(".focus-name")).toHaveText("Exercise 13");
    await page.getByRole("button", { name: "List", exact: true }).click();
  }
});
