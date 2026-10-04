import { expect, test } from "@playwright/test";

test("capture the eight core phone surfaces without horizontal overflow", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    if (localStorage.getItem("treino-local:v2")) return;
    const blocks = [
      { kind: "exercise", id: "a", section: "Strength", name: "Goblet squat", prescription: "3 × 10", defaultLoad: "15 kg", equipment: "Dumbbell", videoUrl: "https://www.youtube.com/watch?v=jtlT3l7jD1M" },
      { kind: "exercise", id: "b", section: "Strength", name: "Single leg Romanian deadlift with a longer exercise name", prescription: "3 × 8", groupId: "pair", defaultLoad: "12.5 kg" },
      { kind: "exercise", id: "c", section: "Strength", name: "Seated row", prescription: "3 × 10", groupId: "pair", defaultLoad: "20 kg" },
      { kind: "exercise", id: "d", section: "Strength", name: "Calf raise", prescription: "3 × 12" },
    ];
    const workout = { id: "A", title: "Workout A", description: "Strength · full body", restNote: "2 min rest", blocks };
    const now = new Date();
    const started = new Date(now.getTime() - 42 * 60_000).toISOString();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const plan = { id: "visual-plan", name: "Training Alpha", source: { kind: "builtin", label: "Local" }, version: 1,
      importedAt: started, updatedAt: started, importWarnings: [], legacyCompletions: [], workouts: [workout] };
    const progress = blocks.map((block) => ({ blockId: block.id, completed: false, actualLoad: block.defaultLoad }));
    const sessions = [
      { id: "visual-active", planId: plan.id, planVersion: 1, workoutId: "A", workoutSnapshot: workout, status: "inProgress", startedAt: started,
        blocks: progress, queueOrder: ["a", "b", "c", "d"], syncStatus: "notApplicable" },
      { id: "visual-history", planId: plan.id, planVersion: 1, workoutId: "A", workoutSnapshot: workout, status: "completed", startedAt: started,
        completedAt: now.toISOString(), localDate: date, blocks: progress.map((block, index) => ({ ...block, completed: index < 2 })),
        queueOrder: ["a", "b", "c", "d"], syncStatus: "notApplicable", sessionNote: "Felt strong today." },
    ];
    localStorage.setItem("treino-local:v2", JSON.stringify({ schemaVersion: 5, activePlanId: plan.id, plans: [plan], sessions, exerciseNotes: [] }));
  });
  async function capture(name: string) {
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true, animations: "disabled" });
  }
  await page.goto("/workout/?id=A");
  await expect(page.getByRole("button", { name: "Focus", exact: true })).toBeVisible();
  await capture("workout-list");
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await capture("workout-focus");
  await page.getByRole("button", { name: "Exercise details" }).click();
  await expect(page.getByRole("dialog", { name: "Goblet squat" })).toBeVisible();
  await capture("exercise-detail");
  await page.getByRole("button", { name: "Close exercise details" }).click();
  await page.getByRole("button", { name: /Complete Goblet squat/ }).click();
  await page.getByRole("button", { name: /Start 2:00 rest/ }).click();
  await capture("active-timer");
  await page.getByRole("group", { name: "Rest timer" }).getByRole("button", { name: "Skip" }).click();
  await page.goto("/share/?id=visual-history&from=history");
  await expect(page.getByRole("heading", { name: /Share workout/ })).toBeVisible();
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 800;
    const context = canvas.getContext("2d")!; context.fillStyle = "#4d79c8"; context.fillRect(0, 0, 640, 800);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.getByLabel("Choose workout photo").setInputFiles({ name: "visual.png", mimeType: "image/png", buffer: Buffer.from(base64, "base64") });
  await expect(page.locator(".share-card-preview img")).toHaveAttribute("src", /^blob:/);
  await capture("share-photo");
  await page.goto("/history/");
  await expect(page.getByRole("heading", { name: /History/ })).toBeVisible();
  await capture("history");
  await page.goto("/stats/");
  await expect(page.getByRole("heading", { name: /Statistics/ })).toBeVisible();
  await capture("statistics");
  await page.goto("/plans/");
  await expect(page.getByRole("heading", { name: /Training plans/ })).toBeVisible();
  await capture("plans");
});
