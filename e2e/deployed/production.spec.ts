import { expect, test, type Page } from "@playwright/test";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixturePath } from "../../tests/fixture-path";
import { snapshotFromXlsx } from "../../lib/import/snapshot";
import { parseTrainingSnapshot } from "../../lib/import/template-parser";

const origin = "https://treino-local.vercel.app/";

async function isolatedCopy(name: string) {
  const canonical = fixturePath(name);
  const hash = createHash("sha256").update(await readFile(canonical)).digest("hex");
  const directory = await mkdtemp(join(tmpdir(), "treino-deployed-"));
  const copy = join(directory, name);
  await copyFile(canonical, copy);
  return { copy, async cleanup() {
    await rm(directory, { recursive: true, force: true });
    expect(createHash("sha256").update(await readFile(canonical)).digest("hex")).toBe(hash);
  } };
}

async function importWorkbook(page: Page, copy: string) {
  await page.goto(origin);
  await page.getByRole("link", { name: /Import Excel file/ }).tap();
  if (await page.getByRole("heading", { name: "Training plans" }).isVisible())
    await page.getByRole("button", { name: /Add training/ }).tap();
  await page.locator('input[type="file"]').setInputFiles(copy);
  await expect(page.getByRole("heading", { name: "Training ready" })).toBeVisible();
  await expect(page.locator(".review-card")).toContainText(/workout|exercise/i);
  await page.locator(".review-card").getByRole("button", { name: /Use this training/ }).tap();
  await expect(page).toHaveURL(origin);
  await expect(page.getByRole("button", { name: "Start workout" }).first()).toBeVisible();
}

test("production build and read-only navigation", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`${new URL(page.url()).pathname}: ${error.message}`));
  await page.goto(new URL("debug/", origin).toString());
  await expect(page.getByRole("heading", { name: /Diagnostics/ })).toBeVisible();
  const build = await page.locator(".debug-grid").innerText();
  const expected = process.env.DEPLOYED_EXPECTED_REVISION;
  if (expected) expect(build).toContain(expected.slice(0, 8));
  console.log(`DEPLOYED_ORIGIN ${new URL(page.url()).origin}; BUILD ${build.match(/BUILD\s+([^\s]+)/)?.[1] ?? "unknown"}`);
  for (const [route, heading] of [
    ["/", /Choose your training/], ["/plans/", /Training plans/], ["/history/", /History/],
    ["/stats/", /Statistics/], ["/settings/", /Settings/], ["/settings/friends/", /Friends/],
  ] as const) {
    await page.goto(new URL(route, origin).toString());
    await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible();
    expect(new URL(page.url()).origin).toBe(new URL(origin).origin);
  }
  await page.goto(new URL("settings/", origin).toString());
  await expect(page.getByRole("button", { name: "Download debug report" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send diagnostics" })).toBeDisabled();
  await expect(page.getByText("Connect Google to send diagnostics.")).toBeVisible();
  await page.goto(origin);
  await expect(page.getByRole("region", { name: "Friends" })).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await page.reload();
  await expect(page.locator(".update-banner")).toHaveCount(0);
  await page.goto(new URL("debug/", origin).toString());
  const diagnostic = (name: string) => page.locator(".debug-grid > div").filter({ has: page.locator("small", { hasText: new RegExp(`^${name}$`) }) }).locator("strong");
  const buildId = await diagnostic("BUILD").textContent();
  await expect(diagnostic("SW REGISTRATION")).toHaveText("registered");
  if (await diagnostic("CONTROLLER BUILD ID").textContent() !== buildId) {
    await page.goto(origin);
    const update = page.getByRole("button", { name: "Update now" });
    await expect(update).toBeVisible();
    await Promise.all([page.waitForEvent("load"), update.click()]);
    await page.goto(new URL("debug/", origin).toString());
  }
  await expect(diagnostic("CONTROLLER BUILD ID")).toHaveText(buildId ?? "");
  await expect(diagnostic("SW WAITING")).toHaveText("none");
  await expect(diagnostic("UPDATE UI STATE")).toHaveText("idle");
  await expect(diagnostic("ACTIVE WORKOUT DETECTED")).toHaveText("false");
  expect(errors).toEqual([]);
});

test("production Home places Friends above workouts and serves push-capable worker", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("treino-local:v2", JSON.stringify({ schemaVersion: 5,
    activePlanId: "deployed-home-plan", exerciseNotes: [], sessions: [], plans: [{ id: "deployed-home-plan",
      name: "Training Alpha", source: { kind: "builtin", label: "Local" }, version: 1,
      importedAt: "2026-10-01T08:00:00Z", updatedAt: "2026-10-01T08:00:00Z", importWarnings: [], legacyCompletions: [],
      workouts: [{ id: "A", title: "Workout A", description: "", blocks: [
        { kind: "exercise", id: "test-squat", section: "Strength", name: "Squat", prescription: "3 × 10" }] }] }] })));
  await page.route("**/api/social/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/me")) return route.fulfill({ json: { email: "test@example.invalid", displayName: "Test",
      accountId: "synthetic", sharingEnabled: true } });
    if (path.endsWith("/home")) return route.fulfill({ json: { friendCount: 0, activities: [], received: [] } });
    return route.fulfill({ json: { friends: [] } });
  });
  await page.goto(origin);
  await expect(page.getByRole("region", { name: "Friends" })).toBeVisible();
  const order = await page.locator(".home-page").evaluate((home) => [".current-training-hero", ".social-home-card",
    ".section-heading", ".workout-tile"].map((selector) => Array.from(home.children).findIndex((child) =>
    child.matches(selector) || Boolean(child.querySelector(selector)))));
  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(order.every((index) => index >= 0)).toBe(true);
  const worker = await page.evaluate(async () => (await fetch("/sw.js", { cache: "no-store" })).text());
  expect(worker).toContain('addEventListener("push"');
  expect(worker).toContain('addEventListener("notificationclick"');
  expect(worker).toContain('"SKIP_WAITING"');
  await page.goto(new URL("settings/friends/", origin).toString());
  await expect(page.getByRole("heading", { name: "Friends notifications" })).toBeVisible();
  await expect(page.getByText(/Notification status is temporarily unavailable|Notifications are not configured yet|Notifications on this device/).first()).toBeVisible();
});

