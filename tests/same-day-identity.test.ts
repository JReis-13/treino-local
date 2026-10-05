import assert from "node:assert/strict";
import test from "node:test";
import { refreshTraining } from "../lib/training/library";
import { finalizeTrainingSession, sameDaySessions, startTrainingSession } from "../lib/training/session";
import { parseTrainingData, trainingStorage } from "../lib/training/storage";
import { sameDayDecision } from "../lib/training/identity";
import type { ImportedTraining, TrainingData, TrainingPlanRecord, TrainingSession, TrainingWorkout } from "../types/training";

const date = "2026-10-04";
const workout = (id: string, title = "Workout A"): TrainingWorkout => ({ id, title, description: "",
  blocks: [{ kind: "exercise", id: "squat", section: "Strength", name: "Squat", prescription: "3x10" }] });
const plan = (id: string, workoutId = "OLD123"): TrainingPlanRecord => ({ id, name: "Plan", source: { kind: "builtin", label: "Local" },
  version: 1, importedAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", workouts: [workout(workoutId)],
  importWarnings: [], legacyCompletions: [] });
const oldSession = (planId = "P1", workoutId = "OLD123"): TrainingSession => ({ id: "S1", planId, planVersion: 1,
  workoutId, workoutSnapshot: workout(workoutId), status: "completed", startedAt: "2026-10-04T08:00:00Z",
  completedAt: "2026-10-04T08:40:00Z", localDate: date, blocks: [{ blockId: "squat", completed: true }], syncStatus: "notApplicable" });
const raw = (schemaVersion: number, withoutVersion = false) => JSON.stringify({ schemaVersion, activePlanId: "P1",
  plans: [plan("P1")], sessions: [withoutVersion ? (() => {
    const session: Partial<TrainingSession> = { ...oldSession() };
    delete session.planVersion;
    return session;
  })() : oldSession()],
  exerciseNotes: [] });

test("v2–v5 and missing-version History survive actual storage migration and match a refreshed workout ID", () => {
  for (const schema of [2, 3, 4, 5]) for (const withoutVersion of [false, true]) {
    const values = new Map([["treino-local:v2", raw(schema, withoutVersion)]]);
    const prior = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    } });
    try {
      const loaded = trainingStorage.load();
      assert.equal(loaded.error, undefined);
      assert.equal(loaded.data.sessions[0].planVersion, 1);
      const imported: ImportedTraining = { name: "Plan", source: { kind: "builtin", label: "Local" },
        sourceFingerprint: "updated", workouts: [workout("NEW456")], warnings: [], legacyCompletions: [] };
      const refreshed = refreshTraining(loaded.data, "P1", imported);
      const started = startTrainingSession(refreshed, "P1", "NEW456", new Date("2026-10-04T18:00:00Z"), "S2");
      assert.equal(sameDaySessions(started.data, "S2", date).length, 1);
      assert.equal(sameDayDecision(started.data, started.session, loaded.data.sessions[0], date).reason, "MATCH_WORKOUT_LINEAGE");
      const added = finalizeTrainingSession(started.data, "S2", date, new Date("2026-10-04T18:40:00Z"), "add");
      assert.deepEqual(new Set(added.data.sessions.map((item) => item.id)), new Set(["S1", "S2"]));
      const third = startTrainingSession(added.data, "P1", "NEW456", new Date("2026-10-04T20:00:00Z"), "S3");
      const replaced = finalizeTrainingSession(third.data, "S3", date, new Date("2026-10-04T20:40:00Z"), "replace", "S1");
      assert.equal(replaced.session.id, "S1");
      assert.equal(replaced.data.sessions.length, 2);
      assert.equal(replaced.data.sessions.some((item) => item.id === "S3"), false);
    } finally { Object.defineProperty(globalThis, "localStorage", { configurable: true, value: prior }); }
  }
});

test("reconstructed workout IDs use an unambiguous snapshot title, but unrelated plans and ambiguous names do not collide", () => {
  let data = parseTrainingData(raw(5));
  data = { ...data, plans: [{ ...data.plans[0], version: 2, workouts: [workout("NEW456")] }] };
  const current = startTrainingSession(data, "P1", "NEW456", new Date("2026-10-04T18:00:00Z"), "S2");
  assert.equal(sameDayDecision(current.data, current.session, oldSession(), date).reason, "MATCH_UNIQUE_TITLE");
  assert.equal(sameDaySessions(current.data, "S2", date).length, 1);
  const otherPlan: TrainingData = { ...current.data, plans: [...current.data.plans, plan("P2", "NEW456")] };
  const other = startTrainingSession(otherPlan, "P2", "NEW456", new Date("2026-10-04T19:00:00Z"), "S3");
  assert.equal(sameDaySessions(other.data, "S3", date).length, 0);
  assert.equal(sameDayDecision(other.data, other.session, oldSession(), date).reason, "PLAN_LINEAGE_MISMATCH");
  const ambiguous: TrainingData = { ...current.data, plans: [{ ...current.data.plans[0],
    workouts: [workout("NEW456"), workout("ANOTHER", "Workout A")] }] };
  assert.equal(sameDaySessions(ambiguous, "S2", date).length, 0);
  assert.equal(sameDayDecision(ambiguous, current.session, oldSession(), date).reason, "LEGACY_IDENTITY_AMBIGUOUS");
});

test("a reimported Google Sheet retains plan identity across local plan IDs", () => {
  const spreadsheetId = "a".repeat(44);
  const googleSource = { kind: "google" as const, spreadsheetId, filename: "Plan", template: "google", mappings: {} };
  const oldPlan = { ...plan("P1", "OLD123"), source: googleSource };
  const newPlan = { ...plan("P2", "NEW456"), source: googleSource };
  const historical = { ...oldSession(), planId: "P1", planLineageKey: `google:${spreadsheetId}` };
  const data: TrainingData = { ...parseTrainingData(raw(5)), plans: [oldPlan, newPlan],
    sessions: [historical], activePlanId: "P2" };
  const started = startTrainingSession(data, "P2", "NEW456", new Date("2026-10-04T18:00:00Z"), "S2");
  assert.equal(sameDayDecision(started.data, started.session, historical, date).reason, "MATCH_UNIQUE_TITLE");
  assert.equal(sameDaySessions(started.data, "S2", date).length, 1);
  const differentSheet = { ...data, plans: [oldPlan, { ...newPlan, source: { ...googleSource, spreadsheetId: "b".repeat(44) } }] };
  const unrelated = startTrainingSession(differentSheet, "P2", "NEW456", new Date("2026-10-04T18:00:00Z"), "S3");
  assert.equal(sameDayDecision(unrelated.data, unrelated.session, historical, date).reason, "PLAN_LINEAGE_MISMATCH");
});

test("the local calendar date wins over UTC, while imported source-only dates stay distinct from full sessions", () => {
  const completed = { ...oldSession(), completedAt: "2026-10-04T23:30:00Z", localDate: "2026-10-05" };
  const data: TrainingData = { schemaVersion: 5, plans: [{ ...plan("P1"), legacyCompletions: [
    { id: "source-only", workoutId: "OLD123", date: date, sourceSlot: "E5" }] }], sessions: [completed],
    activePlanId: "P1", exerciseNotes: [] };
  const started = startTrainingSession(data, "P1", "OLD123", new Date("2026-10-04T19:00:00Z"), "S2");
  assert.equal(sameDaySessions(started.data, "S2", date).length, 0);
  assert.equal(sameDaySessions(started.data, "S2", "2026-10-05").length, 1);
});
