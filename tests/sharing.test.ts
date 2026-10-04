import assert from "node:assert/strict";
import test from "node:test";
import { shareWorkout } from "../lib/training/share-action";
import { defaultShareText, shareDate, shareSummaryFromLegacy, shareSummaryFromSession } from "../lib/training/share-summary";
import type { TrainingSession } from "../types/training";

const session = (): TrainingSession => ({
  id: "private-id", planId: "private-plan", planVersion: 1, workoutId: "A", status: "completed",
  startedAt: "2026-10-03T08:00:00+02:00", completedAt: "2026-10-03T08:42:00+02:00", localDate: "2026-10-03",
  workoutSnapshot: { id: "A", title: "Treino rápido 💪", description: "private-description", blocks: [
    { kind: "exercise", id: "squat", section: "A", name: "Squat", prescription: "3x10", defaultLoad: "PRIVATE-PLAN-LOAD", note: "PRIVATE-EXERCISE-NOTE" },
    { kind: "exercise", id: "press", section: "A", name: "Press", prescription: "3x10" },
    { kind: "instruction", id: "warmup", section: "A", heading: "Warmup", text: "Private instruction" },
  ] },
  blocks: [{ blockId: "squat", completed: true, actualLoad: "PRIVATE-ACTUAL-LOAD" }, { blockId: "press", completed: false }, { blockId: "warmup", completed: true }],
  syncStatus: "failed", syncMessage: "PRIVATE-SYNC-STATUS", sessionNote: "PRIVATE-SESSION-NOTE",
  completionReceipt: { sourceKind: "google", sourceId: "PRIVATE-SHEET-ID", workoutId: "A", slot: "E5", syncedAt: "2026-10-03" },
});

test("share summary uses actual local date, duration and exercise-only partial count", () => {
  const summary = shareSummaryFromSession(session());
  assert.deepEqual(summary, { workoutName: "Treino rápido 💪", localDate: "2026-10-03", durationMinutes: 42, completedExercises: 1, totalExercises: 2 });
  assert.equal(defaultShareText(summary), "Treino rápido 💪 completed 💪\n42 min · 1/2 exercises completed\n03 Oct 2026");
  assert.equal(shareDate("2026-10-03"), "03 Oct 2026");
  assert.match(defaultShareText({ ...summary, durationMinutes: 0 }), /under 1 min/);
});

test("normal, same-day, older, missing-duration and date-only summaries remain honest", () => {
  const complete = session(); complete.blocks[1].completed = true;
  assert.equal(shareSummaryFromSession(complete).completedExercises, 2);
  const sameDay = { ...complete, id: "second", completedAt: "2026-10-03T19:12:00+02:00" };
  assert.equal(shareSummaryFromSession(sameDay).localDate, shareSummaryFromSession(complete).localDate);
  assert.deepEqual([shareSummaryFromSession({ ...complete, blocks: complete.blocks.slice(0, 1) }).completedExercises,
    shareSummaryFromSession({ ...complete, blocks: complete.blocks.slice(0, 1) }).totalExercises], [1, 2]);
  assert.equal(shareSummaryFromSession({ ...complete, blocks: [] }).totalExercises, undefined);
  const older = { ...complete, localDate: "2025-09-29" };
  assert.match(defaultShareText(shareSummaryFromSession(older)), /29 Sep 2025/);
  const missing = { ...complete, completedAt: undefined };
  const missingSummary = shareSummaryFromSession(missing);
  assert.equal(missingSummary.durationMinutes, undefined);
  assert.doesNotMatch(defaultShareText(missingSummary), /0 min/);
  const legacy = shareSummaryFromLegacy({ id: "legacy", workoutId: "A", date: "2026-10-03", sourceSlot: "E5" }, "Workout A");
  assert.deepEqual(legacy, { workoutName: "Workout A", localDate: "2026-10-03" });
  assert.doesNotMatch(defaultShareText(legacy), /exercises|min/);
});

test("six completed and two skipped share as 6/8 without exposing skip details", () => {
  const source = session();
  source.workoutSnapshot.blocks = Array.from({ length: 8 }, (_, index) => ({ kind: "exercise", id: `exercise-${index}`, section: "A", name: `Exercise ${index}`, prescription: "3x10" }));
  source.blocks = Array.from({ length: 8 }, (_, index) => ({ blockId: `exercise-${index}`, completed: index < 6, skipped: index >= 6 }));
  const summary = shareSummaryFromSession(source);
  assert.deepEqual([summary.completedExercises, summary.totalExercises], [6, 8]);
  assert.match(defaultShareText(summary), /6\/8 exercises completed/);
  assert.doesNotMatch(JSON.stringify(summary) + defaultShareText(summary), /skip|Exercise 6|Exercise 7/i);
});

test("public representation excludes private session, load, notes, source and identity data", () => {
  const privateSession = { ...session(), googleEmail: "PRIVATE-EMAIL", spreadsheetUrl: "PRIVATE-SHEET-URL", excelFilename: "PRIVATE-XLSX", oauthToken: "PRIVATE-OAUTH", exerciseNotes: "PRIVATE-PERSISTENT-NOTE" };
  const summary = shareSummaryFromSession(privateSession);
  const publicOutput = JSON.stringify(summary) + defaultShareText(summary);
  for (const secret of ["PRIVATE-ACTUAL-LOAD", "PRIVATE-PLAN-LOAD", "PRIVATE-EXERCISE-NOTE", "PRIVATE-SESSION-NOTE", "PRIVATE-PERSISTENT-NOTE", "PRIVATE-EMAIL", "PRIVATE-SHEET-ID", "PRIVATE-SHEET-URL", "PRIVATE-XLSX", "PRIVATE-SYNC-STATUS", "PRIVATE-OAUTH", "private-id", "private-plan"]) {
    assert.equal(publicOutput.includes(secret), false, secret);
  }
  assert.deepEqual(Object.keys(summary).sort(), ["completedExercises", "durationMinutes", "localDate", "totalExercises", "workoutName"]);
});

test("native text sharing preserves edited text, cancellation and errors", async () => {
  const calls: unknown[] = [];
  assert.equal(await shareWorkout("edited 💪", { share: async (data) => { calls.push(data); } }), "shared");
  assert.deepEqual(calls, [{ text: "edited 💪" }]);
  assert.equal(await shareWorkout("cancel", { share: async () => { throw new DOMException("Cancel", "AbortError"); } }), "cancelled");
  assert.equal(await shareWorkout("error", { share: async () => { throw new Error("Unavailable"); } }), "failed");
  assert.equal(await shareWorkout("none", {}), "unsupported");
});
