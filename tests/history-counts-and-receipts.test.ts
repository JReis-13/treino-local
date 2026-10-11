import assert from "node:assert/strict";
import test from "node:test";
import { addTraining, refreshTraining } from "../lib/training/library";
import { planSessionCount, sourceOccurrenceAudit } from "../lib/training/counts";
import { emptyTrainingData, parseTrainingData } from "../lib/training/storage";
import { readDiagnosticReceipts, rememberDiagnosticReceipt } from "../lib/diagnostic-receipts";
import { sharedDurationLabel } from "../lib/social/display";
import type { ImportedTraining, TrainingData, TrainingSession } from "../types/training";

const sheetId = "syntheticSpreadsheet1234567890";
function source(name: string, dates: string[], workbook: string): ImportedTraining {
  return { name, sourceFingerprint: workbook, source: { kind: "google", filename: "private", template: "jonatha-v1",
    mappings: {}, authMode: "oauth", spreadsheetId: sheetId + workbook, sourceProof: "a".repeat(43) }, warnings: [],
    workouts: [{ id: "A", title: "Workout A", description: "", blocks: [
      { kind: "exercise", id: "EX", section: "Strength", name: "Exercise", prescription: "3x8" }] }],
    legacyCompletions: dates.map((date, index) => ({ id: `A:E${index + 5}:${date}`, workoutId: "A",
      sourceSlot: `E${index + 5}`, date })) };
}
function local(planId: string, id: string, date: string, receiptSlot?: string): TrainingSession {
  return { id, planId, planVersion: 1, workoutId: "A", workoutSnapshot: { id: "A", title: "Workout A",
    description: "", blocks: [{ kind: "exercise", id: "EX", section: "Strength", name: "Exercise", prescription: "3x8" }] },
    status: "completed", startedAt: `${date}T08:00:00Z`, completedAt: `${date}T09:00:00Z`, localDate: date,
    blocks: [{ blockId: "EX", completed: true, actualLoad: "12" }], syncStatus: receiptSlot ? "synced" : "pending",
    ...(receiptSlot ? { completionReceipt: { sourceKind: "google" as const, sourceId: sheetId + "J",
      workoutId: "A", slot: receiptSlot, syncedAt: `${date}T09:01:00Z` } } : {}) };
}

test("selected-plan completed sessions and current Sheet records stay distinct across switching and reload", () => {
  const jonatha = source("Jonatha", Array.from({ length: 9 }, (_, index) => `2026-09-${String(index + 1).padStart(2, "0")}`), "J");
  const milena = source("Milena", ["2026-09-01", "2026-09-02"], "M");
  let data: TrainingData = addTraining(emptyTrainingData(), jonatha, undefined, undefined, "J");
  data = addTraining(data, milena, undefined, undefined, "M");
  assert.equal(planSessionCount(data, "J"), 9);
  assert.equal(planSessionCount(data, "M"), 2);
  data = { ...data, activePlanId: "J", sessions: [local("J", "offline", "2026-09-01")] };
  assert.equal(planSessionCount(data, "J"), 10, "pending same-day local workout has no source receipt");
  data = { ...data, sessions: [local("J", "linked", "2026-09-01", "E5")] };
  assert.equal(planSessionCount(data, "J"), 9, "exact source receipt collapses one duplicate");
  data = { ...data, activePlanId: "M" };
  assert.equal(planSessionCount(data, "M"), 2);
  data = parseTrainingData(JSON.stringify({ ...data, activePlanId: "J" }));
  assert.equal(planSessionCount(data, "J"), 9);
  const removed = { ...jonatha, legacyCompletions: jonatha.legacyCompletions.slice(0, 8) };
  data = refreshTraining(data, "J", removed);
  assert.equal(planSessionCount(data, "J"), 8);
  assert.equal(planSessionCount(data, "M"), 2);
  data = refreshTraining(data, "J", jonatha);
  assert.equal(planSessionCount(data, "J"), 9);
  assert.equal(sourceOccurrenceAudit(data, data.plans.find((item) => item.id === "J")!).length, 9);
});

test("a local hidden source occurrence remains visible in the verified Sheet count", () => {
  const imported = source("Plan", ["2026-09-01", "2026-09-02"], "J");
  const data = addTraining(emptyTrainingData(), imported, undefined, undefined, "J");
  const hidden = data.plans[0].legacyCompletions[1];
  const next = { ...data, hiddenLegacyCompletions: [{ planId: "J", ...hidden }] };
  assert.equal(planSessionCount(next, "J"), 1);
  assert.equal(sourceOccurrenceAudit(next, next.plans[0]).length, 2);
  assert.deepEqual(sourceOccurrenceAudit(next, next.plans[0]).map((item) => item.includedInHome), [true, false]);
});

test("recent diagnostic receipts keep only validated IDs and metadata, never report bodies", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } };
  const code = "TL-42UGN7NF";
  const receipt = { code, sentAt: "2026-10-11T10:00:00.000Z", result: "sent" as const, buildId: "fed2ba30-20261009T183353" };
  assert.equal(rememberDiagnosticReceipt(receipt, storage)[0].code, code);
  assert.deepEqual(readDiagnosticReceipts(storage), [receipt]);
  assert(![...values.values()].join(" ").includes("workoutName"));
  assert.throws(() => rememberDiagnosticReceipt({ ...receipt, code: "BAD" }, storage));
});

test("social display never presents unknown or rounded-zero duration as measured zero minutes", () => {
  assert.equal(sharedDurationLabel(null), null);
  assert.equal(sharedDurationLabel(0), null);
  assert.equal(sharedDurationLabel(42), "42 min");
});
