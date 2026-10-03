import { expect, test } from "@playwright/test";

const initial = {
  schemaVersion: 5, activePlanId: "focus-plan", exerciseNotes: [{ planId: "focus-plan", exerciseKey: "seated row", text: "Keep shoulders down", updatedAt: "2026-10-03T08:00:00Z" }],
  plans: [{ id: "focus-plan", name: "Focus test", source: { kind: "builtin", label: "Local" }, version: 1,
    importedAt: "2026-10-03T08:00:00Z", updatedAt: "2026-10-03T08:00:00Z", importWarnings: [], legacyCompletions: [],
    workouts: [{ id: "A", title: "Workout A", description: "", restNote: "2 min rest", blocks: [
      { kind: "exercise", id: "a", section: "Strength", name: "Lat pulldown", prescription: "3 × 10", equipment: "Machine", defaultLoad: "35 kg", videoUrl: "https://www.youtube.com/watch?v=jtlT3l7jD1M" },
      { kind: "exercise", id: "b", section: "Strength", name: "Seated row", prescription: "3 × 10", groupId: "pair", defaultLoad: "20 kg" },
      { kind: "exercise", id: "c", section: "Strength", name: "Single leg Romanian deadlift with a deliberately long exercise name", prescription: "3 × 8", groupId: "pair" },
      { kind: "exercise", id: "d", section: "Strength", name: "Calf raise", prescription: "3 × 12" },
    ] }] }],
  sessions: [{ id: "focus-session", planId: "focus-plan", planVersion: 1, workoutId: "A", status: "inProgress", startedAt: "2026-10-03T08:00:00Z",
    workoutSnapshot: { id: "A", title: "Workout A", description: "", restNote: "2 min rest", blocks: [
      { kind: "exercise", id: "a", section: "Strength", name: "Lat pulldown", prescription: "3 × 10", equipment: "Machine", defaultLoad: "35 kg", videoUrl: "https://www.youtube.com/watch?v=jtlT3l7jD1M" },
      { kind: "exercise", id: "b", section: "Strength", name: "Seated row", prescription: "3 × 10", groupId: "pair", defaultLoad: "20 kg" },
      { kind: "exercise", id: "c", section: "Strength", name: "Single leg Romanian deadlift with a deliberately long exercise name", prescription: "3 × 8", groupId: "pair" },
      { kind: "exercise", id: "d", section: "Strength", name: "Calf raise", prescription: "3 × 12" },
    ] },
    blocks: [{ blockId: "a", completed: false, actualLoad: "35 kg" }, { blockId: "b", completed: false, actualLoad: "20 kg" },
      { blockId: "c", completed: false }, { blockId: "d", completed: false }], queueOrder: ["a", "b", "c", "d"], syncStatus: "notApplicable" }],
};