test("sanitized workbook imports through production and keeps paired loads separate", async ({ page }) => {
  await page.goto(new URL("plans/", origin).toString());
  await page.getByRole("button", { name: /Add training/ }).tap();
  await page.locator('input[type="file"]').setInputFiles("tests/fixtures/synthetic-loads.xlsx");
  await expect(page.getByRole("heading", { name: "Training ready" })).toBeVisible();
  await page.getByText("Review exercise plan loads").tap();
  await expect(page.locator(".import-review")).toContainText("Exercise Alpha: 7.5");
  await expect(page.locator(".import-review")).toContainText("Exercise Beta: 12.5");
  await page.locator(".import-review").getByRole("button", { name: /Use this training/ }).tap();
  await page.getByRole("button", { name: "Start workout" }).first().tap();
  const alpha = page.locator(".exercise-card").filter({ has: page.getByRole("heading", { name: "Exercise Alpha" }) });
  const beta = page.locator(".exercise-card").filter({ has: page.getByRole("heading", { name: "Exercise Beta" }) });
  await expect(alpha).toContainText("Current plan");
  await expect(alpha).toContainText("7.5");
  await expect(beta).toContainText("12.5");
  await expect(alpha.getByRole("textbox", { name: "Actual load for Exercise Alpha" })).toHaveValue("7.5");
  await expect(beta.getByRole("textbox", { name: "Actual load for Exercise Beta" })).toHaveValue("12.5");
});

