import { expect, test } from "@playwright/test";

const workout = { id: "A", title: "Workout A", description: "", restNote: "Rest 2 minutes", rirByOccurrence: [3], blocks: [
  { kind: "exercise", id: "a", section: "Strength", name: "Exercise Alpha", prescription: "3 x 10", equipment: "Dumbbell", defaultLoad: "10", groupId: "pair" },
  { kind: "exercise", id: "b", section: "Strength", name: "Exercise Beta", prescription: "3 x 12", defaultLoad: "8", groupId: "pair" }] };
const plan = { id: "P", name: "Synthetic UX plan", source: { kind: "builtin", label: "Local" }, version: 1,
  importedAt: "2026-10-11T08:00:00Z", updatedAt: "2026-10-11T08:00:00Z", importWarnings: [], legacyCompletions: [], workouts: [workout] };
const session = { id: "S", planId: "P", planVersion: 1, workoutId: "A", workoutSnapshot: workout,
  status: "inProgress", startedAt: new Date().toISOString(), queueOrder: ["a", "b"],
  blocks: [{ blockId: "a", completed: false, actualLoad: "10" }, { blockId: "b", completed: false, actualLoad: "8" }], syncStatus: "notApplicable" };
const seed = { schemaVersion: 5, activePlanId: "P", plans: [plan], exerciseNotes: [], sessions: [session] };
test.beforeEach(async ({ page }) => {
  await page.addInitScript((value) => { if (!localStorage.getItem("treino-local:v2")) localStorage.setItem("treino-local:v2", JSON.stringify(value)); }, seed);
  await page.route("**/api/social/**", (route) => route.fulfill({ status: 401, json: { error: "not connected" } }));
});
test("empty finish is truthful and requires explicit acknowledgement before one local save", async ({ page }, info) => {
  await page.goto("/finish/");
  await page.screenshot({ path: info.outputPath("empty-finish.png"), fullPage: true });
  await expect(page.getByRole("heading", { name: "Review your session." })).toBeVisible();
  await expect(page.getByText("NO EXERCISES COMPLETED", { exact: true })).toBeVisible();
  const save = page.getByRole("button", { name: /Save workout/ });
  await expect(save).toBeDisabled();
  await expect(page.locator(".loads-summary")).not.toContainText("Exercise Alpha");
  await page.getByRole("checkbox", { name: /Save this session with no completed exercises/ }).check();
  await save.dblclick();
  await expect(page).toHaveURL(/\/share/);
  await expect(page.getByLabel("Local save confirmation")).toContainText("No exercises completed");
  const records = await page.evaluate(() => JSON.parse(localStorage.getItem("treino-local:v2")!).sessions);
  expect(records).toHaveLength(1);
  expect(records[0].status).toBe("completed");
  expect(records[0].blocks.every((block: { completed: boolean }) => !block.completed)).toBe(true);
});
test("Focus context appears once and plan notes contain only training guidance", async ({ page }, info) => {
  await page.goto("/workout/?id=A");
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await page.screenshot({ path: info.outputPath("focus.png"), fullPage: true });
  await expect(page.getByText("3 x 10", { exact: false })).toHaveCount(1);
  await expect(page.getByText("Dumbbell", { exact: false })).toHaveCount(1);
  await expect(page.getByText("Paired with Exercise Beta", { exact: true })).toHaveCount(1);
  await page.getByText("Plan notes", { exact: true }).click();
  await expect(page.locator(".plan-context")).not.toContainText("source, not each exercise");
});
test("partial finish preserves progress and completed loads; duplicate dialog traps focus", async ({ page }) => {
  await page.goto("/workout/?id=A");
  await page.getByRole("checkbox", { name: "Complete Exercise Alpha" }).click();
  await page.goto("/finish/");
  await expect(page.getByText("PARTIAL SESSION", { exact: true })).toBeVisible();
  await expect(page.locator(".loads-summary")).toContainText("Exercise Alpha");
  await expect(page.locator(".loads-summary")).not.toContainText("Exercise Beta");
  await page.getByRole("link", { name: /Back to workout/ }).click();
  await expect(page.getByRole("checkbox", { name: "Reopen Exercise Alpha" })).toBeChecked();
  await page.goto("/finish/");
  await page.getByRole("button", { name: /Save workout/ }).click();
  await expect(page).toHaveURL(/\/share/);
  await page.goto("/");
  await page.getByRole("button", { name: "Start workout" }).first().click();
  await page.getByRole("checkbox", { name: "Complete Exercise Alpha" }).click();
  await page.goto("/finish/");
  await page.getByRole("button", { name: /Save workout/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: /Add another/ })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Save workout/ })).toBeFocused();
});

