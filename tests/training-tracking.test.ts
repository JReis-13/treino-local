import assert from "node:assert/strict";
import test from "node:test";
import { createBackup, parseBackup } from "../lib/training/backup";
import { normalizeLoad, lastUsedLoad } from "../lib/training/loads";
import { finishTrainingSession, sameDaySessions, startTrainingSession, updateTrainingBlock } from "../lib/training/session";
import { emptyTrainingData, parseTrainingData } from "../lib/training/storage";
import { filteredEntries, loadProgression, numericLoad, statsOverview } from "../lib/training/statistics";
import type { TrainingData, TrainingPlanRecord } from "../types/training";

const plan: TrainingPlanRecord = { id: "plan", name: "Training", source: { kind: "builtin", label: "Local" },
  version: 1, importedAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", importWarnings: [], legacyCompletions: [
    { id: "legacy", workoutId: "A", date: "2026-09-01", sourceSlot: "E5" }], workouts: [{ id: "A", title: "Workout A", description: "",
    blocks: [{ kind: "exercise", id: "A-squat", section: "Strength", name: "Squat", prescription: "3x8", defaultLoad: "7.5" }] },
    { id: "B", title: "Workout B", description: "", blocks: [{ kind: "instruction", id: "B-note", section: "Cardio", heading: "Walk", text: "Walk" }] }] };
const base = (): TrainingData => ({ ...emptyTrainingData(), plans: [structuredClone(plan)], activePlanId: "plan" });

test("same-day Add keeps unique sessions, Replace preserves ID and remote receipt, Cancel leaves data unchanged", () => {
  const first = startTrainingSession(base(), "plan", "A", new Date("2026-10-03T08:00:00Z"), "first");
  const firstDone = finishTrainingSession(updateTrainingBlock(first.data, "first", "A-squat", { completed: true, actualLoad: "8" }),
    "first", "2026-10-03", new Date("2026-10-03T08:40:00Z"));
  firstDone.sessions[0].completionReceipt = { sourceKind: "google", sourceId: "sheet", workoutId: "A", slot: "E5", syncedAt: "2026-10-03T08:41:00Z" };
  firstDone.sessions[0].completionSyncStatus = "synced";
  const second = startTrainingSession(firstDone, "plan", "A", new Date("2026-10-03T18:00:00Z"), "second");
  assert.equal(second.session.blocks[0].actualLoad, "8");
  assert.equal(sameDaySessions(second.data, "second", "2026-10-03").length, 1);
  assert.throws(() => finishTrainingSession(second.data, "second", "2026-10-03"), /Choose whether/);
  assert.equal(second.data.sessions.filter((item) => item.status === "completed").length, 1);
  const added = finishTrainingSession(second.data, "second", "2026-10-03", new Date("2026-10-03T18:40:00Z"), "add");
  assert.deepEqual(new Set(added.sessions.map((item) => item.id)), new Set(["first", "second"]));
  assert.equal(added.sessions.find((item) => item.id === "second")?.duplicateDateAllowed, true);
  const third = startTrainingSession(added, "plan", "A", new Date("2026-10-03T20:00:00Z"), "third");
  const replaced = finishTrainingSession(third.data, "third", "2026-10-03", new Date("2026-10-03T20:45:00Z"), "replace", "first");
  assert.equal(replaced.sessions.length, 2);
  assert.equal(replaced.sessions.find((item) => item.id === "first")?.completionReceipt?.slot, "E5");
  assert.equal(replaced.sessions.some((item) => item.id === "third"), false);
  const other = startTrainingSession(replaced, "plan", "B", new Date("2026-10-03T21:00:00Z"), "b");
  assert.equal(finishTrainingSession(other.data, "b", "2026-10-03").sessions.length, 3);
});

test("previous load and decimal normalization use local actual history without changing plan load", () => {
  let data = base();
  data = startTrainingSession(data, "plan", "A", new Date("2026-10-01T08:00:00Z"), "one").data;
  assert.equal(data.sessions[0].blocks[0].actualLoad, "7.5");
  data = updateTrainingBlock(data, "one", "A-squat", { completed: true, actualLoad: "8,75" });
  data = finishTrainingSession(data, "one", "2026-10-01");
  assert.equal(data.sessions[0].blocks[0].actualLoad, "8.75");
  assert.equal(lastUsedLoad(data, "plan", "A-squat"), "8.75");
  assert.equal(startTrainingSession(data, "plan", "A", new Date("2026-10-02T08:00:00Z"), "two").session.blocks[0].actualLoad, "8.75");
  assert.equal(data.plans[0].workouts[0].blocks[0].kind === "exercise" && data.plans[0].workouts[0].blocks[0].defaultLoad, "7.5");
  assert.equal(normalizeLoad("7,5"), "7.5");
  assert.equal(normalizeLoad("15kg (17.5kg no final)"), "15kg (17.5kg no final)");
});

