import { expect, test } from "@playwright/test";

test("Diagnostics stays local when signed out, while Download remains available", async ({ page }) => {
  await page.goto("/settings/");
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: /Diagnostics/ }).tap();
  await expect(page.getByRole("button", { name: "Send diagnostics" })).toBeDisabled();
  await expect(page.getByText("Connect Google to send diagnostics.")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download debug report" }).tap();
  expect((await download).suggestedFilename()).toMatch(/^treino-local-debug-/);
});

test("Send diagnostics is explicit and presents a copyable short ID", async ({ page }) => {
  let uploads = 0;
  await page.route("**/api/google/auth/status", (route) => route.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ connected: true }) }));
  await page.route("**/api/support/diagnostics", async (route) => {
    uploads++;
    const body = route.request().postDataJSON();
    expect(body.debugReportVersion).toBe(1);
    expect(body).not.toHaveProperty("notes");
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ code: "TL-7K2M9QRS" }) });
  });
  await page.goto("/settings/");
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: /Diagnostics/ }).tap();
  await expect(page.getByRole("button", { name: "Send diagnostics" })).toBeEnabled();
  expect(uploads).toBe(0);
  await page.getByRole("button", { name: "Send diagnostics" }).tap();
  await expect(page.getByText("ID: TL-7K2M9QRS")).toBeVisible();
  await expect(page.getByText(/Stored privately for 14 days/)).toBeVisible();
  expect(uploads).toBe(1);
});