test("import warnings identify exercises, preserve uncertainty and keep blockers; copy choice explains writes", async ({ page }, info) => {
  const imported = { name: "Synthetic import", sourceFingerprint: "synthetic", legacyCompletions: [],
    source: { kind: "google", spreadsheetId: "synthetic-sheet", filename: "Synthetic", template: "test", mappings: {
      A: { sheetName: "TREINO A", slots: [], ordinalCells: [] } } },
    workouts: [{ ...workout, blocks: workout.blocks.map((block) => ({ ...block, sourceCell: "E28", defaultLoad: undefined })) }],
    warnings: [{ code: "uncertain-load", severity: "activationBlocker", message: "Grouped loads need review; no load was guessed.", location: "TREINO A!G28:H28" }] };
  await page.route("**/api/google/auth/status", (route) => route.fulfill({ json: { connected: true } }));
  await page.route("**/api/google/sheets/import", (route) => route.fulfill({ json: { imported } }));
  await page.goto("/plans/");
  await page.getByRole("button", { name: /Add training/ }).click();
  await expect(page.getByText(/Safe copy imports locally/)).toBeVisible();
  await page.getByRole("button", { name: "Use Google Sheets" }).click();
  await page.getByLabel("PASTE GOOGLE SHEETS LINK").fill("https://docs.google.com/spreadsheets/d/synthetic-sheet/edit");
  await page.getByRole("button", { name: /Import training/ }).click();
  await page.getByText("1 import note · View details", { exact: true }).click();
  await page.getByRole("button", { name: "Review affected exercises" }).click();
  await expect(page.getByLabel("Affected exercises")).toBeFocused();
  await expect(page.getByLabel("Affected exercises")).toContainText("Exercise Alpha");
  await expect(page.getByLabel("Affected exercises")).toContainText("Plan load: Not assigned safely");
  await expect(page.getByRole("button", { name: /Use this training/ })).toHaveCount(0);
  await expect(page.locator(".import-review").getByRole("alert")).toContainText("Activation is blocked");
  await page.screenshot({ path: info.outputPath("import-review.png"), fullPage: true });
});

test("320/393/430px summary and enlarged text stay within the viewport; cancel keeps keyboard focus and progress", async ({ page }, info) => {
  for (const width of [320, 393, 430]) {
    await page.setViewportSize({ width, height: 640 });
    await page.goto("/finish/");
    await page.evaluate(() => { document.documentElement.style.fontSize = "125%"; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.getByRole("checkbox", { name: /Save this session/ }).check();
    const save = page.getByRole("button", { name: /Save workout/ });
    await save.scrollIntoViewIfNeeded();
    const bounds = await save.boundingBox(), nav = await page.getByRole("navigation", { name: "Main navigation" }).boundingBox();
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(nav!.y);
    await page.screenshot({ path: info.outputPath(`summary-${width}-large-text.png`), fullPage: true });
  }
  await page.goto("/workout/?id=A");
  const options = page.getByLabel("Workout options");
  await options.click();
  await page.getByRole("button", { name: "Cancel workout", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Keep workout" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Cancel workout", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(options).toBeFocused();
  expect((await page.evaluate(() => JSON.parse(localStorage.getItem("treino-local:v2")!).sessions))[0].status).toBe("inProgress");
});
