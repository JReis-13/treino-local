import { expect, test } from "@playwright/test";

const friendId = "11111111-1111-4111-8111-111111111111";
const activity = (name: string, index = 0) => ({ id: `22222222-2222-4222-8222-22222222222${index}`,
  friendshipId: friendId, displayName: name, workoutName: index ? "Workout A" : "Workout B",
  completedAt: "2026-10-10T16:00:00.000Z", localDate: "2026-10-10", durationMinutes: 42,
  completedExercises: 7, totalExercises: 7, reactions: { "🔥": 1 }, myReaction: null });

test("Friends return shows cached content while refreshing, handles failure and isolates a changed account", async ({ page, context }, testInfo) => {
  let account = "a", mode: "normal" | "slow" | "failure" = "normal", homeRequests = 0;
  let release: (() => void) | undefined;
  await page.route("**/api/social/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/me")) return route.fulfill({ json: { email: `${account}@example.invalid`,
      displayName: account, accountId: account, sharingEnabled: true } });
    if (path.endsWith("/home")) {
      homeRequests++;
      if (mode === "slow") await new Promise<void>((resolve) => { release = resolve; });
      if (mode === "failure") return route.fulfill({ status: 503, json: { error: "Unavailable" } });
      return route.fulfill({ json: { friendCount: 1, activities: [activity(account === "a" ? "Cintia" : "New friend"),
        activity(account === "a" ? "Cintia" : "New friend", 1)], received: [] } });
    }
    if (path.endsWith("/friends")) return route.fulfill({ json: { friends: [{ id: friendId,
      displayName: account === "a" ? "Cintia" : "New friend", email: "friend@example.invalid", status: "accepted", direction: "incoming" }] } });
    if (path.endsWith("/history")) return route.fulfill({ json: { displayName: "Cintia", activities: [activity("Cintia")], nextCursor: null } });
    return route.fulfill({ json: {} });
  });
  await page.route("**/api/push/status", (route) => route.fulfill({ json: { configured: false } }));
  await page.goto("/friends/");
  await expect(page.locator(".social-activity")).toHaveCount(2);
  await expect(page.locator(".friends-directory")).toContainText("Cintia");
  expect(homeRequests).toBe(1);
  for (const width of [320, 393, 430, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav.getByRole("link", { name: "Friends", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link")).toHaveCount(5);
    const targets = await nav.getByRole("link").evaluateAll((links) => links.map((link) => ({
      width: link.getBoundingClientRect().width, height: link.getBoundingClientRect().height })));
    expect(targets.every((target) => target.width >= 44 && target.height >= 44)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`friends-${width}.png`), fullPage: true });
  }
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await nav.getByRole("link", { name: "History", exact: true }).click();
  mode = "slow";
  await nav.getByRole("link", { name: "Friends", exact: true }).click();
  await expect(page.locator(".social-activity")).toHaveCount(2);
  await expect(page.getByText("Loading friends…", { exact: true })).toHaveCount(0);
  await expect(page.locator(".social-updating")).toBeVisible();
  await expect.poll(() => Boolean(release)).toBe(true);
  expect(homeRequests).toBe(2);
  await page.screenshot({ path: testInfo.outputPath("friends-cached-return.png"), fullPage: true });
  mode = "normal"; release!();
  await expect(page.locator(".social-updating")).toHaveCount(0);
  mode = "failure";
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText("Could not update Friends. Showing the last confirmed activity.")).toBeVisible();
  await expect(page.locator(".social-activity")).toHaveCount(2);
  await context.setOffline(true);
  await expect(page.locator(".social-activity")).toHaveCount(2);
  await context.setOffline(false);
  mode = "normal";
  await page.locator(".friends-directory").getByRole("link", { name: /Cintia/ }).click();
  await expect(page.locator(".friend-history-list")).toContainText("Workout B");
  await page.screenshot({ path: testInfo.outputPath("friend-history.png"), fullPage: true });
  await page.getByRole("link", { name: "← Friends" }).click();
  await expect(page.locator(".social-activity")).toHaveCount(2);
  await page.goBack();
  await expect(page.locator(".friend-history-list")).toBeVisible();
  await page.goForward();
  await expect(page.locator(".social-activity")).toHaveCount(2);
  account = "b";
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.locator(".social-home-card")).toContainText("New friend");
  await expect(page.getByText("Cintia", { exact: true })).toHaveCount(0);
  await nav.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("link", { name: /Training plans/ }).click();
  await expect(page).toHaveURL(/\/plans\/?$/);
});

test("pending deletions belong in Friends management and Diagnostics retains consent and receipts", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem("treino-social-delete-outbox-v1", JSON.stringify([{ clientSessionId: "pending-session",
      ownerAccountId: "a", ownerEmail: "a@example.invalid", ready: true }, { clientSessionId: "other-session", ownerAccountId: "b", ready: true }]));
  });
  await page.route("**/api/social/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/me")) return route.fulfill({ json: { email: "a@example.invalid", displayName: "A", accountId: "a", sharingEnabled: true } });
    if (path.endsWith("/home")) return route.fulfill({ json: { activities: [], received: [], friendCount: 0 } });
    if (path.endsWith("/friends")) return route.fulfill({ json: { friends: [] } });
    return route.fulfill({ status: 503, json: { error: "Unavailable" } });
  });
  await page.route("**/api/push/status", (route) => route.fulfill({ json: { configured: false } }));
  await page.goto("/settings/friends/");
  await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Friends", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Pending Friends deletions" })).toBeVisible();
  await expect(page.getByText(/1 shared workout removal still await/)).toBeVisible();
  await page.getByRole("button", { name: "Retry pending removals" }).click();
  await expect(page.getByText("1 Friends deletion is still pending. Automatic retry remains active.")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("friends-pending-removal.png"), fullPage: true });
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Settings" }).click();
  await page.getByRole("link", { name: /Diagnostics/ }).click();
  await expect(page.getByRole("button", { name: /Retry pending/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send diagnostics" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download debug report" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("diagnostics-no-social-retry.png"), fullPage: true });
});
