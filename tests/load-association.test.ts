import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { snapshotFromXlsx } from "../lib/import/snapshot";
import { parseTrainingSnapshot } from "../lib/import/template-parser";
import { addTraining, refreshTraining } from "../lib/training/library";
import { lastUsedLoad, resolveLoadHistory, sameSourceLoadAssociation } from "../lib/training/loads";
import { buildLoadTrace } from "../lib/diagnostic-load-trace";
import { sanitizeDebugReport } from "../lib/diagnostics-upload";
import { finishTrainingSession, startTrainingSession, updateTrainingBlock } from "../lib/training/session";
import { emptyTrainingData, parseTrainingData } from "../lib/training/storage";
import type { ExerciseBlock, ImportedTraining } from "../types/training";

async function adjacentPlan(): Promise<ImportedTraining> {
  const snapshot = await snapshotFromXlsx(new Uint8Array(await readFile("tests/fixtures/synthetic-adjacent-loads.xlsx")));
  return parseTrainingSnapshot(snapshot, { kind: "excel", filename: "synthetic-adjacent-loads.xlsx", template: "",
    mappings: {}, mode: "copy" }, "Synthetic");
}

function exercise(imported: ImportedTraining, name: string): ExerciseBlock {
  const found = imported.workouts[0].blocks.find((block) => block.kind === "exercise" && block.name === name);
  assert(found?.kind === "exercise");
  return found;
}

test("old misassigned H-column History never prefills its neighboring new exercise after refresh", async () => {
  const corrected = await adjacentPlan();
  const old = structuredClone(corrected);
  old.workouts[0].blocks = old.workouts[0].blocks.map((block) => {
    if (block.kind !== "exercise") return block;
    if (block.sourceCell === "E26") return { ...block, defaultLoad: block.name === "Exercise Alpha" ? "8" : undefined,
      loadSource: undefined };
    if (block.sourceCell === "E28") return { ...block, defaultLoad: block.name === "Exercise Gamma" ? "25" : undefined,
      loadSource: undefined };
    return block;
  });
  let data = addTraining(emptyTrainingData(), old, undefined, "2026-10-01T08:00:00Z", "plan");
  data = startTrainingSession(data, "plan", "A", new Date("2026-10-01T09:00:00Z"), "old-session").data;
  data = updateTrainingBlock(data, "old-session", exercise(old, "Exercise Alpha").id, { completed: true });
  data = updateTrainingBlock(data, "old-session", exercise(old, "Exercise Gamma").id, { completed: true });
  data = finishTrainingSession(data, "old-session", "2026-10-01", new Date("2026-10-01T09:45:00Z"));
  data = parseTrainingData(JSON.stringify(refreshTraining(data, "plan", corrected)));
  const alpha = exercise(corrected, "Exercise Alpha"), beta = exercise(corrected, "Exercise Beta");
  const gamma = exercise(corrected, "Exercise Gamma"), delta = exercise(corrected, "Exercise Delta");
  assert.equal(sameSourceLoadAssociation(data.sessions[0], data.plans[0].workouts[0], alpha.id), false);
  assert.equal(sameSourceLoadAssociation(data.sessions[0], data.plans[0].workouts[0], gamma.id), false);
  assert.equal(lastUsedLoad(data, "plan", alpha.id), undefined);
  assert.equal(lastUsedLoad(data, "plan", gamma.id), undefined);
  assert.equal(resolveLoadHistory(data, "plan", data.plans[0].workouts[0], alpha).reason, "LEGACY_UNVERIFIED_SOURCE");
  const next = startTrainingSession(data, "plan", "A", new Date("2026-10-02T09:00:00Z"), "new-session").session;
  assert.deepEqual([alpha, beta, gamma, delta].map((block) => next.blocks.find((item) => item.blockId === block.id)?.actualLoad),
    ["15", "8", "20", "25"]);
  assert.equal(next.blocks.find((item) => item.blockId === alpha.id)?.initialLoadOrigin, "PLAN");
  assert.deepEqual(data.sessions[0].blocks.filter((item) => item.completed).map((item) => item.actualLoad), ["8", "25"]);
});

test("unique exercise identity retains valid History when its ID changes, without crossing plans", async () => {
  const initial = await adjacentPlan();
  let data = addTraining(emptyTrainingData(), initial, undefined, "2026-10-01T08:00:00Z", "first");
  data = startTrainingSession(data, "first", "A", new Date("2026-10-01T09:00:00Z"), "old").data;
  data = updateTrainingBlock(data, "old", exercise(initial, "Exercise Beta").id, { completed: true, actualLoad: "9" });
  data = finishTrainingSession(data, "old", "2026-10-01", new Date("2026-10-01T09:45:00Z"));
  const renamedId = structuredClone(initial);
  renamedId.workouts[0].blocks = renamedId.workouts[0].blocks.map((block) => block.kind === "exercise" &&
    block.name === "Exercise Beta" ? { ...block, id: "A-strength-moved-beta" } : block);
  data = refreshTraining(data, "first", renamedId);
  assert.equal(lastUsedLoad(data, "first", "A-strength-moved-beta"), "9");
  data = addTraining(data, renamedId, undefined, "2026-10-02T08:00:00Z", "second");
  assert.equal(lastUsedLoad(data, "second", "A-strength-moved-beta"), undefined);
});

test("report-scoped load pseudonyms expose a neighboring shift without exporting weights or names", async () => {
  const corrected = await adjacentPlan();
  let data = addTraining(emptyTrainingData(), corrected, undefined, "2026-10-01T08:00:00Z", "plan");
  data = startTrainingSession(data, "plan", "A", new Date("2026-10-01T09:00:00Z"), "first").data;
  const alpha = exercise(corrected, "Exercise Alpha");
  data = updateTrainingBlock(data, "first", alpha.id, { completed: true, actualLoad: "8" });
  data = finishTrainingSession(data, "first", "2026-10-01", new Date("2026-10-01T09:45:00Z"));
  const one = buildLoadTrace(data), two = buildLoadTrace(data);
  const alphaRow = one.rows.find((row) => row.row === 26 && row.groupIndex === 0)!;
  const betaRow = one.rows.find((row) => row.row === 26 && row.groupIndex === 1)!;
  assert.equal(alphaRow.lastLoad, betaRow.planLoad);
  assert.equal(alphaRow.todayInitialOrigin, "NONE");
  assert.notEqual(alphaRow.planLoad, alphaRow.lastLoad);
  assert.notEqual(alphaRow.planLoad, two.rows.find((row) => row.row === 26 && row.groupIndex === 0)?.planLoad);
  const exported = JSON.stringify(one);
  const stored = JSON.stringify(sanitizeDebugReport({ debugReportVersion: 1, loadTrace: one }));
  for (const secret of ["Exercise Alpha", "Exercise Beta", '"15"', '"8"']) {
    assert(!exported.includes(secret)); assert(!stored.includes(secret));
  }
  assert(stored.includes(String(alphaRow.lastLoad)));
});
