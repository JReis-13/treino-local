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

test("Focus completion changes only the selected grouped member across List and reload", async ({ page }) => {
  await page.addInitScript((seed) => {
    if (localStorage.getItem("treino-local:v2")) return;
    const copy = JSON.parse(JSON.stringify(seed));
    // A previously saved source row may have reused B's ID for its partner.
    copy.plans[0].workouts[0].blocks[2].id = "b";
    copy.sessions[0].workoutSnapshot.blocks[2].id = "b";
    copy.sessions[0].blocks[2].blockId = "b";
    copy.sessions[0].queueOrder = ["a", "b", "b", "d"];
    localStorage.setItem("treino-local:v2", JSON.stringify(copy));
  }, initial);
  await page.goto("/workout/?id=A");
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await page.getByRole("button", { name: "Next →" }).click();
  await expect(page.locator(".focus-name")).toHaveText("Seated row");
  await page.getByRole("button", { name: "Mark complete" }).click();
  await expect(page.locator(".focus-name")).toContainText("Single leg Romanian deadlift");
  await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(page.locator(".exercise-card.is-complete")).toHaveCount(1);
  await expect(page.locator(".exercise-card.is-complete")).toContainText("Seated row");
  await expect(page.locator(".exercise-card").filter({ hasText: "Single leg Romanian deadlift" })).not.toHaveClass(/is-complete/);
  await page.reload();
  await expect(page.locator(".exercise-card.is-complete")).toHaveCount(1);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("treino-local:v2")!));
  expect(stored.sessions[0].blocks.map((block: { completed: boolean }) => block.completed)).toEqual([false, true, false, false]);
  expect(new Set(stored.sessions[0].blocks.map((block: { blockId: string }) => block.blockId)).size).toBe(4);
  await page.locator(".exercise-card.is-complete").getByRole("checkbox", { name: /Reopen Seated row/ }).click();
  await expect(page.locator(".exercise-card.is-complete")).toHaveCount(0);
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await expect(page.locator(".focus-name")).toContainText("Single leg Romanian deadlift");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("treino-local:v2")!).sessions[0].blocks.map((block: { completed: boolean }) => block.completed)))
    .toEqual([false, false, false, false]);
});

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
  await expect(page.getByRole("button", { name: "▶ Watch execution" })).toBeVisible();
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
  await page.getByText("More actions", { exact: true }).click();
  await page.getByRole("button", { name: "Do later" }).click();
  await expect(page.locator(".focus-name")).toHaveText("Seated row");
  await expect(page.getByText("Next: Single leg Romanian deadlift", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: /Note: Keep shoulders down/ })).toBeVisible();
  await page.getByRole("button", { name: "Mark complete" }).click();
  await expect(page.locator(".focus-name")).toContainText("Single leg Romanian deadlift");
  await page.getByRole("button", { name: /Start 2:00 rest/ }).click();
  await expect(page.getByRole("group", { name: "Rest timer" })).toBeVisible();
  await page.getByText("More actions", { exact: true }).click();
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
  await page.getByRole("button", { name: "Mark complete" }).click();
  await expect(page.locator(".focus-name")).toHaveText("Lat pulldown");
  await page.getByRole("button", { name: "← Previous" }).click();
  await expect(page.locator(".focus-name")).toHaveText("Calf raise");
  await expect(page.getByText("✓ Completed")).toBeVisible();
  await page.getByRole("button", { name: "← Previous" }).click();
  await expect(page.locator(".focus-name")).toContainText("Single leg Romanian deadlift");
  await page.getByText("More actions", { exact: true }).click();
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
  await page.getByRole("button", { name: "Mark complete" }).click();
  await expect(page.getByRole("button", { name: /Start 2:00 rest/ })).toHaveCount(0);
});

