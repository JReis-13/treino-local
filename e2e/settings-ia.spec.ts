import { expect, test } from "@playwright/test";

test("Settings destinations are visible and browser Back restores the menu", async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("treino-local:v2", JSON.stringify({
    schemaVersion: 5, plans: [], sessions: [], exerciseNotes: [],
  })));
  await page.route("**/api/social/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/me")) return route.fulfill({ json: { email: "test@example.invalid", displayName: "Tester",
      accountId: "test-account", sharingEnabled: false } });
    return route.fulfill({ json: { friends: [] } });
  });
  await page.route("**/api/push/status", (route) => route.fulfill({ json: { configured: false, publicKey: null,
    friendWorkouts: true, reactions: true, deviceRegistered: false } }));
  await page.goto("/settings/");
  const menu = page.getByRole("navigation", { name: "Settings sections" });
  for (const label of ["Friends & Notifications", "Connections & Sync", "Data & Backup", "Diagnostics", "About"])
    await expect(menu.getByRole("link", { name: new RegExp(label) })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("settings-main.png"), animations: "disabled" });
  await menu.getByRole("link", { name: /Connections & Sync/ }).click();
  await expect(page.getByRole("heading", { name: /Connections & Sync/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Source sync and pending updates/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("settings-connections.png"), animations: "disabled" });
  await page.goBack();
  await expect(menu).toBeVisible();
  await menu.getByRole("link", { name: /Friends & Notifications/ }).click();
  await expect(page.getByRole("heading", { name: "Friends.", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Completed workouts" })).toBeVisible();
  await expect(page.getByText("Friends notifications")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("settings-friends.png"), animations: "disabled" });
  await page.goBack();
  await expect(menu).toBeVisible();
  await menu.getByRole("link", { name: /Diagnostics/ }).click();
  await expect(page.getByRole("button", { name: "Send diagnostics" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download debug report" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear local diagnostic log" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("settings-diagnostics.png"), animations: "disabled" });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
