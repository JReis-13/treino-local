import { expect, type Locator } from "@playwright/test";

// Follow the same explicit save interaction as a user. Units stay in the adjacent label.
export async function saveLoad(input: Locator, value: string) {
  const editor = input.locator('xpath=ancestor::div[contains(@class,"load-editor")][1]');
  const unit = await editor.locator(".load-unit").count() ? (await editor.locator(".load-unit").innerText()).trim() : "";
  const numeric = /^([+-]?\d+(?:[.,]\d+)?)\s*(kg|lbs?|g)?$/i.exec(value);
  if (await input.getAttribute("inputmode") === "decimal" && numeric && (!numeric[2] || numeric[2].toLowerCase() === unit.toLowerCase()))
    await input.fill(numeric[1]);
  else if (await input.getAttribute("inputmode") === "decimal") {
    await input.fill(value);
    await editor.getByRole("button", { name: "Edit full expression", exact: true }).click();
    await input.fill(value);
  } else await input.fill(value);
  await editor.getByRole("button", { name: "Save load", exact: true }).click();
  await expect(editor.getByRole("status")).toContainText("Saved on this device");
}
