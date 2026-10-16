import { expect, test, type Page } from "@playwright/test";

const blocks = Array.from({ length: 15 }, (_, i) => ({ kind: "exercise", id: `b${i}`, section: "Strength",
  name: `Exercise ${i + 1}`, prescription: "3 × 10", defaultLoad: "10" }));
const workout = { id: "A", title: "Workout A", description: "", blocks };
const plan = { id: "P", name: "Synthetic plan", source: { kind: "builtin", label: "Local" }, version: 1,
  importedAt: "2026-10-01T08:00:00Z", updatedAt: "2026-10-01T08:00:00Z", importWarnings: [], legacyCompletions: [], workouts: [workout] };
const session = { id: "S", planId: "P", planVersion: 1, workoutId: "A", workoutSnapshot: workout, status: "inProgress",
  startedAt: "2026-10-03T08:00:00Z", blocks: blocks.map((b) => ({ blockId: b.id, completed: false, actualLoad: "10" })), syncStatus: "notApplicable" };
async function seed(page: Page, value: unknown) {
  await page.addInitScript((data) => { if (!localStorage.getItem("treino-local:v2"))
    localStorage.setItem("treino-local:v2", JSON.stringify(data)); }, value);
}
const data = { schemaVersion: 5, activePlanId: "P", plans: [plan], exerciseNotes: [], sessions: [session] };
test.beforeEach(async ({ page }) => {
  await page.route("**/api/social/**", (r) => r.fulfill({ status: 401, json: { error: "Not connected" } }));
  await page.route("**/api/google/auth/status", (r) => r.fulfill({ json: { connected: false } }));
});

test("long List keeps navigation reachable, load information and completion safeguards", async ({ page }, info) => {
  await seed(page, data);
  for (const width of [320, 393]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/workout/?id=A");
    await expect(page.locator(".exercise-card")).toHaveCount(15);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(height).toBeLessThan(4000);
    await info.attach(`list-metrics-${width}`, { body: JSON.stringify({ width, height }), contentType: "application/json" });
    await page.screenshot({ path: info.outputPath(`list-${width}.png`), fullPage: true });
    await page.getByLabel("Workout options").click();
    await page.getByLabel("Jump to exercise").selectOption("b14");
    const target = page.locator("#exercise-b14");
    await expect(target).toBeFocused();
    const header = await page.locator(".active-workout-header").boundingBox();
    const card = await target.boundingBox();
    expect(header!.y).toBeLessThanOrEqual(1);
    expect(card!.y).toBeGreaterThanOrEqual(header!.height);
    await expect(target).toContainText("Current plan");
    await expect(target.getByRole("textbox")).toHaveValue("10");
    for (const control of [target.getByRole("checkbox"), target.getByRole("textbox"), target.getByRole("button", { name: "Details" })])
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: info.outputPath(`jump-${width}.png`) });
  }
  await page.getByRole("link", { name: /Finish workout/ }).click();
  await expect(page.getByRole("button", { name: /Save workout/ })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: /Save this session with no completed exercises/ })).toBeVisible();
});

test("Friends auth is distinct from confirmed empty and failed network requests", async ({ page }, info) => {
  await seed(page, data);
  await page.goto("/friends/");
  await expect(page.locator(".friends-directory")).toContainText("Sign in with Google");
  await expect(page.getByText("No connected friends yet.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry friends list" })).toHaveCount(0);
  for (const width of [320, 393]) {
    await page.setViewportSize({ width, height: 844 });
    await page.screenshot({ path: info.outputPath(`friends-auth-${width}.png`), fullPage: true });
  }
  let mode = "error";
  await page.route("**/api/social/**", (r) => {
    const path = new URL(r.request().url()).pathname;
    if (mode === "error") return r.fulfill({ status: 503, json: { error: "Unavailable" } });
    return r.fulfill({ json: path.endsWith("/me") ? { email: "user@example.invalid", accountId: "test", sharingEnabled: false } :
      path.endsWith("/home") ? { activities: [], received: [], friendCount: 0 } : { friends: [] } });
  });
  await page.reload();
  await expect(page.locator(".friends-directory")).toContainText("Could not load your friends");
  await expect(page.getByText("No connected friends yet.")).toHaveCount(0);
  mode = "ready";
  await page.getByRole("button", { name: "Retry friends list" }).click();
  await expect(page.getByText("No connected friends yet.")).toBeVisible();
  await expect(page.locator(".friends-directory").getByRole("button", { name: "Retry friends list" })).toHaveCount(0);
});

