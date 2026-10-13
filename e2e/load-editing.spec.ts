import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";

async function importAudit(page: Page) {
  await page.goto("/plans/?source=excel");
  await page.locator('input[type="file"]').setInputFiles(resolve("tests/fixtures/mobile-audit.xlsx"));
  await expect(page.getByRole("heading", { name: "Training ready", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Use this training/ }).click();
  await page.getByRole("button", { name: "Start workout", exact: true }).click();
  for (const name of ["Cloud Warmup", "Pixel Warmup", "Beacon Warmup"])
    await page.getByRole("checkbox", { name: `Complete ${name}`, exact: true }).click();
}
test.beforeEach(async ({ page }) => {
  await page.route("**/api/social/**", (r) => r.fulfill({ status: 401, json: { error: "Sign in required" } }));
  await page.route("**/api/google/auth/status", (r) => r.fulfill({ json: { connected: false } }));
  await page.route("**/api/push/status", (r) => r.fulfill({ json: { configured: false } }));
});

test("numeric units and composite expressions save explicitly, persist in History and become Last Used", async ({ page }, info) => {
  await importAudit(page);
  for (const [name, expected, updated, persisted] of [
    ["Nova Press", "12", "14,5", "14.5kg"], ["Orbit Row", "12,5", "13.5", "13.5 kg"],
    ["Quartz Pull", "2x8kg", "2x9kg", "2x9kg"], ["Comet Lift", "20kg (17,5 no final)", "22kg (17,5 no final)", "22kg (17,5 no final)"],
    ["Vector Step", "16", "18,5", "18.5"],
  ]) {
    const card = page.locator(".exercise-card").filter({ has: page.getByRole("heading", { name, exact: true }) });
    const field = card.getByRole("textbox", { name: `Actual load for ${name}`, exact: true });
    await expect(field).toHaveValue(expected);
    await expect(field).toHaveAttribute("inputmode", /^[\d,.]+$/.test(expected) ? "decimal" : "text");
    await field.fill(updated);
    await expect(card.getByText(/Unsaved edit/)).toBeVisible();
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem("treino-local:v2")!).sessions[0].blocks);
    expect(before.some((b: { actualLoad?: string }) => b.actualLoad === persisted)).toBe(false);
    await card.getByRole("button", { name: "Save load", exact: true }).click();
    await expect(card.getByRole("status")).toContainText("Saved on this device");
    await card.getByRole("checkbox", { name: `Complete ${name}`, exact: true }).click();
    await expect(card.locator(".load-reference")).toContainText(name === "Nova Press" ? "12kg" : name === "Orbit Row" ? "12,5 kg" : expected);
  }
  const noted = page.locator(".exercise-card").filter({ has: page.getByRole("heading", { name: "Nova Press", exact: true }) });
  await noted.getByRole("button", { name: "Details", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Orbit Row");
  await page.getByRole("dialog").getByRole("tab", { name: "Notes", exact: true }).click();
  await page.getByRole("dialog").getByRole("textbox", { name: "EXERCISE NOTE" }).fill("Synthetic reminder: station position 3.");
  await page.getByRole("dialog").getByRole("button", { name: "Save note", exact: true }).click();
  await page.getByRole("button", { name: "Close exercise details" }).click();
  for (const width of [320, 393]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`confirmed-${width}.png`), fullPage: true });
  }
  await page.getByRole("link", { name: /Finish workout/ }).click();
  await page.getByRole("button", { name: /Save workout/ }).click();
  await expect(page).toHaveURL(/\/share/);
  await page.goto("/history/");
  await page.locator("a.history-card").filter({ hasText: "Saved locally" }).first().click();
  await expect(page.locator(".detail-list")).toContainText("14.5kg");
  await expect(page.locator(".detail-list")).toContainText("22kg (17,5 no final)");
  await page.goto("/");
  await page.getByRole("button", { name: "Start workout", exact: true }).click();
  const again = page.locator(".exercise-card").filter({ has: page.getByRole("heading", { name: "Nova Press", exact: true }) });
  await expect(again.getByRole("textbox")).toHaveValue("14.5");
  await expect(again.locator(".load-reference")).toContainText("Last used14.5kg");
  await expect(again.locator(".load-reference")).toContainText("Current plan12kg");
  await expect(again.getByRole("button", { name: /Note: Synthetic reminder/ })).toBeVisible();
});

