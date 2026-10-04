import { expect, test, type Page } from "@playwright/test";

const workout = { id: "A", title: "Workout A", description: "", restNote: "2 min rest", blocks: [
  { kind: "exercise", id: "a", section: "Strength", name: "Squat", prescription: "3 × 10", defaultLoad: "10 kg" },
  { kind: "exercise", id: "b", section: "Strength", name: "Row", prescription: "3 × 10" },
  { kind: "exercise", id: "c", section: "Strength", name: "Press", prescription: "3 × 10" },
] };
const plan = { id: "p", name: "Test plan", source: { kind: "builtin", label: "Local" }, version: 1,
  importedAt: "2026-10-04T08:00:00Z", updatedAt: "2026-10-04T08:00:00Z", importWarnings: [], legacyCompletions: [], workouts: [workout] };
const seed = { schemaVersion: 5, activePlanId: "p", plans: [plan], exerciseNotes: [], sessions: [], restTimer: undefined };
const friendshipId = "11111111-1111-4111-8111-111111111111";
const activityId = "22222222-2222-4222-8222-222222222222";

async function seedPlan(page: Page) {
  await page.addInitScript((value) => { if (!localStorage.getItem("treino-local:v2")) localStorage.setItem("treino-local:v2", JSON.stringify(value)); }, seed);
}

