import assert from "node:assert/strict";
import test from "node:test";
import { WORKOUTS } from "../data/workouts";
import { addTraining, refreshTraining, removeTraining } from "../lib/training/library";
import { finishTrainingSession, startTrainingSession, updateTrainingBlock } from "../lib/training/session";
import { emptyTrainingData, migrateV1, parseTrainingData } from "../lib/training/storage";
import type { ImportedTraining } from "../types/training";

const imported = (name: string, workoutId = "A"): ImportedTraining => ({
  name, source: { kind: "builtin", label: name }, sourceFingerprint: name,
  workouts: [{ id: workoutId, title: `Workout ${workoutId}`, description: name,
    blocks: [{ kind: "exercise", id: `${workoutId}-1`, section: "Strength", name: "Exercise", prescription: "3x8" }] }],
  warnings: [], legacyCompletions: [],
});

test("first launch is empty and returning user keeps active training", () => {
  const empty = emptyTrainingData();
  assert.equal(empty.plans.length, 0);
  const withPlan = addTraining(empty, imported("First"), undefined, "2026-09-30T08:00:00Z", "first");
  const second = addTraining(withPlan, imported("Second", "C"), undefined, "2026-09-30T09:00:00Z", "second");
  assert.equal(parseTrainingData(JSON.stringify(second)).activePlanId, "second");
});

test("sessions and history stay with their plan when switching", () => {
  let data = addTraining(emptyTrainingData(), imported("First"), undefined, "2026-09-30T08:00:00Z", "first");
  data = addTraining(data, imported("Second", "C"), undefined, "2026-09-30T08:00:00Z", "second");
  const created = startTrainingSession(data, "first", "A", new Date("2026-09-30T08:00:00Z"), "one");
  data = updateTrainingBlock(created.data, "one", "A-1", { completed: true, actualLoad: "7.5" });
  data = finishTrainingSession(data, "one", "2026-09-30", new Date("2026-09-30T09:00:00Z"));
  assert.equal(data.sessions.filter((session) => session.planId === "second").length, 0);
  assert.equal(data.sessions[0].blocks[0].actualLoad, "7.5");
  const updated = refreshTraining(data, "first", imported("Changed"));
  assert.equal(updated.plans[0].version, 2);
  assert.equal(updated.sessions[0].planVersion, 1);
  assert.equal(updated.sessions[0].workoutSnapshot.description, "First");
  assert.equal(removeTraining(updated, "first").sessions.length, 1);
});

test("v1 sessions migrate without losing loads, dates or in-progress progress", () => {
  const old = {
    schemaVersion: 1, sessions: [
      { id: "done", workoutId: "A", planVersion: WORKOUTS.A.planVersion, status: "completed", startedAt: "2026-09-29T08:00:00Z", completedAt: "2026-09-29T09:00:00Z", localDate: "2026-09-29", syncStatus: "notConfigured", exercises: WORKOUTS.A.exercises.map((exercise, index) => ({ exerciseId: exercise.id, completed: index === 0, actualLoad: index === 3 ? "9" : undefined })) },
      { id: "ongoing", workoutId: "B", planVersion: WORKOUTS.B.planVersion, status: "inProgress", startedAt: "2026-09-30T08:00:00Z", syncStatus: "notConfigured", exercises: WORKOUTS.B.exercises.map((exercise, index) => ({ exerciseId: exercise.id, completed: index === 0 })) },
    ],
  };
  const migrated = migrateV1(JSON.stringify(old));
  assert.equal(migrated.plans.length, 1);
  assert.equal(migrated.activePlanId, "legacy-jonatha");
  assert.equal(migrated.sessions[0].localDate, "2026-09-29");
  assert.equal(migrated.sessions[0].blocks[3].actualLoad, "9");
  assert.equal(migrated.sessions[1].blocks[0].completed, true);
  assert.equal(parseTrainingData(JSON.stringify(migrated)).sessions.length, 2);
});
