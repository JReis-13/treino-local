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

test("Finish uses only final same-day IDs for social Add and Replace; Cancel and double tap publish nothing extra", async ({ page }) => {
  await seedPlan(page);
  const posts: Array<Record<string, string>> = [];
  await page.route("**/api/social/**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path.endsWith("/me")) return route.fulfill({ json: { email: "a@example.com", accountId: "account-a",
      displayName: "A", sharingEnabled: true } });
    if (path.endsWith("/activities") && request.method() === "POST") {
      posts.push(request.postDataJSON());
      return route.fulfill({ json: { ok: true } });
    }
    if (path.endsWith("/home")) return route.fulfill({ json: { friendCount: 0, activities: [], received: [] } });
    return route.fulfill({ json: { friends: [] } });
  });
  const begin = async () => {
    await page.goto("/");
    await page.getByRole("button", { name: "Start workout" }).click();
    await page.getByRole("link", { name: /Finish workout/ }).click();
  };
  await begin();
  await page.getByRole("button", { name: /Save workout/ }).dblclick();
  await expect.poll(() => posts.length).toBe(1);
  const firstId = posts[0].clientSessionId;
  await begin();
  await page.getByRole("button", { name: /Save workout/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(posts).toHaveLength(1);
  await page.getByRole("button", { name: "Cancel" }).click();
  expect(posts).toHaveLength(1);
  await page.getByRole("button", { name: /Save workout/ }).click();
  await page.getByRole("button", { name: /Add another workout/ }).dblclick();
  await expect.poll(() => posts.length).toBe(2);
  const secondId = posts[1].clientSessionId;
  expect(secondId).not.toBe(firstId);
  await begin();
  await page.getByRole("button", { name: /Save workout/ }).click();
  await page.getByLabel("SESSION TO REPLACE").selectOption(firstId);
  await page.getByRole("button", { name: /Replace previous workout/ }).dblclick();
  await expect.poll(() => posts.length).toBe(3);
  expect(posts[2].clientSessionId).toBe(firstId);
  expect(posts[2].completedAt).not.toBe(posts[0].completedAt);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("treino-local:v2")!));
  expect(saved.sessions.filter((item: { status: string }) => item.status === "completed")).toHaveLength(2);
  expect(new Set(saved.sessions.map((item: { id: string }) => item.id))).toEqual(new Set([firstId, secondId]));
});

test("a pending social outbox item survives app reload and publishes once after reconnection", async ({ page }) => {
  await seedPlan(page);
  await page.addInitScript(() => {
    if (localStorage.getItem("social-reload-seeded")) return;
    localStorage.setItem("social-reload-seeded", "1");
    localStorage.setItem("treino-social-preference-v1", JSON.stringify({ email: "a@example.com",
      accountId: "account-a", sharingEnabled: true }));
    localStorage.setItem("treino-social-outbox-v1", JSON.stringify([{ ownerEmail: "a@example.com", ownerAccountId: "account-a",
      activity: { clientSessionId: "offline-session", workoutName: "Workout A", completedAt: "2026-10-04T08:40:00.000Z",
        localDate: "2026-10-04", durationMinutes: 40, completedExercises: 1, totalExercises: 3 } }]));
  });
  let posts = 0;
  await page.route("**/api/social/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/me")) return route.fulfill({ json: { email: "a@example.com", accountId: "account-a",
      displayName: "A", sharingEnabled: true } });
    if (path.endsWith("/activities")) { posts++; return route.fulfill({ json: { ok: true } }); }
    return route.fulfill({ json: { friendCount: 0, activities: [], received: [] } });
  });
  await page.goto("/");
  await expect.poll(() => posts).toBe(1);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("treino-social-outbox-v1") ?? "[]").length)).toBe(0);
  await page.reload();
  await expect(page.getByRole("region", { name: "Friends" })).toBeVisible();
  expect(posts).toBe(1);
});

