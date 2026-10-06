import { expect, test, type Page } from "@playwright/test";

async function mockFriends(page: Page) {
  await page.route("**/api/social/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/me")) return route.fulfill({ json: { email: "a@example.invalid", displayName: "A",
      accountId: "a", sharingEnabled: true } });
    return route.fulfill({ json: { friends: [] } });
  });
}
function status(configured: boolean, deviceRegistered = false, friendWorkouts = true, reactions = true) {
  return { configured, publicKey: configured ? "test-public-key" : null, deviceRegistered, friendWorkouts, reactions };
}

test("Friends settings never asks notification permission on load; denied permission is calm", async ({ page }, testInfo) => {
  await mockFriends(page);
  await page.route("**/api/push/status", (route) => route.fulfill({ json: status(true) }));
  await page.addInitScript(() => {
    (window as unknown as { pushRequests: number }).pushRequests = 0;
    Object.defineProperty(Notification, "permission", { configurable: true, get: () => "default" });
    Object.defineProperty(Notification, "requestPermission", { configurable: true, value: async () => {
      (window as unknown as { pushRequests: number }).pushRequests++;
      Object.defineProperty(Notification, "permission", { configurable: true, get: () => "denied" });
      return "denied";
    } });
  });
  await page.goto("/settings/friends/");
  await expect(page.getByRole("button", { name: "Enable notifications" })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { pushRequests: number }).pushRequests)).toBe(0);
  await page.locator(".push-settings").screenshot({ path: testInfo.outputPath("push-default.png"), animations: "disabled" });
  await page.getByRole("button", { name: "Enable notifications" }).click();
  expect(await page.evaluate(() => (window as unknown as { pushRequests: number }).pushRequests)).toBe(1);
  await expect(page.getByText("Permission denied")).toBeVisible();
  await expect(page.getByText(/blocked for this site/)).toBeVisible();
  await page.locator(".push-settings").screenshot({ path: testInfo.outputPath("push-denied.png"), animations: "disabled" });
});

test("Friends settings shows unconfigured and unsupported states without prompting", async ({ page }, testInfo) => {
  await mockFriends(page);
  let configured = false;
  await page.route("**/api/push/status", (route) => route.fulfill({ json: status(configured) }));
  await page.addInitScript(() => { Object.defineProperty(window, "PushManager", { configurable: true, value: undefined }); });
  await page.goto("/settings/friends/");
  await expect(page.getByText("Notifications are not configured yet.")).toBeVisible();
  await page.locator(".push-settings").screenshot({ path: testInfo.outputPath("push-unconfigured.png"), animations: "disabled" });
  configured = true;
  await page.reload();
  await expect(page.getByText(/aren't available on this device\/browser/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Enable notifications" })).toHaveCount(0);
  await page.locator(".push-settings").screenshot({ path: testInfo.outputPath("push-unsupported.png"), animations: "disabled" });
});

test("enabled device and account preferences stay distinct", async ({ page }, testInfo) => {
  await mockFriends(page);
  let friendWorkouts = true, reactions = true;
  await page.route("**/api/push/status", (route) => route.fulfill({ json: status(true, true, friendWorkouts, reactions) }));
  await page.route("**/api/push/preferences", async (route) => {
    const body = route.request().postDataJSON() as { friendWorkouts: boolean; reactions: boolean };
    friendWorkouts = body.friendWorkouts; reactions = body.reactions;
    await route.fulfill({ json: { ok: true, friendWorkouts, reactions } });
  });
  await page.route("**/api/push/subscription", (route) => route.fulfill({ status: 503, json: { error: "Unavailable" } }));
  await page.addInitScript(() => {
    Object.defineProperty(Notification, "permission", { configurable: true, get: () => "granted" });
    (window as unknown as { fakePushSubscribed: boolean }).fakePushSubscribed = true;
    const original = navigator.serviceWorker.getRegistration.bind(navigator.serviceWorker);
    navigator.serviceWorker.getRegistration = async (...args) => {
      const registration = await original(...args);
      if (registration) Object.defineProperty(registration, "pushManager", { configurable: true,
        value: { getSubscription: async () => (window as unknown as { fakePushSubscribed: boolean }).fakePushSubscribed ?
          ({ unsubscribe: async () => { (window as unknown as { fakePushSubscribed: boolean }).fakePushSubscribed = false; return true; } }) : null } });
      return registration;
    };
  });
  await page.goto("/settings/friends/");
  await expect(page.getByText("Enabled", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Disable notifications on this device" })).toBeVisible();
  await page.locator(".push-settings").screenshot({ path: testInfo.outputPath("push-enabled.png"), animations: "disabled" });
  await page.getByRole("checkbox", { name: "Friend workouts" }).uncheck();
  await expect(page.getByRole("checkbox", { name: "Reactions" })).toBeChecked();
  await expect(page.getByRole("button", { name: "Disable notifications on this device" })).toBeVisible();
  await page.locator(".push-settings").screenshot({ path: testInfo.outputPath("push-one-preference-off.png"), animations: "disabled" });
  await page.getByRole("button", { name: "Disable notifications on this device" }).click();
  await expect(page.getByText("Not enabled", { exact: true })).toBeVisible();
  await expect(page.getByText(/Server cleanup will retry/)).toBeVisible();
});
