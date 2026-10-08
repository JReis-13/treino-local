import { expect, test } from "@playwright/test";

test.use({ timezoneId: "America/Los_Angeles" });

test("Diagnostics hydrates without local-date text mismatch across server and phone time zones", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/debug/");
  await expect(page.getByRole("heading", { name: "Diagnostics." })).toBeVisible();
  await expect(page.getByText(/Local date: \d{4}-\d{2}-\d{2}/)).toBeVisible();
  expect(errors).toEqual([]);
});
