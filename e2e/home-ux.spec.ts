import { expect, test } from "@playwright/test";

const base = { schemaVersion: 5, activePlanId: "home-plan", exerciseNotes: [], sessions: [], plans: [{
  id: "home-plan", name: "Training Alpha", source: { kind: "builtin", label: "Local" }, version: 1,
  importedAt: "2026-10-01T08:00:00Z", updatedAt: "2026-10-01T08:00:00Z", importWarnings: [], legacyCompletions: [],
  workouts: ["A", "B"].map((id) => ({ id, title: `Workout ${id}`, description: "Full body training", blocks: [
    { kind: "exercise", id: `${id}-squat`, section: "Strength", name: "Squat", prescription: "3 × 10" },
  ] })),
}] };

test("Home places Friends between Current Training and workout choice on four phone widths", async ({ page }, testInfo) => {
  await page.addInitScript((data) => { localStorage.setItem("treino-local:v2", JSON.stringify(data)); }, base);
  await page.route("**/api/social/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/me")) return route.fulfill({ json: { email: "a@example.invalid", displayName: "A", accountId: "account-a", sharingEnabled: true } });
    if (url.pathname.endsWith("/home")) return route.fulfill({ json: { friendCount: 1, activities: [{
      id: "friend-activity", displayName: "Milena", workoutName: "Workout B", localDate: "2026-10-05",
      completedAt: "2026-10-05T18:00:00Z", durationMinutes: 47, completedExercises: 7, totalExercises: 7,
      reactions: { "🔥": 2 }, myReaction: null,
    }], received: [] } });
    return route.fulfill({ json: { friends: [] } });
  });
  for (const [label, width, height] of [["narrow", 320, 640], ["pixel", 412, 915],
    ["android", 393, 873], ["wide", 430, 932], ["iphone", 390, 844]] as const) {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await expect(page.getByRole("region", { name: "Friends" })).toContainText("Milena");
    await expect(page.getByRole("button", { name: "Start workout" }).first()).toBeVisible();
    const order = await page.locator(".home-page").evaluate((home) => {
      const selectors = [".current-training-hero", ".social-home-card", ".section-heading", ".workout-tile"];
      return selectors.map((selector) => Array.from(home.children).findIndex((child) => child.matches(selector) ||
        (selector === ".workout-tile" && child.querySelector(selector))));
    });
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((index) => index >= 0)).toBe(true);
    const cards = page.locator(".workout-tile");
    await expect(cards).toHaveCount(2);
    const sizes = await cards.locator("h3").evaluateAll((headings) => headings.map((heading) =>
      getComputedStyle(heading).fontSize));
    expect(sizes[0]).toBe(sizes[1]);
    await expect(page.locator(".current-training-hero .hero-manage-link")).toBeVisible();
    await expect(page.locator(".home-page .source-choice-card")).toHaveCount(0);
    await expect(page.locator(".home-page .mini-panel")).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`home-${label}.png`), fullPage: true, animations: "disabled" });
  }
});

test("compact Friends handles received reaction, empty state and API failure without blocking workouts", async ({ page }, testInfo) => {
  await page.addInitScript((data) => { localStorage.setItem("treino-local:v2", JSON.stringify(data)); }, base);
  let mode: "reaction" | "empty" | "failure" = "reaction";
  await page.route("**/api/social/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/me")) return route.fulfill({ json: { email: "a@example.invalid", displayName: "A", accountId: "account-a", sharingEnabled: true } });
    if (path.endsWith("/home")) return mode === "failure" ? route.fulfill({ status: 503, json: { error: "Unavailable" } }) :
      route.fulfill({ json: { friendCount: 1, activities: [], received: mode === "reaction" ? [
        { displayName: "Milena", emoji: "🔥", workoutName: "Workout A" }] : [] } });
    return route.fulfill({ json: { friends: [] } });
  });
  for (const state of ["reaction", "empty", "failure"] as const) {
    mode = state;
    await page.goto("/");
    const friends = page.getByRole("region", { name: "Friends" });
    await expect(friends).toContainText(state === "reaction" ? "reacted" : state === "empty" ? "no recent workouts" : "temporarily unavailable");
    await expect(page.getByRole("button", { name: "Start workout" }).first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`friends-${state}.png`), animations: "disabled" });
  }
});
