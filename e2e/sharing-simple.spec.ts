import { expect, test } from "@playwright/test";

test("completed and History workouts share edited text with no photo or download controls", async ({ page }) => {
  await page.addInitScript(() => {
    const workout = { id: "A", title: "Treino rápido 💪", description: "", blocks: [
      { kind: "exercise", id: "a", section: "Strength", name: "Squat", prescription: "3 × 10" },
    ] };
    const stamp = "2026-10-03T08:00:00Z";
    const plan = { id: "p", name: "Local", source: { kind: "builtin", label: "Local" }, version: 1,
      importedAt: stamp, updatedAt: stamp, importWarnings: [], legacyCompletions: [], workouts: [workout] };
    const session = { id: "s", planId: "p", planVersion: 1, workoutId: "A", workoutSnapshot: workout, status: "completed",
      startedAt: stamp, completedAt: "2026-10-03T08:30:00Z", localDate: "2026-10-03", blocks: [{ blockId: "a", completed: true }],
      queueOrder: ["a"], syncStatus: "notApplicable" };
    localStorage.setItem("treino-local:v2", JSON.stringify({ schemaVersion: 5, activePlanId: "p", plans: [plan], sessions: [session], exerciseNotes: [] }));
    const state = window as unknown as { shares: Array<{ text: string; files: number; active: boolean }>; reject: boolean };
    state.shares = []; state.reject = false;
    Object.defineProperty(navigator, "share", { configurable: true, value: async (data: ShareData) => {
      state.shares.push({ text: data.text ?? "", files: data.files?.length ?? 0, active: navigator.userActivation.isActive });
      if (state.reject) throw new DOMException("Cancelled", "AbortError");
    } });
  });
  await page.goto("/share/?id=s");
  await expect(page.getByRole("heading", { name: "Workout completed." })).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await expect(page.getByText(/Add photo|Change photo|Remove photo/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Download card|Save image/ })).toHaveCount(0);
  const message = page.getByRole("textbox", { name: /MESSAGE/ });
  await expect(message).toHaveValue(/Treino rápido 💪 completed/);
  await message.fill("My workout update 💪");
  await page.getByRole("button", { name: "Share workout" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { shares: unknown[] }).shares.length)).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { shares: unknown[] }).shares[0])).toEqual({ text: "My workout update 💪", files: 0, active: true });
  await page.getByRole("link", { name: "Not now" }).click();
  await page.locator(".history-card").first().click();
  await page.getByRole("link", { name: "Share workout" }).click();
  await expect(message).toHaveValue(/Treino rápido 💪 completed/);
  await page.evaluate(() => { (window as unknown as { reject: boolean }).reject = true; });
  await page.getByRole("button", { name: "Share workout" }).click();
  await expect(page.getByText("Share cancelled. Your workout remains saved.")).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("treino-local:v2")!).sessions[0].status)).toBe("completed");
});
