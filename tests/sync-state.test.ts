import assert from "node:assert/strict";
import test from "node:test";
import { aggregateSync, withSyncStatus } from "../lib/training/sync-state";
import { parseTrainingData } from "../lib/training/storage";
import { finishTrainingSession, startTrainingSession, updateTrainingBlock } from "../lib/training/session";
import { emptyTrainingData } from "../lib/training/storage";
import type { TrainingData, TrainingPlanRecord, TrainingSession } from "../types/training";
import { plannedCompletionSlot } from "../lib/sync/logic";

const plan: TrainingPlanRecord = { id: "plan", name: "Test", source: { kind: "excel", filename: "copy.xlsx", template: "test", mappings: {}, mode: "copy" },
  version: 1, importedAt: "2026-10-04T00:00:00Z", updatedAt: "2026-10-04T00:00:00Z", importWarnings: [], legacyCompletions: [],
  workouts: [{ id: "A", title: "A", description: "", blocks: [{ kind: "exercise", id: "one", section: "One", name: "One", prescription: "3x8", defaultLoad: "5" }] }] };
const base = (): TrainingData => ({ ...emptyTrainingData(), plans: [plan], activePlanId: plan.id });
const receipt = { sourceKind: "excel" as const, sourceId: "copy.xlsx", workoutId: "A", slot: "E5", syncedAt: "2026-10-04T09:00:00Z" };

function completed(load = "5") {
  let data = startTrainingSession(base(), "plan", "A", new Date("2026-10-04T08:00:00Z"), "one").data;
  data = updateTrainingBlock(data, "one", "one", { completed: true, actualLoad: load });
  return finishTrainingSession(data, "one", "2026-10-04", new Date("2026-10-04T08:40:00Z"));
}

test("receipt and no required load clear stale pending across reload and History state", () => {
  const data = completed();
  data.sessions[0] = { ...data.sessions[0], completionReceipt: receipt, completionSyncStatus: "pending", loadSyncStatus: "pending", syncStatus: "pending" };
  const recovered = parseTrainingData(JSON.stringify(data));
  assert.equal(aggregateSync(recovered.sessions[0]), "synced");
  assert.equal(recovered.sessions[0].syncStatus, "synced");
  assert.equal(recovered.sessions[0].loadSyncStatus, "notApplicable");
  assert.equal(parseTrainingData(JSON.stringify(recovered)).sessions[0].syncStatus, "synced");
});

test("completion and load successes are independent; source status ignores social publish", () => {
  const data = completed("9");
  let session = withSyncStatus(data.sessions[0], { completionReceipt: receipt, completionSyncStatus: "synced" });
  assert.equal(session.syncStatus, "pending");
  session = withSyncStatus(session, { loadSyncStatus: "failed" });
  assert.equal(session.syncStatus, "partial");
  session = withSyncStatus(session, { loadSyncStatus: "synced" });
  assert.equal(session.syncStatus, "synced");
  // The social outbox is a separate localStorage domain and is not part of TrainingSession.
  assert.equal(aggregateSync({ ...session, syncStatus: "pending" } as TrainingSession), "synced");
});

test("offline save remains pending; verified operations survive reconnect and reload", () => {
  let session = completed("9").sessions[0];
  assert.equal(session.syncStatus, "pending");
  session = parseTrainingData(JSON.stringify({ ...base(), sessions: [session] })).sessions[0];
  assert.equal(session.syncStatus, "pending");
  session = withSyncStatus(session, { completionReceipt: receipt, completionSyncStatus: "synced" });
  assert.equal(session.syncStatus, "pending");
  session = withSyncStatus(session, { loadSyncStatus: "synced" });
  assert.equal(parseTrainingData(JSON.stringify({ ...base(), sessions: [session] })).sessions[0].syncStatus, "synced");
});

test("same-day Replace keeps a verified completion receipt and tracks changed loads", () => {
  let data = completed("9");
  data.sessions[0] = withSyncStatus(data.sessions[0], { completionReceipt: receipt, completionSyncStatus: "synced", loadSyncStatus: "synced" });
  data = startTrainingSession(data, "plan", "A", new Date("2026-10-04T10:00:00Z"), "replacement").data;
  data = updateTrainingBlock(data, "replacement", "one", { completed: true, actualLoad: "10" });
  const replaced = finishTrainingSession(data, "replacement", "2026-10-04", new Date("2026-10-04T10:40:00Z"), "replace", "one");
  assert.equal(replaced.sessions.length, 1);
  assert.equal(replaced.sessions[0].completionReceipt?.slot, "E5");
  assert.equal(replaced.sessions[0].completionSyncStatus, "synced");
  assert.equal(replaced.sessions[0].loadSyncStatus, "pending");
});

test("interrupted Google completion reconciles only its persisted intended slot", () => {
  const source = { kind: "google" as const, filename: "Test", template: "test", mappings: {
    A: { sheetName: "A", slots: ["E5", "E6"], ordinalCells: [] },
  } };
  const imported = { name: "Test", source, sourceFingerprint: "12345678", workouts: [], warnings: [],
    legacyCompletions: [{ id: "old", workoutId: "A", date: "2026-10-04", sourceSlot: "E5" }] };
  assert.equal(plannedCompletionSlot(imported, "A"), "E6");
  const session = { ...completed().sessions[0], completionAttempted: true, preparedCompletionSlot: "E6" };
  assert.equal(imported.legacyCompletions.some((entry) => entry.sourceSlot === session.preparedCompletionSlot), false);
  imported.legacyCompletions.push({ id: "new", workoutId: "A", date: "2026-10-04", sourceSlot: "E6" });
  assert.equal(imported.legacyCompletions.filter((entry) => entry.sourceSlot === session.preparedCompletionSlot).length, 1);
});
