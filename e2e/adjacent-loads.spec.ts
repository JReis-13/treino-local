import { expect, test } from "@playwright/test";

test("separate source columns remain separate through import, List, Focus and report export", async ({ page }) => {
  await page.goto("/plans/");
  await page.getByRole("button", { name: /Add training/ }).tap();
  await page.locator('input[type="file"]').setInputFiles("tests/fixtures/synthetic-adjacent-loads.xlsx");
  await expect(page.getByRole("heading", { name: "Training ready" })).toBeVisible();
  await page.getByText("Review exercise plan loads").tap();
  for (const [name, load] of [["Exercise Alpha", "15"], ["Exercise Beta", "8"],
    ["Exercise Gamma", "20"], ["Exercise Delta", "25"]])
    await expect(page.locator(".import-review")).toContainText(`${name}: ${load}`);
  await page.locator(".import-review").getByRole("button", { name: /Use this training/ }).tap();
  await page.getByRole("button", { name: "Start workout" }).first().tap();
  const alpha = page.locator(".exercise-card").filter({ has: page.getByRole("heading", { name: "Exercise Alpha" }) });
  const beta = page.locator(".exercise-card").filter({ has: page.getByRole("heading", { name: "Exercise Beta" }) });
  await expect(alpha.getByRole("textbox", { name: "Actual load for Exercise Alpha" })).toHaveValue("15");
  await expect(beta.getByRole("textbox", { name: "Actual load for Exercise Beta" })).toHaveValue("8");
  await page.getByRole("button", { name: "Focus", exact: true }).tap();
  for (let index = 0; index < 3; index++) await page.getByRole("button", { name: "Next →" }).tap();
  await expect(page.locator(".focus-name")).toHaveText("Exercise Alpha");
  await expect(page.getByRole("textbox", { name: "Actual load for Exercise Alpha" })).toHaveValue("15");
  await page.getByRole("button", { name: "Next →" }).tap();
  await expect(page.locator(".focus-name")).toHaveText("Exercise Beta");
  await expect(page.getByRole("textbox", { name: "Actual load for Exercise Beta" })).toHaveValue("8");
  await page.goto("/settings/");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download debug report" }).tap();
  const report = JSON.parse(await (await download).createReadStream().then(async (stream) => {
    let raw = ""; for await (const chunk of stream) raw += chunk.toString(); return raw;
  }));
  expect(report.loadTrace.rows.length).toBeGreaterThan(0);
  expect(JSON.stringify(report.loadTrace)).not.toContain("Exercise Alpha");
  expect(JSON.stringify(report.loadTrace)).not.toContain('"15"');
});

test("a legacy shifted History snapshot does not prefill neighboring exercises on a phone", async ({ page }) => {
  await page.goto("/plans/");
  await page.getByRole("button", { name: /Add training/ }).tap();
  await page.locator('input[type="file"]').setInputFiles("tests/fixtures/synthetic-adjacent-loads.xlsx");
  await page.locator(".import-review").getByRole("button", { name: /Use this training/ }).tap();
  await page.evaluate(() => {
    const key = "treino-local:v2";
    const data = JSON.parse(localStorage.getItem(key)!);
    const plan = data.plans[0], workout = plan.workouts[0];
    const snapshot = structuredClone(workout);
    for (const block of snapshot.blocks) if (block.kind === "exercise" && ["E26", "E28"].includes(block.sourceCell)) {
      block.defaultLoad = block.name === "Exercise Alpha" ? "8" : block.name === "Exercise Gamma" ? "25" : undefined;
      delete block.loadSource;
    }
    data.sessions.unshift({ id: "legacy-shifted", planId: plan.id, planVersion: 1, workoutId: workout.id,
      planLineageKey: `plan:${plan.id}`, workoutLineageKey: workout.id, workoutSnapshot: snapshot,
      status: "completed", startedAt: "2026-10-01T08:00:00Z", completedAt: "2026-10-01T08:45:00Z",
      localDate: "2026-10-01", syncStatus: "notApplicable", blocks: snapshot.blocks.map((block: { id: string; name?: string }) => ({
        blockId: block.id, completed: ["Exercise Alpha", "Exercise Gamma"].includes(block.name ?? ""),
        actualLoad: block.name === "Exercise Alpha" ? "8" : block.name === "Exercise Gamma" ? "25" : undefined })) });
    localStorage.setItem(key, JSON.stringify(data));
  });
  await page.reload();
  await page.goto("/");
  await page.getByRole("button", { name: "Start workout" }).first().tap();
  for (const [name, load] of [["Exercise Alpha", "15"], ["Exercise Beta", "8"],
    ["Exercise Gamma", "20"], ["Exercise Delta", "25"]]) {
    const card = page.locator(".exercise-card").filter({ has: page.getByRole("heading", { name }) });
    await expect(card.getByRole("textbox", { name: `Actual load for ${name}` }).first()).toHaveValue(load);
  }
  await page.goto("/history/");
  await expect(page.getByText("Workout A").first()).toBeVisible();
});
