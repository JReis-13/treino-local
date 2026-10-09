import assert from "node:assert/strict";
import test from "node:test";
import { addTraining, refreshTraining } from "../lib/training/library";
import { historyEntries } from "../lib/training/statistics";
import { parseTrainingData, emptyTrainingData } from "../lib/training/storage";
import { sessionsWaitingForSource } from "../lib/sync/logic";
import type { ImportedTraining, TrainingSession } from "../types/training";

const sheetId = "syntheticSheetIdentity123456";
const fingerprint = "12345678";
const workout = { id: "B", title: "Workout B", description: "",
  blocks: [{ kind: "exercise" as const, id: "E1", name: "Exercise", section: "Strength", prescription: "3x8" }] };
function source(count: number): ImportedTraining {
  return { name: "Plan", sourceFingerprint: fingerprint, source: { kind: "google", filename: "private",
    template: "jonatha-v1", mappings: {}, authMode: "oauth", spreadsheetId: sheetId,
    sourceProof: "a".repeat(43), syncEnabled: true }, workouts: [workout], warnings: [],
    legacyCompletions: Array.from({ length: count }, (_, index) => {
      const date = `2026-09-${String(index + 1).padStart(2, "0")}`;
      const sourceSlot = `E${index + 5}`;
      return { id: `B:${sourceSlot}:${date}`, workoutId: "B", date, sourceSlot };
    }) };
}
function session(id: string, date: string, receiptSlot?: string): TrainingSession {
  return { id, planId: "plan", planVersion: 1, workoutId: "B", workoutSnapshot: workout,
    status: "completed", startedAt: `${date}T08:00:00Z`, completedAt: `${date}T08:40:00Z`,
    localDate: date, blocks: [{ blockId: "E1", completed: true }],
    syncStatus: receiptSlot ? "synced" : "pending",
    completionSyncStatus: receiptSlot ? "synced" : "pending",
    ...(receiptSlot ? { completionReceipt: { sourceKind: "google" as const, sourceId: sheetId,
      workoutId: "B", slot: receiptSlot, syncedAt: `${date}T08:42:00Z` } } : {}) };
}

test("verified 30-to-8 source refresh archives deleted occurrences and detailed sessions without double counting", () => {
  let data = addTraining(emptyTrainingData(), source(30), undefined, "2026-10-01T00:00:00Z", "plan");
  const linked = session("linked", "2026-09-20", "E24");
  const offline = session("offline", "2026-10-01");
  data = { ...data, sessions: [linked, offline] };
  const refreshed = parseTrainingData(JSON.stringify(refreshTraining(data, "plan", source(8))));
  assert.equal(refreshed.plans[0].legacyCompletions.length, 8);
  assert.equal(refreshed.plans[0].removedSourceCompletions?.length, 22);
  assert.equal(refreshed.sessions[0].sourceReconciliation, "removed");
  assert.equal(refreshed.sessions[1].sourceReconciliation, undefined);
  assert.equal(historyEntries(refreshed).length, 9, "8 current Sheet dates and one independent offline workout");
  assert.deepEqual(sessionsWaitingForSource(refreshed.sessions, "plan").map((item) => item.id), ["offline"]);
  const repeated = refreshTraining(refreshed, "plan", source(8));
  assert.equal(repeated.plans[0].legacyCompletions.length, 8);
  assert.equal(repeated.plans[0].removedSourceCompletions?.length, 22);
  assert.equal(historyEntries(repeated).length, 9);
  const restored = refreshTraining(repeated, "plan", source(30));
  assert.equal(restored.sessions[0].sourceReconciliation, undefined);
  assert.equal(restored.plans[0].removedSourceCompletions?.length, 0);
});

test("a previously attempted write to a deleted slot stays local and cannot auto retry", () => {
  let data = addTraining(emptyTrainingData(), source(10), undefined, "2026-10-01T00:00:00Z", "plan");
  const interrupted = { ...session("interrupted", "2026-09-10"),
    completionAttempted: true, preparedCompletionSlot: "E14" };
  data = { ...data, sessions: [interrupted] };
  const result = refreshTraining(data, "plan", source(8));
  assert.equal(result.sessions[0].sourceReconciliation, "conflict");
  assert.equal(sessionsWaitingForSource(result.sessions, "plan").length, 0);
  assert.equal(result.plans[0].lastReconciliation?.conflicts, 1);
});

test("one same-day local detail replaces one imported occurrence, while Add remains a separate workout", () => {
  const base = addTraining(emptyTrainingData(), source(8), undefined, "2026-10-01T00:00:00Z", "plan");
  const local = session("local", "2026-09-01");
  assert.equal(historyEntries({ ...base, sessions: [local] }).length, 8);
  assert.equal(historyEntries({ ...base, sessions: [{ ...local, duplicateDateAllowed: true }] }).length, 9);
  const secondOccurrence = { ...source(8).legacyCompletions[0], id: "B:E99:2026-09-01", sourceSlot: "E99" };
  const ambiguous = { ...base, plans: [{ ...base.plans[0],
    legacyCompletions: [...base.plans[0].legacyCompletions, secondOccurrence] }], sessions: [local] };
  assert.equal(historyEntries(ambiguous).length, 10, "two source slots are not guessed to match one local session");
});

test("unverified or failed Google source read cannot reconcile local History", () => {
  const data = addTraining(emptyTrainingData(), source(10), undefined, "2026-10-01T00:00:00Z", "plan");
  assert.throws(() => refreshTraining(data, "plan", { ...source(8), warnings: [{
    code: "completion-grid", location: "synthetic", message: "incomplete", severity: "syncBlocker" }] }), /verified/);
  assert.throws(() => refreshTraining(data, "plan", { ...source(8),
    source: { ...source(8).source, spreadsheetId: "differentSyntheticSheet1234" } as ImportedTraining["source"] }), /verified/);
  assert.equal(data.plans[0].legacyCompletions.length, 10);
});

test("a restored plan without its old write proof reconciles after a verified fresh Sheet read", () => {
  const imported = source(10);
  assert(imported.source.kind === "google");
  const restoredSource = { ...imported.source, sourceProof: undefined, syncEnabled: false };
  const data = addTraining(emptyTrainingData(), { ...imported, source: restoredSource },
    undefined, "2026-10-01T00:00:00Z", "plan");
  const next = refreshTraining(data, "plan", source(8));
  assert.equal(next.plans[0].legacyCompletions.length, 8);
  assert.equal(next.plans[0].removedSourceCompletions?.length, 2);
});