test("List and Focus share the compact header; cancellation keeps or discards only the active workout", async ({ page }) => {
  await seedPlan(page);
  let publishes = 0, sourceWrites = 0;
  await page.route("**/api/social/activities", (route) => { publishes++; return route.fulfill({ json: { ok: true } }); });
  await page.route("**/api/google/sheets/register-completion", (route) => { sourceWrites++; return route.fulfill({ json: { ok: true } }); });
  await page.goto("/");
  await page.getByRole("button", { name: "Start workout" }).click();
  await expect(page.locator(".active-workout-header")).toBeVisible();
  await expect(page.locator(".site-shell .topbar")).toBeHidden();
  const before = await page.locator(".active-workout-header").boundingBox();
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  const after = await page.locator(".active-workout-header").boundingBox();
  expect(after?.height).toBe(before?.height);
  const complete = page.getByRole("button", { name: "Mark complete" });
  const size = await complete.boundingBox();
  expect(size?.height).toBeGreaterThanOrEqual(44);
  expect(size?.height).toBeLessThanOrEqual(50);
  await page.getByRole("button", { name: "List", exact: true }).click();
  await page.getByRole("textbox", { name: "Actual load for Squat" }).fill("22 kg");
  await page.getByRole("checkbox", { name: "Complete Squat" }).click();
  await page.locator(".exercise-card").filter({ hasText: "Row" }).locator("summary", { hasText: "More" }).click();
  await page.getByRole("button", { name: "Skip today" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Skip today" }).click();
  await page.locator(".exercise-card").filter({ hasText: "Press" }).locator("summary", { hasText: "More" }).click();
  await page.getByRole("button", { name: "Do later" }).click();
  await page.locator(".exercise-card.is-complete").getByRole("button", { name: /Start 2:00/ }).click();
  await expect(page.locator(".rest-timer-bar")).toBeVisible();
  await page.getByLabel("Workout options").click();
  await page.getByRole("button", { name: "Cancel workout" }).click();
  await expect(page.getByRole("dialog", { name: "Cancel this workout?" })).toBeVisible();
  await page.getByRole("button", { name: "Keep workout" }).click();
  await expect(page.locator(".rest-timer-bar")).toBeVisible();
  await expect(page.locator(".exercise-card.is-complete")).toHaveCount(1);
  await page.getByLabel("Workout options").click();
  await page.getByRole("button", { name: "Cancel workout" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel workout" }).click();
  await expect(page).toHaveURL(/\/$/);
  const data = await page.evaluate(() => JSON.parse(localStorage.getItem("treino-local:v2")!));
  expect(data.sessions).toHaveLength(0);
  expect(data.restTimer).toBeUndefined();
  expect(data.plans[0].workouts[0].blocks[0].defaultLoad).toBe("10 kg");
  expect(publishes).toBe(0);
  expect(sourceWrites).toBe(0);
  await page.getByRole("button", { name: "Start workout" }).click();
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await page.getByLabel("Workout options").click();
  await page.getByRole("button", { name: "Cancel workout" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel workout" }).click();
  await expect(page).toHaveURL(/\/$/);
  expect((await page.evaluate(() => JSON.parse(localStorage.getItem("treino-local:v2")!))).sessions).toHaveLength(0);
});

test("two phone users request, accept, share one workout, react and see the received reaction", async ({ page, browser }) => {
  await seedPlan(page);
  const other = await browser.newContext();
  const pageB = await other.newPage();
  const state: { status: "none" | "pending" | "accepted"; sharing: boolean; activity: null | Record<string, unknown>; reaction: string | null } =
    { status: "none", sharing: false, activity: null, reaction: null };
  const routeFor = (who: "A" | "B") => async (route: import("@playwright/test").Route) => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
    const body = request.postDataJSON() ?? {};
    const send = (value: object, status = 200) => route.fulfill({ status, json: value });
    if (path.endsWith("/me")) {
      if (method === "PATCH") { if (who === "A" && typeof body.sharingEnabled === "boolean") state.sharing = body.sharingEnabled; }
      return send({ email: who === "A" ? "a@example.com" : "b@example.com", displayName: who, sharingEnabled: who === "A" && state.sharing });
    }
    if (path.endsWith("/friends")) {
      if (method === "POST") state.status = "pending";
      if (method === "PATCH" && body.action === "accept") state.status = "accepted";
      const friends = state.status === "none" ? [] : [{ id: friendshipId, status: state.status,
        direction: who === "A" ? "outgoing" : "incoming", displayName: who === "A" ? "B" : "A", email: who === "A" ? "b@example.com" : "a@example.com" }];
      return send({ friends });
    }
    if (path.endsWith("/activities") && method === "POST") { state.activity = body; return send({ ok: true }); }
    if (path.includes("/reaction")) { state.reaction = method === "DELETE" ? null : body.emoji; return send({ ok: true }); }
    if (path.endsWith("/home")) {
      const activity = who === "B" && state.status === "accepted" && state.sharing && state.activity ? [{ id: activityId,
        displayName: "A", workoutName: state.activity.workoutName, completedAt: state.activity.completedAt,
        localDate: state.activity.localDate, durationMinutes: state.activity.durationMinutes,
        completedExercises: state.activity.completedExercises, totalExercises: state.activity.totalExercises,
        reactions: state.reaction ? { [state.reaction]: 1 } : {}, myReaction: state.reaction }] : [];
      return send({ friendCount: state.status === "accepted" ? 1 : 0, activities: activity,
        received: who === "A" && state.reaction ? [{ displayName: "B", emoji: state.reaction, workoutName: "Workout A" }] : [] });
    }
    return send({ error: "Not found" }, 404);
  };
  await page.route("**/api/social/**", routeFor("A"));
  await pageB.route("**/api/social/**", routeFor("B"));
  try {
    await page.goto("/settings/friends/");
    await page.getByRole("checkbox", { name: /Share completed workouts/ }).check();
    await page.getByRole("textbox", { name: "GOOGLE EMAIL" }).fill("b@example.com");
    await page.getByRole("button", { name: "Send request" }).click();
    await pageB.goto("/settings/friends/");
    await pageB.getByRole("button", { name: "Accept" }).click();
    await page.goto("/");
    await page.getByRole("button", { name: "Start workout" }).click();
    await page.getByRole("link", { name: /Finish workout/ }).click();
    await page.getByRole("button", { name: /Save workout/ }).click();
    await expect.poll(() => state.activity?.workoutName).toBe("Workout A");
    expect(JSON.stringify(state.activity)).not.toContain("actualLoad");
    await pageB.goto("/");
    await expect(pageB.getByText("Workout A ·", { exact: false })).toBeVisible();
    await pageB.getByRole("button", { name: "React with fire" }).click();
    await expect.poll(() => state.reaction).toBe("🔥");
    await page.goto("/");
    await expect(page.getByText("B reacted 🔥 to your Workout A")).toBeVisible();
  } finally { await other.close(); }
});
