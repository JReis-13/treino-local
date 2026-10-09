import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { snapshotFromXlsx } from "../lib/import/snapshot";
import { parseTrainingSnapshot } from "../lib/import/template-parser";
import { addTraining } from "../lib/training/library";
import { emptyTrainingData } from "../lib/training/storage";
import { reviewedJonathaPath } from "../tests/fixture-path";

test("offline completion reconciles on reconnect and stays synced after reload", async ({ page, context }) => {
  const spreadsheetId = "a12345678901234567890123";
  const imported = parseTrainingSnapshot(await snapshotFromXlsx(new Uint8Array(await readFile(reviewedJonathaPath()))),
    { kind: "google", filename: "Disposable mocked Sheet", template: "", mappings: {}, authMode: "oauth",
      spreadsheetId, sourceProof: "a".repeat(43), syncEnabled: true }, "Disposable mocked Sheet");
  const data = addTraining(emptyTrainingData(), imported, undefined, "2026-10-04T07:00:00Z", "mock-plan");
  await page.addInitScript((value) => {
    if (!localStorage.getItem("treino-local:v2")) localStorage.setItem("treino-local:v2", JSON.stringify(value));
  }, data);
  let dateWrites = 0;
  await page.route("**/api/google/sheets/refresh", (route) => route.fulfill({ json: { imported } }));
  await page.route("**/api/google/sheets/register-completion", (route) => {
    dateWrites++;
    return route.fulfill({ json: { status: "synced", sourceSlot: "E5" } });
  });
  await page.goto("/");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.getByRole("button", { name: "Start workout" }).first().tap();
  await page.getByRole("link", { name: /Finish workout/ }).tap();
  await page.getByRole("button", { name: /Save workout/ }).tap();
  await page.getByRole("link", { name: "Not now" }).tap();
  await page.getByRole("link", { name: "Home", exact: true }).tap();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator(".current-training-hero")).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("treino-local:v2")!).sessions[0].syncStatus)).toBe("pending");
  await page.reload();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("treino-local:v2")!).sessions[0].syncStatus)).toBe("pending");
  expect(dateWrites).toBe(0);
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("treino-local:v2")!).sessions[0].syncStatus)).toBe("synced");
  expect(dateWrites).toBe(1);
  await page.getByRole("link", { name: "History", exact: true }).tap();
  await page.locator(".history-list a.history-card").first().tap();
  await expect(page.getByText("Synced to source")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Synced to source")).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  expect(dateWrites).toBe(1);
});