test("Focus uses distinct pending, completed and skipped states with compact inline context", async ({ page }, testInfo) => {
  await page.addInitScript((seed) => {
    const copy = JSON.parse(JSON.stringify(seed));
    copy.sessions[0].focusMode = true;
    copy.sessions[0].startedAt = new Date().toISOString();
    copy.sessions[0].workoutSnapshot.blocks[3].section = "Warm-up";
    copy.plans[0].workouts[0].blocks[3].section = "Warm-up";
    copy.sessions.push({ ...structuredClone(copy.sessions[0]), id: "previous-session", status: "completed", startedAt: "2026-10-01T08:00:00Z",
      completedAt: "2026-10-01T08:40:00Z", localDate: "2026-10-01", focusMode: false,
      blocks: copy.sessions[0].blocks.map((block: { blockId: string }) => ({ ...block, completed: true, actualLoad: block.blockId === "a" ? "30 kg" : undefined })) });
    localStorage.setItem("treino-local:v2", JSON.stringify(copy));
  }, initial);
  await page.goto("/workout/?id=A");
  const focus = page.getByRole("region", { name: "Focus mode" });
  const capture = async (name: string) => {
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${name}.png`), animations: "disabled" });
  };
  await expect(focus.getByRole("heading", { name: "Lat pulldown" })).toBeVisible();
  await expect(focus.getByText("Machine", { exact: false })).toBeVisible();
  await expect(focus.getByText(/Current plan 35 kg/)).toBeVisible();
  await expect(focus.getByText(/Last 30 kg/)).toBeVisible();
  await expect(focus.getByRole("button", { name: "▶ Watch execution" })).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);
  await focus.getByRole("button", { name: "▶ Watch execution" }).click();
  await expect(page.getByRole("dialog", { name: "Lat pulldown" }).locator("iframe")).toHaveCount(1);
  await page.getByRole("button", { name: "Close exercise details" }).click();
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(focus.getByRole("button", { name: "Mark complete" })).toBeVisible();
  await expect(focus.getByText("✓ Completed")).toHaveCount(0);
  if (testInfo.project.name !== "Narrow phone Chrome") {
    const action = await focus.getByRole("button", { name: "Mark complete" }).boundingBox();
    const nav = await page.locator(".bottom-nav").boundingBox();
    expect(action && nav && action.y + action.height <= nav.y).toBeTruthy();
  }
  await capture("focus-pending-load-video");
  await focus.getByRole("button", { name: "Mark complete" }).click();
  await expect(focus.getByRole("heading", { name: "Seated row" })).toBeVisible();
  await expect(focus.getByRole("button", { name: /Note: Keep shoulders down/ })).toBeVisible();
  await capture("focus-note-after-complete");
  await focus.getByRole("button", { name: "Start 2:00 rest" }).click();
  await expect(page.getByRole("group", { name: "Rest timer" })).toBeVisible();
  await capture("focus-rest-running");
  await page.getByRole("group", { name: "Rest timer" }).getByRole("button", { name: "Skip" }).click();
  await focus.getByRole("button", { name: "← Previous" }).click();
  await expect(focus.getByText("✓ Completed")).toBeVisible();
  await expect(focus.getByRole("button", { name: "Mark complete" })).toHaveCount(0);
  await capture("focus-completed-review");
  await focus.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(focus.getByRole("button", { name: "Mark complete" })).toBeVisible();
  await expect(focus.getByText("✓ Completed")).toHaveCount(0);
  await focus.getByRole("button", { name: "Next →" }).click();
  await focus.getByRole("button", { name: /Note: Keep shoulders down/ }).click();
  await expect(page.getByRole("tab", { name: "Notes" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Close exercise details" }).click();
  await capture("focus-with-note");
  await focus.getByText("More actions").click();
  await focus.getByRole("button", { name: "Skip today" }).click();
  await page.getByRole("dialog", { name: /Skip Seated row/ }).getByRole("button", { name: "Skip today" }).click();
  await focus.getByRole("button", { name: "← Previous" }).click();
  await expect(focus.getByText("Skipped today")).toBeVisible();
  await expect(focus.getByRole("button", { name: "Mark complete" })).toHaveCount(0);
  await capture("focus-skipped-review");
  await focus.getByRole("button", { name: "Undo skip" }).click();
  await expect(focus.getByRole("button", { name: "Mark complete" })).toBeVisible();
  await focus.getByRole("button", { name: "Next →" }).click();
  await expect(focus.getByRole("heading", { name: /Single leg Romanian deadlift/ })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(focus.getByRole("button", { name: "Add load (optional)" })).toBeVisible();
  await capture("focus-long-name-no-load");
  await focus.getByRole("button", { name: "Next →" }).click();
  await expect(focus.getByRole("heading", { name: "Calf raise" })).toBeVisible();
  await expect(focus.getByRole("button", { name: "Add load (optional)" })).toHaveCount(0);
  await capture("focus-warmup-no-load");
});

test("Portuguese warm-up name keeps the action visible without an empty load field", async ({ page }, testInfo) => {
  await page.addInitScript((seed) => {
    const copy = JSON.parse(JSON.stringify(seed));
    copy.sessions[0].focusMode = true;
    copy.sessions[0].startedAt = new Date().toISOString();
    copy.sessions[0].workoutSnapshot.blocks[0].name = "Caminhada lateral com miniband";
    copy.sessions[0].workoutSnapshot.blocks[0].section = "Warm-up";
    copy.sessions[0].workoutSnapshot.blocks[0].prescription = "10 passos/lado";
    copy.sessions[0].workoutSnapshot.blocks[0].equipment = "Miniband";
    copy.sessions[0].workoutSnapshot.blocks[0].videoUrl = undefined;
    copy.sessions[0].workoutSnapshot.blocks[0].defaultLoad = undefined;
    copy.sessions[0].blocks[0].actualLoad = undefined;
    localStorage.setItem("treino-local:v2", JSON.stringify(copy));
  }, initial);
  await page.goto("/workout/?id=A");
  const focus = page.getByRole("region", { name: "Focus mode" });
  await expect(focus.getByRole("heading", { name: "Caminhada lateral com miniband" })).toBeVisible();
  await expect(focus.locator(".focus-load")).toHaveCount(0);
  await expect(focus.getByRole("button", { name: "Mark complete" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("focus-portuguese-warmup.png"), animations: "disabled" });
  if (testInfo.project.name === "Pixel 7 Chrome") {
    await page.setViewportSize({ width: 430, height: 932 });
    await expect(focus.getByRole("button", { name: "Mark complete" })).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath("focus-large-android.png"), animations: "disabled" });
  }
});