for (const [label, filename, count] of [
  ["Jonatha", "TREINO 1 JONATHA.xlsx", 2],
  ["Milena", "TREINO 4 MILENA.xlsx", 3],
] as const) {
  test(`${label} private workbook imports through production UI`, async ({ page }) => {
    const fixture = await isolatedCopy(filename);
    try {
      const local = parseTrainingSnapshot(await snapshotFromXlsx(new Uint8Array(await readFile(fixture.copy))),
        { kind: "excel", filename, template: "", mappings: {}, mode: "copy" }, label);
      await importWorkbook(page, fixture.copy);
      await expect(page.getByRole("region", { name: "Friends" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Start workout" })).toHaveCount(count);
      const deployedShape = await page.evaluate(() => {
        const plan = JSON.parse(localStorage.getItem("treino-local:v2")!).plans[0];
        return plan.workouts.map((workout: { blocks: Array<{ kind: string; groupId?: string; defaultLoad?: string; videoUrl?: string }>; restNote?: string }) => ({
          blocks: workout.blocks.length, exercises: workout.blocks.filter((block) => block.kind === "exercise").length,
          groups: Object.values(workout.blocks.reduce<Record<string, number>>((groups, block) => {
            if (block.groupId) groups[block.groupId] = (groups[block.groupId] ?? 0) + 1;
            return groups;
          }, {})).sort(),
          loads: workout.blocks.filter((block) => block.defaultLoad).length,
          videos: workout.blocks.filter((block) => block.videoUrl).length,
          rest: Boolean(workout.restNote),
        }));
      });
      const localShape = local.workouts.map((workout) => ({
        blocks: workout.blocks.length, exercises: workout.blocks.filter((block) => block.kind === "exercise").length,
        groups: Object.values(workout.blocks.reduce<Record<string, number>>((groups, block) => {
          if (block.kind === "exercise" && block.groupId) groups[block.groupId] = (groups[block.groupId] ?? 0) + 1;
          return groups;
        }, {})).sort(),
        loads: workout.blocks.filter((block) => block.kind === "exercise" && block.defaultLoad).length,
        videos: workout.blocks.filter((block) => block.kind === "exercise" && block.videoUrl).length,
        rest: Boolean(workout.restNote),
      }));
      expect(deployedShape).toEqual(localShape);
      await page.getByRole("button", { name: "Start workout" }).first().tap();
      await expect(page.getByRole("group", { name: "Workout view" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Focus" })).toBeVisible();
      await expect(page.getByRole("progressbar", { name: "Workout progress" })).toBeVisible();
      await expect(page.getByRole("checkbox", { name: /Complete/ }).first()).toBeVisible();
      await expect(page.getByRole("checkbox", { name: /Complete/ })).toHaveCount(localShape[0].exercises);
      await page.getByRole("button", { name: "Focus" }).tap();
      await expect(page.getByRole("region", { name: "Focus mode" })).toBeVisible();
      await page.reload();
      await expect(page.getByRole("region", { name: "Focus mode" })).toBeVisible();
      await page.getByLabel("Workout options").tap();
      await page.getByRole("button", { name: "Cancel workout" }).first().tap();
      await page.getByRole("button", { name: "Cancel workout" }).last().tap();
    } finally { await fixture.cleanup(); }
  });
}

test("Excel safe-copy sync reconciles after reconnect and reload", async ({ page }) => {
  const fixture = await isolatedCopy("TREINO 1 JONATHA.xlsx");
  try {
    await importWorkbook(page, fixture.copy);
    await page.getByRole("button", { name: "Start workout" }).first().tap();
    await page.getByRole("checkbox", { name: /Complete/ }).first().tap();
    await page.getByRole("textbox", { name: /Actual load for Agachamento goblet/ }).fill("9");
    await page.getByRole("link", { name: /Finish workout/ }).tap();
    await page.getByRole("button", { name: /Save workout/ }).tap();
    await page.getByRole("link", { name: "Not now" }).tap();
    await page.goto(new URL("source/", origin).toString());
    await page.locator('input[type="file"]').setInputFiles(fixture.copy);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /Save updated workbook copy/ }).tap();
    const saved = await download;
    const output = await saved.path();
    expect(output).toBeTruthy();
    await page.locator('input[type="file"]').setInputFiles(output!);
    await expect(page.getByText(/No local workouts are waiting for source sync/)).toBeVisible();
    await page.reload();
    await expect(page.getByText(/No local workouts are waiting for source sync/)).toBeVisible();
  } finally { await fixture.cleanup(); }
});
