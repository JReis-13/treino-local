import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { dateToSerial, snapshotFromXlsx } from "../lib/import/snapshot";
import { parseTrainingSnapshot } from "../lib/import/template-parser";
import { WORKOUTS } from "../data/workouts";
import { fixturePath } from "./fixture-path";

async function parse(filename: string) {
  const bytes = new Uint8Array(await readFile(fixturePath(filename)));
  return parseTrainingSnapshot(await snapshotFromXlsx(bytes),
    { kind: "excel", filename, template: "", mappings: {}, mode: "copy" }, filename.replace(/\.xlsx$/i, ""));
}

test("original workbook imports two ordered workouts without overview data", async () => {
  const plan = await parse("TREINO 1 JONATHA.xlsx");
  assert.deepEqual(plan.workouts.map((workout) => workout.id), ["A", "B"]);
  assert.deepEqual(plan.workouts.map((workout) => workout.blocks.length), [11, 11]);
  assert.equal(plan.legacyCompletions.length, 0);
  assert.equal(plan.source.kind, "excel");
  assert(!JSON.stringify(plan).includes("JONATHA!"));
  assert(!plan.warnings.some((warning) => warning.severity === "activationBlocker"));
  assert(!plan.warnings.some((warning) => warning.location === "TREINO A!F33"));
  for (const workout of plan.workouts) {
    const actual = workout.blocks.filter((block) => block.kind === "exercise").map((block) => {
      if (block.kind !== "exercise") throw new Error("Expected exercise");
      return [block.name, block.prescription, block.equipment, block.defaultLoad, block.videoUrl];
    });
    const expected = WORKOUTS[workout.id as "A" | "B"].exercises.map((exercise) =>
      [exercise.name, exercise.prescription.sourceText, exercise.equipment, exercise.defaultLoad, exercise.videoUrl]);
    assert.deepEqual(actual, expected, `Workbook workout ${workout.id} differs from the reviewed plan`);
  }
});

test("Milena imports three workouts, triple groups, challenge, cardio and dated history", async () => {
  const plan = await parse("TREINO 4 MILENA.xlsx");
  assert.deepEqual(plan.workouts.map((workout) => workout.id), ["A", "B", "C"]);
  assert.deepEqual(plan.workouts.map((workout) => workout.blocks.length), [15, 16, 3]);
  assert(plan.workouts[0].blocks.some((block) => block.kind === "exercise" && block.section === "Challenge"));
  assert(plan.workouts[1].blocks.some((block) => block.kind === "instruction" && block.text.includes("config flexora")));
  assert(plan.workouts[2].blocks.every((block) => block.kind === "instruction"));
  assert.equal(plan.legacyCompletions.length, 20);
  assert.equal(plan.legacyCompletions.filter((entry) => entry.workoutId === "C").length, 8);
  assert(plan.warnings.some((warning) => warning.code === "shared-prescription" && warning.location === "TREINO A!F26"));
  assert(plan.warnings.some((warning) => warning.code === "uncertain-load" && warning.location.includes("TREINO A")));
  assert(plan.warnings.some((warning) => warning.code === "extra-video" && warning.location.includes("TREINO B")));
  assert(!JSON.stringify(plan).includes("MILENA!"));
});

test("Milena displayed decimal load wins over date-like raw type", async () => {
  const plan = await parse("TREINO 4 MILENA.xlsx");
  const block = plan.workouts[0].blocks.find((item) => item.kind === "exercise" && item.name === "Desenvolvimento na máquina");
  assert(block?.kind === "exercise");
  assert.equal(block.defaultLoad, "7.5");
  assert(plan.warnings.some((warning) => warning.code === "formatted-load" && warning.location === "TREINO A!H28"));
});

test("uncertain completion grid blocks sync while preserving the workout", async () => {
  const bytes = new Uint8Array(await readFile(fixturePath("TREINO 1 JONATHA.xlsx")));
  const snapshot = await snapshotFromXlsx(bytes);
  const sheet = snapshot.sheets.find((item) => item.name === "TREINO A")!;
  sheet.cells.E5.numberFormat = "General";
  const plan = parseTrainingSnapshot(snapshot,
    { kind: "excel", filename: "copy.xlsx", template: "", mappings: {}, mode: "copy" }, "copy");
  assert.equal(plan.workouts.length, 2);
  assert.equal(plan.workouts[0].blocks.length, 11);
  assert(plan.source.kind === "excel");
  assert.equal(Object.hasOwn(plan.source.mappings, "A"), false);
  assert(plan.warnings.some((warning) => warning.code === "completion-grid" && warning.severity === "syncBlocker"));
});

test("Jonatha template retains six existing completion dates without changing workout mappings", async () => {
  const bytes = new Uint8Array(await readFile(fixturePath("TREINO 1 JONATHA.xlsx")));
  const snapshot = await snapshotFromXlsx(bytes);
  for (const sheet of snapshot.sheets.filter((item) => /^TREINO [AB]$/.test(item.name))) {
    for (let row = 5; row <= 7; row++) {
      sheet.cells[`E${row}`].raw = String(dateToSerial(`2026-09-${String(row).padStart(2, "0")}`));
      sheet.cells[`E${row}`].rawType = "n";
    }
  }
  const plan = parseTrainingSnapshot(snapshot,
    { kind: "excel", filename: "copy.xlsx", template: "", mappings: {}, mode: "copy" }, "copy");
  assert.equal(plan.legacyCompletions.length, 6);
  assert.deepEqual(plan.workouts.map((workout) => workout.blocks.length), [11, 11]);
  assert(!plan.warnings.some((warning) => warning.severity === "activationBlocker"));
});

test("unidentifiable workout content blocks activation", async () => {
  const bytes = new Uint8Array(await readFile(fixturePath("TREINO 1 JONATHA.xlsx")));
  const snapshot = await snapshotFromXlsx(bytes);
  snapshot.sheets.find((item) => item.name === "TREINO A")!.cells.E20.displayed = "";
  const plan = parseTrainingSnapshot(snapshot,
    { kind: "excel", filename: "copy.xlsx", template: "", mappings: {}, mode: "copy" }, "copy");
  assert.equal(plan.workouts.length, 1);
  assert(plan.warnings.some((warning) => warning.code === "workout-content" && warning.severity === "activationBlocker"));
});