test("v2 production data and v1 backup migrate without dropping sessions or source metadata", () => {
  const data = base();
  const started = startTrainingSession(data, "plan", "A", new Date("2026-10-01T08:00:00Z"), "ongoing").data;
  const old = { ...started, schemaVersion: 2 };
  const migrated = parseTrainingData(JSON.stringify(old));
  assert.equal(migrated.schemaVersion, 5);
  assert.equal(migrated.activePlanId, "plan");
  assert.equal(migrated.sessions[0].id, "ongoing");
  assert.equal(migrated.sessions[0].blocks[0].actualLoad, "7.5");
  const v1 = JSON.stringify({ format: "treino-local-backup", version: 1, createdAt: "2026-10-03T00:00:00Z", data: old });
  assert.equal(parseBackup(v1).data.sessions[0].id, "ongoing");
  const v3 = JSON.parse(createBackup(migrated));
  assert.equal(v3.version, 3);
  assert.equal(parseBackup(JSON.stringify(v3)).data.schemaVersion, 5);
  const oldV2Backup = { ...v3, version: 2, data: { ...v3.data, schemaVersion: 3, exerciseNotes: undefined } };
  assert.equal(parseBackup(JSON.stringify(oldV2Backup)).data.sessions[0].id, "ongoing");
  const productionV3 = { ...started, schemaVersion: 3, exerciseNotes: undefined };
  const migratedV3 = parseTrainingData(JSON.stringify(productionV3));
  assert.equal(migratedV3.schemaVersion, 5);
  assert.deepEqual(migratedV3.exerciseNotes, []);
  assert.equal(migratedV3.sessions[0].id, "ongoing");
  const completed = finishTrainingSession(started, "ongoing", "2026-10-01", new Date("2026-10-01T08:40:00Z"));
  const productionWithSource = { ...completed, schemaVersion: 3, exerciseNotes: undefined,
    plans: completed.plans.map((item) => ({ ...item, source: { kind: "google", filename: "Training", template: "jonatha-v1",
      mappings: {}, authMode: "oauth", spreadsheetId: "a12345678901234567890123", sourceProof: "a".repeat(43), syncEnabled: true } })),
    sessions: completed.sessions.map((item) => ({ ...item, completionReceipt: { sourceKind: "google", sourceId: "a12345678901234567890123",
      workoutId: "A", slot: "E5", syncedAt: "2026-10-01T08:41:00Z" }, completionSyncStatus: "synced", loadSyncStatus: "pending" })) };
  const current = parseTrainingData(JSON.stringify(productionWithSource));
  assert.equal(current.schemaVersion, 5);
  assert.deepEqual(current.plans, JSON.parse(JSON.stringify(productionWithSource.plans)));
  assert.equal(current.sessions[0].completionSyncStatus, "synced");
  assert.equal(current.sessions[0].loadSyncStatus, "notApplicable");
  assert.equal(current.sessions[0].syncStatus, "synced");
  assert.deepEqual(current.exerciseNotes, []);
});

test("statistics distinguish imported dates from timed, load-bearing local sessions", () => {
  let data = base();
  data = startTrainingSession(data, "plan", "A", new Date("2026-10-02T08:00:00Z"), "one").data;
  data = updateTrainingBlock(data, "one", "A-squat", { completed: true, actualLoad: "8" });
  data = finishTrainingSession(data, "one", "2026-10-02", new Date("2026-10-02T08:40:00Z"));
  const entries = filteredEntries(data, "all", "all", "all", "2026-10-03");
  assert.equal(entries.length, 2);
  const overview = statsOverview(entries, "all", "2026-10-03");
  assert.equal(overview.workouts, 2);
  assert.equal(overview.averageDuration, 40);
  assert.equal(overview.durationSample, 1);
  assert.equal(overview.exercisesCompleted, 1);
  assert.deepEqual(loadProgression(entries, "A-squat").points.map((point) => point.amount), [8]);
  assert.equal(numericLoad("7,5kg")?.amount, 7.5);
  assert.equal(numericLoad("15kg (17.5kg no final)"), undefined);
  assert.equal(filteredEntries(data, "plan", "B", "4w", "2026-10-03").length, 0);
});