test("Friends distinguishes initial loading from background refresh and retains only account-confirmed cache", async ({ page }) => {
  await seed(page, data);
  let mode = "slow";
  let release: (() => void) | undefined;
  await page.route("**/api/social/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (mode === "auth") return route.fulfill({ status: 401, json: { error: "Sign in required" } });
    if (path.endsWith("/me")) return route.fulfill({ json: { email: "user@example.invalid", accountId: "test", sharingEnabled: false } });
    if (path.endsWith("/home")) return route.fulfill({ json: { activities: [], received: [], friendCount: 1 } });
    if (path.endsWith("/friends")) {
      if (mode === "slow") await new Promise<void>((resolve) => { release = resolve; });
      if (mode === "error" || mode === "auth") return route.fulfill({ status: mode === "auth" ? 401 : 503, json: { error: "Unavailable" } });
      return route.fulfill({ json: { friends: [{ id: "friend", displayName: "Synthetic friend", email: "friend@example.invalid", status: "accepted", direction: "incoming" }] } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto("/friends/");
  await expect(page.locator(".friends-directory")).toContainText("Loading your friends");
  await expect.poll(() => Boolean(release)).toBe(true);
  mode = "ready"; release!();
  await expect(page.locator(".friends-directory")).toContainText("Synthetic friend");
  await page.getByRole("navigation").getByRole("link", { name: "History", exact: true }).click();
  mode = "slow"; release = undefined;
  await page.getByRole("navigation").getByRole("link", { name: "Friends", exact: true }).click();
  await expect(page.locator(".friends-directory")).toContainText("Updating the list");
  await expect(page.locator(".friends-directory")).toContainText("Synthetic friend");
  await expect.poll(() => Boolean(release)).toBe(true);
  mode = "error"; release!();
  await expect(page.locator(".friends-directory")).toContainText("Showing the last confirmed friends");
  await expect(page.locator(".friends-directory")).toContainText("Synthetic friend");
  mode = "auth";
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.locator(".friends-directory")).toContainText("Sign in with Google");
  await expect(page.locator(".friends-directory")).not.toContainText("Synthetic friend");
});

test("Statistics chooses recorded loads while retaining explicit selection and truthful empty history", async ({ page }, info) => {
  const completed = { ...session, status: "completed", completedAt: "2026-10-03T08:40:00Z", localDate: "2026-10-03",
    blocks: [{ blockId: "b0", completed: true }, { blockId: "b1", completed: true, actualLoad: "12" }] };
  await seed(page, { ...data, sessions: [completed] });
  await page.goto("/stats/");
  await expect(page.getByRole("combobox", { name: /^EXERCISE/ })).toHaveValue("P|b1");
  await expect(page.locator(".load-summary-grid")).toContainText("12");
  for (const width of [320, 393]) {
    await page.setViewportSize({ width, height: 844 });
    await page.screenshot({ path: info.outputPath(`stats-${width}.png`), fullPage: true });
  }
  await page.getByRole("combobox", { name: /^EXERCISE/ }).selectOption("P|b0");
  await expect(page.getByText("No recorded loads for this exercise in this period.")).toBeVisible();
  await page.getByLabel("RANGE").selectOption("3m");
  await expect(page.getByRole("combobox", { name: /^EXERCISE/ })).toHaveValue("P|b0");
  await page.evaluate(() => { const d = JSON.parse(localStorage.getItem("treino-local:v2")!);
    d.sessions[0].blocks.forEach((b: { actualLoad?: string }) => delete b.actualLoad); localStorage.setItem("treino-local:v2", JSON.stringify(d)); });
  await page.reload();
  await expect(page.getByText("No recorded loads for this exercise in this period.")).toBeVisible();
  await expect(page.locator(".load-summary-grid")).toHaveCount(0);
});

test("History provenance counts a source-linked October 3 local session once and survives reload", async ({ page }, info) => {
  const dates = ["2026-09-12", "2026-09-19", "2026-09-26", "2026-10-03", "2026-10-10"];
  const legacy = dates.map((date, i) => ({ id: `A:E${i + 5}:${date}`, workoutId: "A", date, sourceSlot: `E${i + 5}` }));
  const linked = { ...session, status: "completed", completedAt: "2026-10-03T08:40:00Z", localDate: "2026-10-03", syncStatus: "synced",
    completionReceipt: { sourceKind: "excel", sourceId: "synthetic", workoutId: "A", slot: "E8", syncedAt: "2026-10-03T08:40:00Z" } };
  await seed(page, { ...data, plans: [{ ...plan, legacyCompletions: legacy }], sessions: [linked] });
  await page.goto("/history/");
  await expect(page.locator(".history-total strong")).toHaveText("5");
  await expect(page.locator(".history-provenance")).toContainText("4 imported source dates · 1 local completed sessions");
  await expect(page.locator(".history-card")).toHaveCount(5);
  for (const width of [320, 393]) {
    await page.setViewportSize({ width, height: 844 });
    await page.screenshot({ path: info.outputPath(`history-${width}.png`), fullPage: true });
  }
  await page.reload();
  await expect(page.locator(".history-total strong")).toHaveText("5");
  const records = await page.evaluate(() => JSON.parse(localStorage.getItem("treino-local:v2")!).sessions);
  expect(records).toHaveLength(1);
  expect(records[0].localDate).toBe("2026-10-03");
});

test("Excel and Google disabled sync explain the next step without writing", async ({ page }, info) => {
  let writes = 0;
  await page.route("**/api/google/sheets/**", (r) => { if (r.request().method() !== "GET") writes++; return r.fulfill({ json: {} }); });
  await seed(page, { ...data, sessions: [], plans: [{ ...plan, source: { kind: "excel", filename: "Synthetic.xlsx", template: "test", mappings: {}, mode: "copy" } }] });
  await page.goto("/source/");
  await expect(page.getByText("LOCALLY IMPORTED EXCEL", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Save updated workbook copy/ })).toBeDisabled();
  await expect(page.locator("#source-next-step")).toContainText("Finish a workout");
  await expect(page.locator(".connection-card")).toContainText("does not overwrite the original");
  for (const width of [320, 393]) {
    await page.setViewportSize({ width, height: 844 });
    await page.screenshot({ path: info.outputPath(`excel-${width}.png`), fullPage: true });
  }
  await page.evaluate(() => { const d = JSON.parse(localStorage.getItem("treino-local:v2")!);
    d.sessions = [{ ...d.plans[0].workouts[0], id: "S", planId: "P", planVersion: 1, workoutId: "A", workoutSnapshot: d.plans[0].workouts[0],
      status: "completed", blocks: [], startedAt: "2026-10-03T08:00:00Z", completedAt: "2026-10-03T08:40:00Z", localDate: "2026-10-03", syncStatus: "pending" }];
    localStorage.setItem("treino-local:v2", JSON.stringify(d)); });
  await page.reload();
  await expect(page.locator("#source-next-step")).toContainText("Connect the original workbook");
  await page.evaluate(() => { const d = JSON.parse(localStorage.getItem("treino-local:v2")!);
    d.plans[0].source = { kind: "google", filename: "Synthetic Sheet", template: "test", mappings: {}, authMode: "oauth", syncEnabled: true };
    localStorage.setItem("treino-local:v2", JSON.stringify(d)); });
  await page.reload();
  await expect(page.getByRole("button", { name: /Sync pending workouts/ })).toBeDisabled();
  await expect(page.locator("#source-next-step")).toContainText("Reconnect Google above");
  expect(writes).toBe(0);
});
