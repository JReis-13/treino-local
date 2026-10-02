import { expect, test } from "@playwright/test";

test("public routes render and navigation stays responsive without changing user data", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const route of ["/", "/plans", "/history", "/source", "/workout", "/finish", "/debug"]) {
    const response = await page.goto(route);
    expect(response?.status(), route).toBe(200);
    await expect(page.locator("main")).toBeVisible();
  }
  await page.goto("/");
  await page.getByRole("link", { name: "Plans", exact: true }).click();
  await expect(page).toHaveURL(/\/plans\/?$/);
  await page.getByRole("link", { name: "History", exact: true }).click();
  await expect(page).toHaveURL(/\/history\/?$/);
  expect(errors).toEqual([]);
});
