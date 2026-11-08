import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { snapshotFromXlsx } from "../lib/import/snapshot";
import { parseTrainingSnapshot } from "../lib/import/template-parser";
import { independentlyValidate } from "../tests/verify-annotation-package";

const fixture = process.env.WORKBOOK_COMMENT_FIXTURE;
test.use({ trace: "off", screenshot: "off", video: "off" });

test("real instructor workbook round trips a personal reply through the mobile UI", async ({ page, context, browser }) => {
  test.skip(!fixture, "Opt in with a read-only instructor workbook");
  const original = await readFile(fixture!);
  const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  const source = { kind: "excel" as const, filename: "instructor.xlsx", template: "", mappings: {}, mode: "copy" as const };
  const parse = async (bytes: Buffer) => parseTrainingSnapshot(await snapshotFromXlsx(bytes), source, "Instructor workbook");
  const initial = await parse(original);
  const workout = initial.workouts[0];
  const exercise = workout.blocks.find(block => block.kind === "exercise" && block.sourceNotes?.some(note => note.format === "threaded" && note.cell === block.sourceCell));
  if (exercise?.kind !== "exercise") throw new Error("Expected an exercise with an instructor thread");
  const instructor = exercise.sourceNotes!.find(note => note.format === "threaded" && note.cell === exercise.sourceCell)!;
  const mockApis = (target: typeof page) => target.route("**/api/**", route => route.fulfill({
    status: route.request().url().includes("/social/") ? 401 : 200,
    json: { connected: false, configured: false },
  }));
  await mockApis(page);
  const select = async (bytes: Buffer, name = "instructor.xlsx", target = page) => target.locator('input[type="file"]').setInputFiles({
    name, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: bytes,
  });
  await page.goto("/plans/?source=excel");
  await select(original);
  await page.getByRole("button", { name: /Use this training/ }).click();
  await page.getByRole("button", { name: "Start workout", exact: true }).first().click();
  const openNotes = async (target = page) => {
    await target.goto("/workout?id=" + encodeURIComponent(workout.id));
    await target.locator(".exercise-card").filter({ has: target.getByRole("heading", { name: exercise.name, exact: true }) })
      .getByRole("button", { name: "Details", exact: true }).click();
    const details = target.getByRole("dialog");
    await details.getByRole("tab", { name: "Notes", exact: true }).click();
    return details;
  };
  const save = async (note: string) => {
    const details = await openNotes();
    await expect(details.getByRole("heading", { name: "Instructor notes" })).toBeVisible();
    await details.getByRole("textbox", { name: "EXERCISE NOTE" }).fill(note);
    await details.getByRole("button", { name: "Save note", exact: true }).click();
    await expect(details.getByText("Note saved on this device.", { exact: true })).toBeVisible();
  };
  const exportCopy = async (base: Buffer, filename: string, target = page) => {
    await target.goto("/source/");
    await select(base, filename, target);
    const button = target.getByRole("button", { name: /Export updated Excel with notes/ });
    await expect(button).toBeEnabled();
    const [download] = await Promise.all([target.waitForEvent("download", { timeout: 12000 }), button.click()]);
    expect(download.suggestedFilename()).toMatch(/-updated\.xlsx$/);
    return readFile((await download.path())!);
  };
  await save("Browser round-trip reminder");
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await expect((await openNotes()).getByRole("textbox", { name: "EXERCISE NOTE" })).toHaveValue("Browser round-trip reminder");
  await context.setOffline(false);
  const first = await exportCopy(original, "instructor.xlsx");
  const firstParsed = await parse(first);
  expect(firstParsed.noteContributions?.map(note => [note.cell, note.format, note.text])).toEqual([[instructor.cell, "threaded", "Browser round-trip reminder"]]);
  await save("Edited browser round-trip reminder ($&)");
  const edited = await exportCopy(first, "instructor-updated.xlsx");
  const result = await parse(edited);
  independentlyValidate(edited, fixture);
  expect(result.noteContributions?.map(note => [note.id, note.cell, note.text])).toEqual([
    [firstParsed.noteContributions![0].id, instructor.cell, "Edited browser round-trip reminder ($&)"],
  ]);
  expect(result.excelAnnotations?.find(note => note.id === instructor.id)?.text === instructor.text).toBe(true);
  await page.goto("/source/");
  await select(edited, "instructor-latest.xlsx");
  await expect(page.getByText("1 saved on this device · 0 with changes to export.")).toBeVisible();
  const clean = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const reimport = await clean.newPage();
    await mockApis(reimport);
    await reimport.goto("/plans/?source=excel");
    await select(edited, "instructor-latest.xlsx", reimport);
    await reimport.getByRole("button", { name: /Use this training/ }).click();
    await reimport.getByRole("button", { name: "Start workout", exact: true }).first().click();
    const reopened = await openNotes(reimport);
    await expect(reopened.getByRole("textbox", { name: "EXERCISE NOTE" })).toHaveValue("Edited browser round-trip reminder ($&)");
    expect(await reopened.getByText(instructor.text, { exact: true }).count() > 0).toBe(true);
    const repeated = await exportCopy(edited, "instructor-latest.xlsx", reimport);
    expect((await parse(repeated)).noteContributions?.map(note => note.id)).toEqual([firstParsed.noteContributions![0].id]);
  } finally {
    await clean.close();
  }
  expect(hash(await readFile(fixture!))).toBe(hash(original));
});
