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

test("Excel load sync changes only the intended Jonatha slash segment", async () => disposable(original, async (bytes) => {
  const imported = parseTrainingSnapshot(await snapshotFromXlsx(bytes), { kind: "excel", filename: "copy.xlsx", template: "", mappings: {}, mode: "copy" }, "Jonatha");
  const plan = addTraining(emptyTrainingData(), imported, undefined, "2026-10-03T08:00:00Z", "jonatha").plans[0];
  const started = startTrainingSession({ ...emptyTrainingData(), plans: [plan], activePlanId: plan.id }, plan.id, "A",
    new Date("2026-10-03T08:00:00Z"), "one");
  const first = plan.workouts[0].blocks.find((block) => block.kind === "exercise" && block.sourceCell === "E26")!;
  assert.equal(first.kind, "exercise");
  const changed = { ...started.data, sessions: started.data.sessions.map((item) => ({ ...item,
    blocks: item.blocks.map((state) => state.blockId === first.id ? { ...state, completed: true, actualLoad: "9" } : state) })) };
  const done = finishTrainingSession(changed, "one", "2026-10-03");
  done.sessions[0].completionSyncStatus = "synced";
  const output = await prepareXlsxSync(bytes, plan, done.sessions);
  assert(output.bytes);
  assert.equal(output.loadOutcomes[0].status, "synced");
  const before = await snapshotFromXlsx(bytes), after = await snapshotFromXlsx(output.bytes);
  assert.equal(before.sheets.find((sheet) => sheet.name === "TREINO A")!.cells.H26.displayed, "8/15");
  assert.equal(after.sheets.find((sheet) => sheet.name === "TREINO A")!.cells.H26.displayed, "9/15");
  const reparsed = parseTrainingSnapshot(after, plan.source, plan.name);
  assert.equal(reparsed.workouts[0].blocks.find((block) => block.id === first.id && block.kind === "exercise")?.kind === "exercise" &&
    (reparsed.workouts[0].blocks.find((block) => block.id === first.id) as { defaultLoad?: string }).defaultLoad, "9");
}));

test("Excel date-formatted decimal load writes as visible text without changing adjacent loads", async () => disposable(source, async (bytes) => {
  const imported = parseTrainingSnapshot(await snapshotFromXlsx(bytes), { kind: "excel", filename: "copy.xlsx", template: "", mappings: {}, mode: "copy" }, "Milena");
  const plan = addTraining(emptyTrainingData(), imported, undefined, "2026-10-03T08:00:00Z", "milena").plans[0];
  const started = startTrainingSession({ ...emptyTrainingData(), plans: [plan], activePlanId: plan.id }, plan.id, "A",
    new Date("2026-10-03T08:00:00Z"), "one");
  const block = plan.workouts[0].blocks.find((item) => item.kind === "exercise" && item.name === "Desenvolvimento na máquina")!;
  assert.equal(block.kind, "exercise");
  const changed = { ...started.data, sessions: started.data.sessions.map((item) => ({ ...item,
    blocks: item.blocks.map((state) => state.blockId === block.id ? { ...state, completed: true, actualLoad: "8,5" } : state) })) };
  const done = finishTrainingSession(changed, "one", "2026-10-03");
  done.sessions[0].completionSyncStatus = "synced";
  const output = await prepareXlsxSync(bytes, plan, done.sessions);
  assert(output.bytes);
  const before = await snapshotFromXlsx(bytes), after = await snapshotFromXlsx(output.bytes);
  const oldSheet = before.sheets.find((sheet) => sheet.name === "TREINO A")!, newSheet = after.sheets.find((sheet) => sheet.name === "TREINO A")!;
  assert.equal(newSheet.cells.H28.displayed, "8.5");
  assert.equal(newSheet.cells.G28.displayed, oldSheet.cells.G28.displayed);
  assert.equal(newSheet.cells.I28.displayed, oldSheet.cells.I28.displayed);
  assert.equal(newSheet.cells.H28.rawType, "inlineStr");
}));
