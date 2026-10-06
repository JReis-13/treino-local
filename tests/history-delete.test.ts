import assert from "node:assert/strict";
import test from "node:test";
import { deleteCompletedHistory, deleteLegacyHistory, legacyIsHidden } from "../lib/training/history-delete";
import { historyEntries, loadProgression, statsOverview } from "../lib/training/statistics";
import { sameDaySessions, startTrainingSession } from "../lib/training/session";
import type { TrainingData, TrainingSession } from "../types/training";

const workout = { id: "A", title: "Workout A", description: "", blocks: [
  { kind: "exercise" as const, id: "squat", section: "Strength", name: "Squat", prescription: "3x10" }] };
const legacy = { id: "source-1", workoutId: "A", date: "2026-10-04", sourceSlot: "A!F4" };
function fixture(): TrainingData {
  return { schemaVersion: 5, activePlanId: "P", exerciseNotes: [], plans: [{ id: "P", name: "Plan", version: 1,
    source: { kind: "builtin", label: "Local" }, importedAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z", workouts: [workout], importWarnings: [], legacyCompletions: [legacy] }],
  sessions: [{ id: "S", planId: "P", planVersion: 1, workoutId: "A", workoutSnapshot: workout,
    status: "completed", startedAt: "2026-10-04T08:00:00Z", completedAt: "2026-10-04T08:40:00Z",
    localDate: "2026-10-04", blocks: [{ blockId: "squat", completed: true, actualLoad: "SECRET_LOAD_99" }],
    syncStatus: "synced", completionReceipt: { sourceKind: "google", sourceId: "source-id", workoutId: "A",
      slot: "A!F4", syncedAt: "2026-10-04T08:42:00Z" } }] as TrainingSession[] };
}
test("deleting a completed History session removes statistics, loads and same-day candidates, preserving source metadata", () => {
  const before = fixture();
  assert.equal(historyEntries(before).length, 1);
  const after = deleteCompletedHistory(before, "S");
  assert.equal(after.sessions.length, 0);
  assert.equal(historyEntries(after).length, 0);
  assert.equal(statsOverview(historyEntries(after), "all", "2026-10-06").workouts, 0);
  assert.equal(loadProgression(historyEntries(after), "squat").points.length, 0);
  assert.deepEqual(after.plans[0].legacyCompletions, before.plans[0].legacyCompletions);
  const active = startTrainingSession(after, "P", "A", new Date("2026-10-04T18:00:00Z"), "S2");
  assert.equal(sameDaySessions(active.data, "S2", "2026-10-04").length, 0);
  assert.throws(() => deleteCompletedHistory(active.data, "S2"));
});
test("legacy date deletion is a local tombstone only and unrelated dates remain", () => {
  const before = fixture();
  before.sessions = [];
  before.plans[0].legacyCompletions.push({ ...legacy, id: "other", date: "2026-10-03", sourceSlot: "A!F5" });
  const after = deleteLegacyHistory(before, "P", "source-1");
  assert.equal(historyEntries(after).length, 1);
  assert.equal(legacyIsHidden(after, "P", legacy), true);
  assert.deepEqual(after.plans[0].legacyCompletions, before.plans[0].legacyCompletions);
});