test("phone Focus and List share loads, queue, skips, timer and saved outcome", async ({ page, context }, testInfo) => {
  await page.addInitScript((seed) => { if (!localStorage.getItem("treino-local:v2")) localStorage.setItem("treino-local:v2", JSON.stringify(seed)); }, initial);
  await page.goto("/workout/?id=A");
  await expect(page.getByRole("button", { name: "Focus", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await expect(page.locator(".focus-name")).toHaveText("Lat pulldown");
  await page.screenshot({ path: testInfo.outputPath("focus-now.png"), animations: "disabled" });
  await page.goBack();
  await expect(page.getByRole("button", { name: "List", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await expect(page.getByRole("button", { name: "Watch execution" })).toBeVisible();
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ ...viewport, height: 420 });
  await page.getByRole("textbox", { name: "Actual load for Lat pulldown" }).focus();
  await expect.poll(async () => { const box = await page.getByRole("textbox", { name: "Actual load for Lat pulldown" }).boundingBox(); return Boolean(box && box.y >= 0 && box.y + box.height <= 420); }).toBe(true);
  await page.setViewportSize(viewport);
  await page.getByRole("textbox", { name: "Actual load for Lat pulldown" }).fill("37.5 kg");
  await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(page.locator(".exercise-card").filter({ hasText: "Lat pulldown" }).getByRole("textbox", { name: "Actual load for Lat pulldown" })).toHaveValue("37.5 kg");
  await page.locator(".exercise-card").filter({ hasText: "Lat pulldown" }).getByRole("textbox", { name: "Actual load for Lat pulldown" }).fill("38 kg");
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Actual load for Lat pulldown" })).toHaveValue("38 kg");
  await page.getByRole("button", { name: "Do later" }).click();
  await expect(page.locator(".focus-name")).toHaveText("Seated row");
  await expect(page.getByText("Next: Single leg Romanian deadlift", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: /Details & notes · Note/ })).toBeVisible();
  await page.getByRole("button", { name: /Complete Seated row/ }).click();
  await expect(page.locator(".focus-name")).toContainText("Single leg Romanian deadlift");
  await page.getByRole("button", { name: /Start 2:00 rest/ }).click();
  await expect(page.getByRole("group", { name: "Rest timer" })).toBeVisible();
  await page.getByRole("button", { name: "Skip today" }).click();
  await expect(page.getByRole("dialog", { name: /Skip Single leg Romanian deadlift/ })).toBeVisible();
  await page.getByRole("dialog", { name: /Skip Single leg Romanian deadlift/ }).getByRole("button", { name: "Skip today" }).click();
  await expect(page.locator(".focus-name")).toHaveText("Calf raise");
  await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(page.locator(".exercise-card.is-skipped")).toContainText("Skipped today");
  await page.locator(".exercise-card.is-skipped").getByRole("button", { name: "Undo skip" }).click();
  await expect(page.locator(".exercise-card.is-skipped")).toHaveCount(0);
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await expect(page.locator(".focus-name")).toContainText("Single leg Romanian deadlift");
  await page.getByRole("button", { name: "Next →" }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Focus", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".focus-name")).toHaveText("Calf raise");
  await context.setOffline(true);
  await page.getByRole("button", { name: /Complete Calf raise/ }).click();
  await expect(page.locator(".focus-name")).toContainText("Single leg Romanian deadlift");
  await page.getByRole("button", { name: "Skip today" }).click();
  await page.getByRole("dialog", { name: /Skip Single leg Romanian deadlift/ }).getByRole("button", { name: "Skip today" }).click();
  await expect(page.locator(".focus-name")).toHaveText("Lat pulldown");
  await context.setOffline(false);
  await page.getByRole("button", { name: "List", exact: true }).click();
  await page.getByRole("link", { name: /Finish workout/ }).last().click();
  await expect(page.getByText("2 / 4")).toBeVisible();
  await expect(page.getByText("1 skipped today")).toBeVisible();
  await page.getByRole("button", { name: /Save workout/ }).click();
  await page.getByRole("link", { name: "Not now" }).click();
  await page.locator(".history-card").first().click();
  await expect(page.getByText("2 / 4 DONE", { exact: false })).toBeVisible();
  await expect(page.getByText("Skipped today", { exact: false })).toBeVisible();
  await page.goto("/workout/?id=A");
  await page.getByRole("button", { name: /Start Workout A/ }).click();
  await expect(page.locator(".exercise-card").first()).toContainText("Lat pulldown");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test("Focus final state reports completed and skipped separately", async ({ page }) => {
  await page.addInitScript((seed) => {
    const copy = JSON.parse(JSON.stringify(seed));
    copy.sessions[0].focusMode = true;
    copy.sessions[0].blocks[0].completed = true;
    copy.sessions[0].blocks[1].completed = true;
    copy.sessions[0].blocks[2].skipped = true;
    copy.sessions[0].blocks[3].skipped = true;
    localStorage.setItem("treino-local:v2", JSON.stringify(copy));
  }, initial);
  await page.goto("/workout/?id=A");
  await expect(page.getByRole("heading", { name: "All active exercises are done" })).toBeVisible();
  await expect(page.getByText("2 completed · 2 skipped today")).toBeVisible();
  await expect(page.getByRole("link", { name: /Finish workout/ })).toBeVisible();
  await expect(page.locator(".focus-name")).toHaveCount(0);
});

test("List offers compact queue actions, undo, and session-only skip", async ({ page }) => {
  await page.addInitScript((seed) => { localStorage.setItem("treino-local:v2", JSON.stringify(seed)); }, initial);
  await page.goto("/workout/?id=A");
  const row = page.locator(".exercise-card").filter({ hasText: "Seated row" });
  await row.getByText("More", { exact: true }).click();
  await row.getByRole("button", { name: "Do later" }).click();
  await expect(page.locator(".queue-feedback")).toContainText("Moved to later");
  await expect(page.locator(".exercise-list").first().locator(".exercise-card").last()).toContainText("Single leg Romanian deadlift");
  await page.locator(".queue-feedback").getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".exercise-list").first().locator(".exercise-card").nth(1)).toContainText("Seated row");
  const calf = page.locator(".exercise-card").filter({ hasText: "Calf raise" });
  await calf.getByText("More", { exact: true }).click();
  await calf.getByRole("button", { name: "Skip today" }).click();
  await expect(page.getByRole("dialog", { name: "Skip Calf raise today?" })).toBeVisible();
  await page.getByRole("dialog", { name: "Skip Calf raise today?" }).getByRole("button", { name: "Skip today" }).click();
  await expect(calf).toContainText("Skipped today");
  await calf.getByRole("button", { name: "Undo skip" }).click();
  await expect(calf).not.toContainText("Skipped today");
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("treino-local:v2")!));
  expect(stored.plans[0].workouts[0].blocks.map((block: { id: string }) => block.id)).toEqual(["a", "b", "c", "d"]);
  expect(stored.plans[0].version).toBe(1);
});

test("Focus keeps warm-up rest behavior consistent with List", async ({ page }) => {
  await page.addInitScript((seed) => {
    const copy = JSON.parse(JSON.stringify(seed));
    copy.sessions[0].focusMode = true;
    copy.sessions[0].workoutSnapshot.blocks[0].section = "Warm-up";
    copy.plans[0].workouts[0].blocks[0].section = "Warm-up";
    localStorage.setItem("treino-local:v2", JSON.stringify(copy));
  }, initial);
  await page.goto("/workout/?id=A");
  await expect(page.locator(".focus-name")).toHaveText("Lat pulldown");
  await expect(page.getByText("Rest guidance:")).toHaveCount(0);
  await page.getByRole("button", { name: /Complete Lat pulldown/ }).click();
  await expect(page.getByRole("button", { name: /Start 2:00 rest/ })).toHaveCount(0);
});