test("unfinished drafts survive views, details, navigation and reload, and block finishing until resolved", async ({ page }, info) => {
  await importAudit(page);
  const field = page.getByRole("textbox", { name: "Actual load for Nova Press", exact: true });
  await field.fill("14,");
  await expect(page.locator(".exercise-card").filter({ has: field }).getByRole("button", { name: "Save load", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await expect(field).toHaveValue("14,");
  await page.getByRole("button", { name: "Next →", exact: true }).click();
  await page.getByRole("button", { name: "← Previous", exact: true }).click();
  await expect(field).toHaveValue("14,");
  await page.getByRole("button", { name: "List", exact: true }).click();
  await page.locator(".exercise-card").filter({ has: field }).getByRole("button", { name: "Details", exact: true }).click();
  const details = page.getByRole("dialog");
  await expect(details.getByRole("textbox")).toHaveValue("14,");
  await details.getByRole("textbox").fill("14,5");
  await page.getByRole("button", { name: "Close exercise details" }).click();
  await expect(field).toHaveValue("14,5");
  await page.goto("/finish/");
  await expect(page.getByRole("button", { name: /Save workout/ })).toBeDisabled();
  await expect(page.getByText(/1 unsaved load edit/)).toBeVisible();
  await page.getByRole("link", { name: "Return to workout", exact: true }).click();
  await expect(page).toHaveURL(/\/workout\/?\?id=A/);
  await expect(field).toHaveValue("14,5");
  page.on("dialog", (dialog) => void dialog.accept()); // Browser's unload protection; the draft still restores.
  await page.reload();
  await expect(field).toHaveValue("14,5");
  const card = page.locator(".exercise-card").filter({ has: field });
  await page.setViewportSize({ width: 320, height: 640 });
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("draft-320.png") });
  await card.getByRole("button", { name: "Save load", exact: true }).click();
  await expect(field).toHaveValue("14.5");
  await expect(card.getByText("Unsaved edit", { exact: false })).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Complete Nova Press", exact: true }).click();
  await page.goto("/finish/");
  await expect(page.getByRole("button", { name: /Save workout/ })).toBeEnabled();
});

test("failed persistence retains draft and offers retry without a false saved confirmation", async ({ page }) => {
  await importAudit(page);
  const field = page.getByRole("textbox", { name: "Actual load for Nova Press", exact: true });
  const card = page.locator(".exercise-card").filter({ has: field });
  await field.fill("15");
  await page.evaluate(() => { const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if (key === "treino-local:v2") throw new DOMException("Synthetic storage failure", "QuotaExceededError"); return original.call(this, key, value); };
    (window as unknown as { restoreStorage: () => void }).restoreStorage = () => { Storage.prototype.setItem = original; }; });
  await card.getByRole("button", { name: "Save load", exact: true }).click();
  await expect(card.getByRole("alert")).toContainText("draft is retained");
  await expect(card.getByText(/Saved on this device/)).toHaveCount(0);
  await expect(field).toHaveValue("15");
  await page.evaluate(() => (window as unknown as { restoreStorage: () => void }).restoreStorage());
  await card.getByRole("button", { name: "Retry save load", exact: true }).click();
  await expect(card.getByRole("status")).toContainText("Saved on this device");
});

test("optional empty loads retain drafts across views and explicit discard keeps confirmed data unchanged", async ({ page }) => {
  await importAudit(page);
  const card = page.locator(".exercise-card").filter({ has: page.getByRole("heading", { name: "Lumen Raise", exact: true }) });
  await card.getByRole("button", { name: "+ Record a load", exact: true }).click();
  const input = page.getByRole("textbox", { name: "Actual load for Lumen Raise", exact: true });
  await input.fill("18,5");
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  for (let index = 0; index < 4; index++) await page.getByRole("button", { name: "Next →", exact: true }).click();
  await expect(input).toHaveValue("18,5");
  await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(input).toHaveValue("18,5");
  await card.getByRole("button", { name: "Discard edit", exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("treino-local:v2")!).sessions[0].blocks.find((b: { blockId: string }) => b.blockId === "A-strength-30-1").actualLoad)).toBeUndefined();
  await page.goto("/finish/");
  await expect(page.getByRole("button", { name: /Save workout/ })).toBeEnabled();
});

test("a confirmed load is not resurrected as a draft if draft-store cleanup fails", async ({ page }) => {
  await importAudit(page);
  const field = page.getByRole("textbox", { name: "Actual load for Nova Press", exact: true });
  const card = page.locator(".exercise-card").filter({ has: field });
  await field.fill("15");
  await page.evaluate(() => { const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if (key === "treino-load-drafts-v1") throw new DOMException("Synthetic draft storage failure", "QuotaExceededError"); return original.call(this, key, value); }; });
  await card.getByRole("button", { name: "Save load", exact: true }).click();
  await expect(card.getByRole("status")).toContainText("Saved on this device");
  await page.reload();
  await expect(field).toHaveValue("15");
  await expect(card.getByText(/Unsaved edit/)).toHaveCount(0);
});
