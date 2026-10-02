import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import test from "node:test";
import { dateToSerial, snapshotFromXlsx } from "../lib/import/snapshot";
import { parseTrainingSnapshot } from "../lib/import/template-parser";
import { prepareXlsxSync } from "../lib/sync/xlsx";
import { addTraining } from "../lib/training/library";
import { finishTrainingSession, startTrainingSession } from "../lib/training/session";
import { emptyTrainingData } from "../lib/training/storage";
import type { TrainingPlanRecord, TrainingSession } from "../types/training";
import { fixturePath } from "./fixture-path";

const source = fixturePath("TREINO 4 MILENA.xlsx");
const original = fixturePath("TREINO 1 JONATHA.xlsx");

async function disposable<T>(path: string, run: (bytes: Uint8Array, copy: string) => Promise<T>): Promise<T> {
  const before = createHash("sha256").update(await readFile(path)).digest("hex");
  const folder = await mkdtemp(join(tmpdir(), "treino-source-sync-"));
  const copy = join(folder, basename(path));
  if (!resolve(folder).startsWith(resolve(tmpdir()) + sep) || resolve(copy) === resolve(path)) throw new Error("Unsafe test copy path.");
  try { await copyFile(path, copy); return await run(new Uint8Array(await readFile(copy)), copy); }
  finally { await rm(folder, { recursive: true, force: true });
    assert.equal(createHash("sha256").update(await readFile(path)).digest("hex"), before, "Original workbook was modified"); }
}

function session(plan: TrainingPlanRecord, workoutId: string, date: string): TrainingSession {
  const data = { ...emptyTrainingData(), plans: [plan], activePlanId: plan.id };
  const started = startTrainingSession(data, plan.id, workoutId, new Date("2026-09-30T08:00:00Z"), `${workoutId}-${date}`);
  return finishTrainingSession(started.data, started.session.id, date).sessions[0];
}

test("generic Excel sync writes Milena's next A slot on a disposable copy and reopens it", async () => disposable(source, async (bytes, copy) => {
  const imported = parseTrainingSnapshot(await snapshotFromXlsx(bytes), { kind: "excel", filename: basename(copy), template: "", mappings: {}, mode: "direct" }, "Milena");
  const plan = addTraining(emptyTrainingData(), imported, undefined, "2026-09-30T08:00:00Z", "milena").plans[0];
  const output = await prepareXlsxSync(bytes, plan, [session(plan, "A", "2026-09-30")]);
  assert.equal(output.outcomes[0].decision.kind, "write");
  assert(output.bytes);
  await writeFile(copy, output.bytes);
  const reopened = await snapshotFromXlsx(new Uint8Array(await readFile(copy)));
  const date = reopened.sheets.find((sheet) => sheet.name === "TREINO A")!.cells.E11;
  assert.equal(date.raw, String(dateToSerial("2026-09-30")));
  assert.equal(date.numberFormat, "dd/mm");
}));

test("generic Excel sync retains original workbook preservation gate", async () => disposable(original, async (bytes) => {
  const imported = parseTrainingSnapshot(await snapshotFromXlsx(bytes), { kind: "excel", filename: "copy.xlsx", template: "", mappings: {}, mode: "copy" }, "Original");
  const plan = addTraining(emptyTrainingData(), imported, undefined, "2026-09-30T08:00:00Z", "original").plans[0];
  const output = await prepareXlsxSync(bytes, plan, [session(plan, "B", "2026-09-30")]);
  assert(output.bytes);
  assert.equal(output.outcomes[0].decision.kind, "write");
  const duplicate = await prepareXlsxSync(output.bytes, plan, [session(plan, "B", "2026-09-30")]);
  assert.equal(duplicate.outcomes[0].decision.kind, "duplicate");
  assert.equal(duplicate.bytes, undefined);
}));

test("Milena B and Cardio C use their own bounded completion grids", async () => disposable(source, async (bytes) => {
  const imported = parseTrainingSnapshot(await snapshotFromXlsx(bytes), { kind: "excel", filename: "copy.xlsx", template: "", mappings: {}, mode: "copy" }, "Milena");
  const plan = addTraining(emptyTrainingData(), imported, undefined, "2026-09-30T08:00:00Z", "milena").plans[0];
  const output = await prepareXlsxSync(bytes, plan, [session(plan, "B", "2026-09-30"), session(plan, "C", "2026-09-30")]);
  assert(output.bytes);
  const sheets = (await snapshotFromXlsx(output.bytes)).sheets;
  assert.equal(sheets.find((sheet) => sheet.name === "TREINO B")!.cells.E11.raw, String(dateToSerial("2026-09-30")));
  assert.equal(sheets.find((sheet) => sheet.name === "TREINO C")!.cells.E13.raw, String(dateToSerial("2026-09-30")));
  assert.equal(sheets.find((sheet) => sheet.name === "TREINO C")!.cells.E13.numberFormat, "dd/mm");
}));
