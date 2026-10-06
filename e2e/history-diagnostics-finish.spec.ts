import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

const workout = { id: "A", title: "Workout A", description: "", blocks: [
  { kind: "exercise", id: "a", section: "Strength", name: "Squat", prescription: "3 x 10" },
  { kind: "exercise", id: "b", section: "Strength", name: "Row", prescription: "3 x 10" }] };
const plan = { id: "P", name: "Test plan", source: { kind: "builtin", label: "Local" }, version: 1,
  importedAt: "2026-10-01T08:00:00Z", updatedAt: "2026-10-01T08:00:00Z", importWarnings: [],
  legacyCompletions: [], workouts: [workout] };
const session = { id: "S", planId: "P", planVersion: 1, workoutId: "A", workoutSnapshot: workout,
  status: "inProgress", startedAt: "2026-10-06T08:00:00Z", queueOrder: ["a", "b"],
  blocks: [{ blockId: "a", completed: false }, { blockId: "b", completed: false }], syncStatus: "notApplicable" };
const seed = { schemaVersion: 5, activePlanId: "P", plans: [plan], exerciseNotes: [], sessions: [session] };

test("List finish shortcut follows terminal state and shares the existing finish page", async ({ page }, testInfo) => {
  await page.addInitScript((value) => localStorage.setItem("treino-local:v2", JSON.stringify(value)), seed);
  await page.goto("/workout/?id=A");
  const shortcut = page.getByRole("region", { name: "Finish workout shortcut" });
  await expect(shortcut).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Complete Squat" }).click();
  await page.locator(".exercise-card").filter({ hasText: "Row" }).locator("summary", { hasText: "More" }).click();
  await page.getByRole("button", { name: "Skip today" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Skip today" }).click();
  await expect(shortcut).toContainText("1 completed · 1 skipped");
  await page.screenshot({ path: testInfo.outputPath("sticky-finish.png"), animations: "disabled" });
  await page.locator(".exercise-card.is-skipped").getByRole("button", { name: "Undo skip" }).click();
  await expect(shortcut).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Complete Row" }).click();
  await expect(shortcut).toBeVisible();
  await page.locator(".exercise-card.is-complete").first().getByRole("checkbox", { name: "Reopen Squat" }).click();
  await expect(shortcut).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Complete Squat" }).click();
  await shortcut.getByRole("button", { name: /Finish workout/ }).dblclick();
  await expect(page).toHaveURL(/\/finish\/?$/);
});

test("History deletion is confirmed, local-first and keeps the source record", async ({ page, context }, testInfo) => {
  const completed = { ...session, status: "completed", completedAt: "2026-10-06T08:40:00Z", localDate: "2026-10-06",
    blocks: [{ blockId: "a", completed: true, actualLoad: "22 kg" }, { blockId: "b", completed: true }] };
  const data = { ...seed, sessions: [completed] };
  await page.addInitScript((value) => localStorage.setItem("treino-local:v2", JSON.stringify(value)), data);
  await page.goto("/history/session/?id=S");
  await page.screenshot({ path: testInfo.outputPath("history-detail.png"), animations: "disabled" });
  await page.getByRole("button", { name: "Delete workout record" }).click();
  await expect(page.getByRole("dialog")).toContainText("Google Sheets or Excel will not be reversed");
  await page.screenshot({ path: testInfo.outputPath("history-confirm.png"), animations: "disabled" });
  await page.getByRole("button", { name: "Keep workout" }).click();
  await expect(page.getByRole("button", { name: "Delete workout record" })).toBeFocused();
  await context.setOffline(true);
  await page.getByRole("button", { name: "Delete workout record" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete record" }).click();
  await expect(page).toHaveURL(/\/history\??/);
  expect((await page.evaluate(() => JSON.parse(localStorage.getItem("treino-local:v2")!))).sessions).toHaveLength(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("treino-social-delete-outbox-v1") ?? "[]").length)).toBe(1);
  await context.setOffline(false);
});

test("Settings exposes local diagnostics download and clear controls", async ({ page }, testInfo) => {
  await page.addInitScript((value) => localStorage.setItem("treino-local:v2", JSON.stringify(value)), seed);
  await page.route("**/api/social/me", (route) => route.fulfill({ status: 401, json: { error: "not connected" } }));
  await page.goto("/settings/");
  await expect(page.getByRole("button", { name: "Download debug report" })).toBeVisible();
  await page.reload();
  await page.screenshot({ path: testInfo.outputPath("settings-diagnostics.png"), animations: "disabled" });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download debug report" }).click();
  await page.screenshot({ path: testInfo.outputPath("settings-download.png"), animations: "disabled" });
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^treino-local-debug-.*\.json$/);
  const report = JSON.parse(await readFile(await file.path(), "utf8"));
  expect(report.debugReportVersion).toBe(1);
  expect(report.events.filter((event: { type: string }) => event.type === "app_boot").length).toBeGreaterThanOrEqual(2);
  await page.getByRole("button", { name: "Clear diagnostic log" }).click();
  await expect(page.getByRole("status")).toContainText("Diagnostic log cleared");
  const emptyDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download debug report" }).click();
  const emptyReport = JSON.parse(await readFile(await (await emptyDownload).path(), "utf8"));
  expect(emptyReport.events).toHaveLength(0);
});