test("migrated phone History with an old workout ID opens the real Add/Replace dialog", async ({ page }) => {
  await page.addInitScript((base) => {
    if (localStorage.getItem("treino-local:v2")) return;
    const now = new Date();
    const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const oldWorkout = { ...base.plans[0].workouts[0], id: "OLD123" };
    const plan = { ...base.plans[0], version: 2, workouts: [{ ...base.plans[0].workouts[0], id: "NEW456" }] };
    const prior = { id: "S1", planId: "p", planVersion: 1, workoutId: "OLD123", workoutSnapshot: oldWorkout,
      status: "completed", startedAt: new Date(now.getTime() - 90 * 60000).toISOString(),
      completedAt: new Date(now.getTime() - 50 * 60000).toISOString(), localDate,
      blocks: oldWorkout.blocks.map((block) => ({ blockId: block.id, completed: true })), syncStatus: "notApplicable" };
    localStorage.setItem("treino-local:v2", JSON.stringify({ ...base, schemaVersion: 3, plans: [plan], sessions: [prior] }));
  }, seed);
  await page.goto("/");
  await page.getByRole("button", { name: "Start workout" }).click();
  await page.getByRole("checkbox", { name: "Complete Squat" }).click();
  await page.getByRole("link", { name: /Finish workout/ }).click();
  await page.getByRole("button", { name: /Save workout/ }).click();
  await expect(page.getByRole("dialog", { name: /already saved Workout A/ })).toBeVisible();
  await page.getByRole("button", { name: /Add another workout/ }).click();
  await page.goto("/history/");
  await expect(page.locator(".history-list a.history-card")).toHaveCount(2);
  await page.goto("/");
  await page.getByRole("button", { name: "Start workout" }).click();
  await page.getByRole("link", { name: /Finish workout/ }).click();
  await page.getByRole("button", { name: /Save workout/ }).click();
  await page.getByLabel("SESSION TO REPLACE").selectOption("S1");
  await page.getByRole("button", { name: /Replace previous workout/ }).click();
  await page.goto("/history/");
  await expect(page.locator(".history-list a.history-card")).toHaveCount(2);
});

test("manual Share with friends publishes one session while automatic sharing stays off", async ({ page }) => {
  await seedPlan(page);
  let activityId: string | null = null;
  let manualPosts = 0;
  await page.route("**/api/social/**", (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname.endsWith("/me")) return route.fulfill({ json: { email: "a@example.com", accountId: "account-a",
      displayName: "A", sharingEnabled: false } });
    if (url.pathname.endsWith("/activities") && request.method() === "GET")
      return route.fulfill({ json: { activityId, shared: Boolean(activityId) } });
    if (url.pathname.endsWith("/activities") && request.method() === "POST") {
      const body = request.postDataJSON();
      expect(body.manualShare).toBe(true);
      expect(JSON.stringify(body)).not.toContain("actualLoad");
      expect(JSON.stringify(body)).not.toContain("sessionNote");
      manualPosts++;
      activityId = "22222222-2222-4222-8222-222222222222";
      return route.fulfill({ json: { ok: true, activityId } });
    }
    return route.fulfill({ json: { friendCount: 0, activities: [], received: [] } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Start workout" }).click();
  await page.getByRole("link", { name: /Finish workout/ }).click();
  await page.getByRole("button", { name: /Save workout/ }).click();
  await expect(page.getByRole("region", { name: "Friends sharing" })).toContainText("Friends sharing is off");
  expect(manualPosts).toBe(0);
  await page.getByRole("button", { name: "Share with friends" }).click();
  await expect(page.getByRole("region", { name: "Friends sharing" })).toContainText("Shared with friends");
  expect(manualPosts).toBe(1);
  await page.goto("/history/");
  await page.locator(".history-list a.history-card").first().click();
  await expect(page.getByRole("region", { name: "Friends sharing" })).toContainText("Shared with friends");
  expect(manualPosts).toBe(1);
});

test("phone diagnostics explains a migrated same-day match without copying loads or notes", async ({ page }) => {
  await page.addInitScript((base) => {
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const oldWorkout = { ...base.plans[0].workouts[0], id: "OLD123" };
    const currentWorkout = { ...base.plans[0].workouts[0], id: "NEW456" };
    const prior = { id: "S1", planId: "p", planVersion: 1, workoutId: "OLD123", workoutSnapshot: oldWorkout,
      status: "completed", startedAt: new Date(now.getTime() - 90 * 60000).toISOString(),
      completedAt: new Date(now.getTime() - 50 * 60000).toISOString(), localDate: date,
      blocks: [{ blockId: "a", completed: true, actualLoad: "PRIVATE_LOAD_99" }],
      sessionNote: "PRIVATE_NOTE_99", syncStatus: "notApplicable" };
    const active = { ...prior, id: "S2", planVersion: 2, workoutId: "NEW456", workoutSnapshot: currentWorkout,
      status: "inProgress", completedAt: undefined, localDate: undefined, sessionNote: undefined };
    localStorage.setItem("treino-local:v2", JSON.stringify({ ...base, schemaVersion: 4,
      plans: [{ ...base.plans[0], version: 2, workouts: [currentWorkout] }], sessions: [active, prior] }));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (value: string) => { (window as unknown as { copiedReport: string }).copiedReport = value; },
    } });
  }, seed);
  await page.goto("/debug/");
  await expect(page.getByText("MATCH_UNIQUE_TITLE")).toBeVisible();
  await page.getByRole("button", { name: "Copy diagnostics" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { copiedReport?: string }).copiedReport)).toContain("MATCH_UNIQUE_TITLE");
  const report = await page.evaluate(() => (window as unknown as { copiedReport: string }).copiedReport);
  expect(report).toContain("MATCH_UNIQUE_TITLE");
  expect(report).not.toContain("PRIVATE_LOAD_99");
  expect(report).not.toContain("PRIVATE_NOTE_99");
});
