import { expect, test } from "@playwright/test";

const friendshipId = "11111111-1111-4111-8111-111111111111";
const activities = [
  { id: "22222222-2222-4222-8222-222222222222", friendshipId, displayName: "Cintia",
    workoutName: "Workout B", completedAt: "2026-10-09T16:00:00.000Z", localDate: "2026-10-09",
    durationMinutes: 42, completedExercises: 7, totalExercises: 7, reactions: { "💪": 1 }, myReaction: null },
  { id: "33333333-3333-4333-8333-333333333333", friendshipId, displayName: "Cintia",
    workoutName: "Workout A", completedAt: "2026-10-08T15:00:00.000Z", localDate: "2026-10-08",
    durationMinutes: 38, completedExercises: 6, totalExercises: 6, reactions: { "🔥": 1 }, myReaction: "🔥" },
];

test("Friends latest and shared history stay linked on narrow phones, with reactions scoped by activity", async ({ page }, testInfo) => {
  let historyError = false;
  let historyEmpty = false;
  let historySlow = false;
  await page.route("**/api/social/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/me")) return route.fulfill({ json: { email: "me@example.invalid", accountId: "viewer",
      displayName: "Me", sharingEnabled: true } });
    if (path.endsWith("/home")) return route.fulfill({ json: { friendCount: 1, activities: [activities[0]],
      received: [{ displayName: "Cintia", emoji: "🔥", workoutName: "My workout" }] } });
    if (path.endsWith("/friends")) return route.fulfill({ json: { friends: [{ id: friendshipId,
      status: "accepted", direction: "incoming", displayName: "Cintia", email: "friend@example.invalid" }] } });
    if (path.endsWith("/history")) return (async () => {
      if (historySlow) await new Promise((resolve) => setTimeout(resolve, 800));
      return historyError ? route.fulfill({ status: 503, json: { error: "Temporarily unavailable" } }) :
        route.fulfill({ json: { displayName: "Cintia", activities: historyEmpty ? [] : activities, nextCursor: null } });
    })();
    if (path.endsWith("/reaction")) return route.fulfill({ json: { changed: true } });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.route("**/api/push/status", (route) => route.fulfill({ json: { configured: false, publicKey: null,
    friendWorkouts: true, reactions: true, deviceRegistered: false } }));
  await page.goto("/");
  const friends = page.getByRole("region", { name: "Friends" });
  await expect(friends).toContainText("Workout B");
  await expect(friends).toContainText("reacted");
  await friends.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("friends-home-latest.png"), animations: "disabled" });
  await friends.getByRole("link", { name: "View workouts" }).click();
  await expect(page).toHaveURL(new RegExp(`/friends/${friendshipId}/?$`));
  await expect(page.locator(".friend-history-list .social-activity")).toHaveCount(2);
  await expect(page.locator(".friend-history-list .social-activity").first()).toContainText("Workout B");
  await expect(page.locator(".friend-history-list .social-activity").first().getByRole("button", { name: "React with fire" }))
    .toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".friend-history-list .social-activity").last().getByRole("button", { name: "React with fire" }))
    .toHaveAttribute("aria-pressed", "true");
  for (const width of [320, 393, 430]) {
    await page.setViewportSize({ width, height: 850 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`friend-history-${width}.png`), animations: "disabled" });
  }
  await page.goto("/settings/friends/");
  await expect(page.getByText("Friends notifications")).toBeVisible();
  await page.getByText("Notifications on this device").scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("friends-settings-push.png"), animations: "disabled" });
  await page.getByRole("link", { name: "View workouts" }).click();
  await expect(page).toHaveURL(new RegExp(`/friends/${friendshipId}/?$`));
  historyError = true;
  await page.reload();
  await expect(page.locator(".friend-history-page .alert")).toContainText("Temporarily unavailable");
  await page.screenshot({ path: testInfo.outputPath("friend-history-error.png"), animations: "disabled" });
  historyError = false;
  historyEmpty = true;
  await page.reload();
  await expect(page.getByText("No shared workouts yet")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("friend-history-empty.png"), animations: "disabled" });
  historyEmpty = false;
  historySlow = true;
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("Loading shared workouts…")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("friend-history-loading.png"), animations: "disabled" });
});
